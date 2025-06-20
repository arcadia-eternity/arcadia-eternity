import { Battle, setGlobalLogger } from '@arcadia-eternity/battle'
import { type BattleState, BattleMessageType, type playerId } from '@arcadia-eternity/const'
import { PlayerParser, SelectionParser } from '@arcadia-eternity/parser'
import type {
  AckResponse,
  ClientToServerEvents,
  ErrorResponse,
  ServerState,
  ServerToClientEvents,
} from '@arcadia-eternity/protocol'
import { PlayerSchema, type PlayerSelectionSchemaType } from '@arcadia-eternity/schema'
import { nanoid } from 'nanoid'
import pino from 'pino'
import { ZodError } from 'zod'
import type { Server, Socket } from 'socket.io'
import { BattleReportService, type BattleReportConfig } from '../battleReportService'
import { getContainer, TYPES } from '../container'
import type { IAuthService, JWTPayload } from '../authService'
import { PlayerRepository } from '@arcadia-eternity/database'
import type { ClusterStateManager } from './clusterStateManager'
import type { SocketClusterAdapter } from './socketClusterAdapter'
import type { DistributedLockManager } from './distributedLock'
import type { PerformanceTracker } from './performanceTracker'
import { LOCK_KEYS } from './distributedLock'
import type { RoomState, MatchmakingEntry, PlayerConnection } from './types'
import { REDIS_KEYS } from './types'
import { BattleRpcServer } from './battleRpcServer'
import { BattleRpcClient } from './battleRpcClient'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  formatters: {
    level: label => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
})

type PlayerMeta = {
  socket: Socket<ClientToServerEvents, ServerToClientEvents>
  lastPing: number
  heartbeatTimer?: ReturnType<typeof setTimeout>
}

type LocalRoomData = {
  id: string
  battle: Battle
  players: string[] // playerIds
  playersReady: Set<string>
  status: 'waiting' | 'active' | 'ended'
  lastActive: number
  battleRecordId?: string
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface InterServerEvents {}

interface SocketData {
  data: ReturnType<typeof PlayerParser.parse>
  roomId: string
  user?: JWTPayload
  playerId?: string
  sessionId?: string // 会话ID
  session?: any // 会话数据
}

export class ClusterBattleServer {
  private readonly CLEANUP_INTERVAL = 5 * 60 * 1000
  private readonly HEARTBEAT_INTERVAL = 5000
  private readonly players = new Map<string, PlayerMeta>()
  private battleReportService?: BattleReportService
  private performanceTracker?: PerformanceTracker
  private instanceId: string

  // 本地Battle实例管理
  private readonly localBattles = new Map<string, Battle>() // roomId -> Battle
  private readonly localRooms = new Map<string, LocalRoomData>() // roomId -> room data

  // 缓存计时器状态以减少频繁的集群查询
  private readonly timerStatusCache = new Map<string, { enabled: boolean; timestamp: number }>()
  private readonly TIMER_CACHE_TTL = 5000 // 5秒缓存

  // 玩家房间映射缓存，减少频繁的集群查询
  private readonly playerRoomCache = new Map<string, { roomId: string; timestamp: number }>()
  private readonly PLAYER_ROOM_CACHE_TTL = 10000 // 10秒缓存

  // 连接状态缓存，减少频繁的Redis查询
  private readonly connectionCache = new Map<string, { connections: any[]; timestamp: number }>()
  private readonly CONNECTION_CACHE_TTL = 5000 // 5秒缓存

  // RPC相关
  private rpcServer?: BattleRpcServer
  private rpcClient: BattleRpcClient
  private rpcPort?: number
  private isRpcServerInjected = false

  constructor(
    private readonly io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    private readonly stateManager: ClusterStateManager,
    private readonly socketAdapter: SocketClusterAdapter,
    private readonly lockManager: DistributedLockManager,
    private readonly _battleReportConfig?: BattleReportConfig,
    instanceId?: string,
    rpcPort?: number,
    injectedRpcServer?: BattleRpcServer,
  ) {
    this.instanceId = instanceId || nanoid()
    this.rpcPort = rpcPort
    this.rpcClient = new BattleRpcClient()

    // 如果提供了外部 RPC 服务器实例，使用它
    if (injectedRpcServer) {
      this.rpcServer = injectedRpcServer
      this.isRpcServerInjected = true
    }

    // 初始化战报服务
    if (this._battleReportConfig) {
      this.battleReportService = new BattleReportService(this._battleReportConfig, logger)
    }
  }

  setPerformanceTracker(tracker: PerformanceTracker): void {
    this.performanceTracker = tracker
  }

  /**
   * 初始化RPC服务器
   */
  private async initializeRpcServer(): Promise<void> {
    // 如果已经有注入的 RPC 服务器，只需要注册实例信息
    if (this.rpcServer) {
      logger.info({ instanceId: this.instanceId }, 'Using injected RPC server')
      await this.registerInstanceWithRpcAddress()
      return
    }

    if (!this.rpcPort) {
      // 如果没有指定RPC端口，自动生成一个
      this.rpcPort = this.generateRpcPort()
    }

    try {
      this.rpcServer = new BattleRpcServer(this, this.rpcPort)
      await this.rpcServer.start()

      // 注册实例时包含RPC地址信息
      await this.registerInstanceWithRpcAddress()

      logger.info({ instanceId: this.instanceId, rpcPort: this.rpcPort }, 'RPC server initialized successfully')
    } catch (error) {
      logger.error({ error, instanceId: this.instanceId, rpcPort: this.rpcPort }, 'Failed to initialize RPC server')
      throw error
    }
  }

  /**
   * 生成RPC端口
   */
  private generateRpcPort(): number {
    const basePort = 50000
    const instanceHash = this.instanceId.split('').reduce((a, b) => {
      a = (a << 5) - a + b.charCodeAt(0)
      return a & a
    }, 0)
    return basePort + Math.abs(instanceHash % 1000)
  }

  /**
   * 注册实例时包含RPC地址
   */
  private async registerInstanceWithRpcAddress(): Promise<void> {
    try {
      // 直接访问当前实例信息并更新RPC地址
      if (this.rpcPort) {
        // 更新实例信息，添加RPC地址
        const currentInstance = this.stateManager['currentInstance']
        currentInstance.rpcPort = this.rpcPort
        currentInstance.rpcAddress = `${currentInstance.host}:${this.rpcPort}`

        // 重新注册实例
        await this.stateManager.registerInstance()

        logger.debug(
          {
            instanceId: this.instanceId,
            rpcAddress: currentInstance.rpcAddress,
          },
          'Instance registered with RPC address',
        )
      }
    } catch (error) {
      logger.error({ error, instanceId: this.instanceId }, 'Failed to register instance with RPC address')
    }
  }

  /**
   * 初始化集群战斗服务器
   * 必须在所有依赖组件（特别是 socketAdapter）准备好后调用
   */
  async initialize(): Promise<void> {
    logger.info({ instanceId: this.instanceId }, 'Initializing ClusterBattleServer')

    // 设置Battle系统的全局logger
    setGlobalLogger(logger)

    this.initializeMiddleware()
    this.setupConnectionHandlers()
    this.setupHeartbeatSystem()
    this.setupAutoUpdateState()
    this.setupAutoCleanup()
    this.setupClusterEventHandlers()
    this.setupCrossInstanceActionListener()

    // 启动RPC服务器
    await this.initializeRpcServer()

    logger.info({ instanceId: this.instanceId }, 'ClusterBattleServer initialized successfully')
  }

  private initializeMiddleware() {
    this.io.use(async (socket, next) => {
      try {
        // 从查询参数中获取玩家ID和会话ID
        const playerId = socket.handshake.query?.playerId as string
        const sessionId = socket.handshake.query?.sessionId as string

        if (!playerId) {
          return next(new Error('PLAYER_ID_REQUIRED'))
        }

        const container = getContainer()
        const playerRepo = container.get<PlayerRepository>(TYPES.PlayerRepository)
        const authService = container.get<IAuthService>(TYPES.AuthService)

        // 检查玩家是否存在
        const player = await playerRepo.getPlayerById(playerId)
        if (!player) {
          return next(new Error('PLAYER_NOT_FOUND'))
        }

        const isRegistered = player.is_registered || false
        socket.data.playerId = playerId

        // 如果客户端没有提供sessionId，自动生成一个
        if (!sessionId) {
          const { generateTimestampedSessionId } = await import('./types')
          const generatedSessionId = generateTimestampedSessionId()
          socket.data.sessionId = generatedSessionId
        } else {
          socket.data.sessionId = sessionId
        }

        if (!isRegistered) {
          // 游客用户，直接放行
          socket.data.user = undefined
          next()
          return
        }

        // 注册用户，需要JWT认证
        const token = socket.handshake.auth?.token || (socket.handshake.query?.token as string)

        if (!token) {
          return next(new Error('TOKEN_REQUIRED_FOR_REGISTERED_USER'))
        }

        // 验证token（包括检查集群黑名单）
        const payload = authService.verifyAccessTokenAsync
          ? await authService.verifyAccessTokenAsync(token)
          : authService.verifyAccessToken(token)
        if (!payload) {
          return next(new Error('INVALID_TOKEN'))
        }

        // 如果提供了sessionId，验证会话是否存在且有效
        if (sessionId && authService.getSession) {
          try {
            const session = await authService.getSession(playerId, sessionId)
            if (!session) {
              return next(new Error('SESSION_NOT_FOUND'))
            }

            // 检查会话是否过期
            if (session.expiry && Date.now() > session.expiry) {
              return next(new Error('SESSION_EXPIRED'))
            }

            socket.data.session = session
          } catch (error) {
            logger.error({ error, playerId, sessionId }, 'Session validation failed')
            return next(new Error('SESSION_VALIDATION_ERROR'))
          }
        }

        // 检查token是否在集群黑名单中
        if (payload.jti) {
          const isBlacklisted = await this.stateManager.isTokenBlacklisted(payload.jti)
          if (isBlacklisted) {
            return next(new Error('TOKEN_BLACKLISTED'))
          }
        }

        // 验证token中的玩家ID是否匹配
        if (payload.playerId !== playerId) {
          logger.warn(`Socket player ID mismatch: token=${payload.playerId}, request=${playerId}`)
          return next(new Error('PLAYER_ID_TOKEN_MISMATCH'))
        }

        // 将认证信息添加到socket数据
        socket.data.user = payload
        next()
      } catch (error) {
        logger.error({ error }, 'Socket authentication error')
        next(new Error('AUTHENTICATION_ERROR'))
      }
    })
  }

  private setupAutoUpdateState() {
    setInterval(async () => {
      try {
        const state: ServerState = await this.getCurrentState()
        this.io.emit('updateState', state)
      } catch (error) {
        logger.error({ error }, 'Error updating server state')
      }
    }, 10000)
  }

  private setupConnectionHandlers() {
    this.io.on('connection', async socket => {
      logger.info({ socketId: socket.id }, '玩家连接')
      await this.registerPlayerConnection(socket)

      socket.on('pong', async () => {
        const player = this.players.get(socket.id)
        if (player) player.lastPing = Date.now()

        // 更新集群中的玩家连接活跃时间
        const playerId = socket.data.playerId
        const sessionId = socket.data.sessionId

        if (!playerId || !sessionId) return

        // 更新玩家连接的lastSeen时间戳，防止连接被清理
        try {
          const connection: PlayerConnection = {
            instanceId: this.instanceId,
            socketId: socket.id,
            lastSeen: Date.now(),
            status: 'connected',
            sessionId: sessionId,
            metadata: {
              userAgent: socket.handshake.headers['user-agent'],
              ip: socket.handshake.address,
            },
          }
          await this.stateManager.setPlayerConnection(playerId, connection)
        } catch (error) {
          logger.error({ error, playerId, sessionId }, 'Failed to update player connection lastSeen')
        }

        // 更新集群中的房间活跃时间
        const roomState = await this.getPlayerRoomFromCluster(playerId, sessionId)
        if (roomState) {
          roomState.lastActive = Date.now()
          await this.stateManager.setRoomState(roomState)
        }
      })

      socket.on('disconnect', async () => {
        logger.info({ socketId: socket.id }, '玩家断开连接')
        await this.handlePlayerDisconnect(socket)
      })

      this.setupSocketHandlers(socket)
    })
  }

  private async handlePlayerDisconnect(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
  ) {
    const playerId = socket.data.playerId
    const sessionId = socket.data.sessionId
    if (!playerId || !sessionId) return

    try {
      logger.warn({ socketId: socket.id, playerId, sessionId }, '玩家断开连接，开始处理断线逻辑')

      // 移除本地玩家记录
      this.removePlayer(socket.id)

      // 从集群状态中移除玩家连接
      await this.stateManager.removePlayerConnection(playerId, sessionId)

      // 清理相关缓存
      this.clearPlayerRoomCache(playerId, sessionId)
      this.clearConnectionCache(playerId)

      // 检查该session是否在战斗中，如果是则立即终止对应的战斗
      const roomState = await this.getPlayerRoomFromCluster(playerId, sessionId)
      if (roomState) {
        logger.warn(
          { playerId, sessionId, roomId: roomState.id, roomStatus: roomState.status },
          '玩家会话在战斗中断线，立即终止该会话的战斗',
        )

        // 处理玩家放弃（包括战斗终止和房间清理）
        await this.handlePlayerAbandon(roomState.id, playerId, sessionId)
      } else {
        logger.info({ playerId, sessionId }, '玩家会话断线，但该会话不在任何战斗中')
      }

      // 从匹配队列中移除该session
      await this.stateManager.removeFromMatchmakingQueue(playerId, sessionId)

      // 更新匹配队列大小统计
      if (this.performanceTracker) {
        const queueSize = await this.stateManager.getMatchmakingQueueSize()
        this.performanceTracker.updateMatchmakingQueueSize(queueSize)
      }

      // 检查该玩家是否还有其他活跃连接，用于日志记录
      const hasOtherConnections = await this.hasOtherActiveConnections(playerId, socket.id, sessionId)
      if (hasOtherConnections) {
        logger.info({ playerId, sessionId }, '玩家还有其他活跃连接')
      } else {
        logger.info({ playerId, sessionId }, '玩家所有连接都已断开')
      }
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Error handling player disconnect')
    }
  }

  private setupSocketHandlers(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
  ) {
    socket.on('joinMatchmaking', (data, ack) => this.handleJoinMatchmaking(socket, data, ack))
    socket.on('cancelMatchmaking', ack => this.handleCancelMatchmaking(socket, ack))
    socket.on('submitPlayerSelection', (data, ack) => this.handlePlayerSelection(socket, data, ack))
    socket.on('getState', ack => this.handleGetState(socket, ack))
    socket.on('getAvailableSelection', ack => this.handleGetSelection(socket, ack))
    socket.on('getServerState', ack => this.handleGetServerState(socket, ack))
    socket.on('ready', () => this.handleReady(socket))
    socket.on('reportAnimationEnd', data => this.handleReportAnimationEnd(socket, data))

    // 计时器相关事件处理
    socket.on('isTimerEnabled', ack => this.handleIsTimerEnabled(socket, ack))
    socket.on('getPlayerTimerState', (data, ack) => this.handleGetPlayerTimerState(socket, data, ack))
    socket.on('getAllPlayerTimerStates', ack => this.handleGetAllPlayerTimerStates(socket, ack))
    socket.on('getTimerConfig', ack => this.handleGetTimerConfig(socket, ack))
    socket.on('startAnimation', (data, ack) => this.handleStartAnimation(socket, data, ack))
    socket.on('endAnimation', data => this.handleEndAnimation(socket, data))
  }

  private setupClusterEventHandlers() {
    this.stateManager.on('clusterEvent', event => {
      switch (event.type) {
        case 'room:create':
        case 'room:update':
          this.handleRoomStateChange(event.data)
          break
        case 'room:destroy':
          this.handleRoomDestroy(event.data.roomId)
          break
        case 'player:disconnect':
          this.handleClusterPlayerDisconnect(event.data)
          break
        case 'matchmaking:join':
          this.handleClusterMatchmakingJoin(event.data)
          break
      }
    })
  }

  private async handleRoomStateChange(roomState: RoomState) {
    // 如果房间在当前实例，更新本地状态
    if (roomState.instanceId === this.instanceId) {
      // Room state updated in cluster
    }
  }

  private async handleRoomDestroy(roomId: string) {
    // Room destroyed in cluster
  }

  private async handleClusterPlayerDisconnect(data: { playerId: string; instanceId: string }) {
    if (data.instanceId !== this.instanceId) {
      // Player disconnected from another instance
    }
  }

  private async handleClusterMatchmakingJoin(entry: MatchmakingEntry) {
    logger.info({ playerId: entry.playerId, sessionId: entry.sessionId }, 'Received cluster matchmaking join event')

    // 只有指定的匹配实例才处理匹配逻辑，避免多实例竞争
    const isMatchmakingLeader = await this.isMatchmakingLeader()
    logger.info(
      { instanceId: this.instanceId, isMatchmakingLeader, source: 'handleClusterMatchmakingJoin' },
      'Leadership check for matchmaking',
    )
    if (!isMatchmakingLeader) {
      return
    }

    // 尝试进行匹配
    logger.info({ instanceId: this.instanceId }, 'Starting matchmaking attempt as leader')
    await this.attemptClusterMatchmaking()
    logger.info({ instanceId: this.instanceId }, 'Matchmaking attempt completed')
  }

  /**
   * 设置跨实例操作监听器
   */
  private setupCrossInstanceActionListener(): void {
    const subscriber = this.stateManager['redisManager'].getSubscriber()
    const channel = `instance:${this.instanceId}:battle-actions`

    subscriber.subscribe(channel, err => {
      if (err) {
        logger.error({ error: err }, 'Failed to subscribe to battle actions channel')
      }
    })

    subscriber.on('message', (receivedChannel, message) => {
      if (receivedChannel === channel) {
        try {
          const action = JSON.parse(message)
          this.handleCrossInstanceAction(action)
        } catch (error) {
          logger.error({ error, message }, 'Error parsing cross-instance battle action')
        }
      }
    })
  }

  /**
   * 处理跨实例操作
   */
  private async handleCrossInstanceAction(action: any): Promise<void> {
    try {
      const { action: actionType, playerId, requestId, responseChannel, data } = action

      // 从data中提取roomId，如果没有则尝试从action中获取
      const roomId = data?.roomId || action.roomId

      let result: any
      let success = true
      let errorMessage: string | undefined

      try {
        switch (actionType) {
          case 'submitPlayerSelection':
            // 从data中提取selection数据，如果data包含selection字段则使用，否则使用整个data
            const selectionData = data.selection || data
            result = await this.handleLocalPlayerSelection(roomId, playerId, selectionData)
            break

          case 'getState':
            result = await this.handleLocalGetState(roomId, playerId)
            break

          case 'getAvailableSelection':
            result = await this.handleLocalGetSelection(roomId, playerId)
            break

          case 'ready':
            result = await this.handleLocalReady(roomId, playerId)
            break

          case 'player-abandon':
            result = await this.handleLocalPlayerAbandon(roomId, playerId)
            break

          case 'force-terminate-battle':
            result = await this.handleLocalBattleTermination(roomId, playerId, data.reason || 'abandon')
            break

          case 'reportAnimationEnd':
            result = await this.handleLocalReportAnimationEnd(roomId, playerId, data)
            break

          case 'isTimerEnabled':
            result = await this.handleLocalIsTimerEnabled(roomId, playerId)
            break

          case 'getPlayerTimerState':
            result = await this.handleLocalGetPlayerTimerState(roomId, playerId, data)
            break

          case 'getAllPlayerTimerStates':
            result = await this.handleLocalGetAllPlayerTimerStates(roomId, playerId)
            break

          case 'getTimerConfig':
            result = await this.handleLocalGetTimerConfig(roomId, playerId)
            break

          case 'startAnimation':
            result = await this.handleLocalStartAnimation(roomId, playerId, data)
            break

          case 'endAnimation':
            result = await this.handleLocalEndAnimation(roomId, playerId, data)
            break

          default:
            throw new Error(`Unknown action type: ${actionType}`)
        }
      } catch (error) {
        success = false
        errorMessage = error instanceof Error ? error.message : 'Unknown error'
        logger.error(
          {
            error: error instanceof Error ? { message: error.message, stack: error.stack, name: error.name } : error,
            actionType,
            playerId,
            roomId,
          },
          'Error executing cross-instance action',
        )
      }

      // 发送响应（如果有响应频道）
      if (responseChannel && requestId) {
        await this.sendForwardResponse(responseChannel, requestId, success, result, errorMessage)
      }
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? { message: error.message, stack: error.stack, name: error.name } : error,
          action,
        },
        'Error handling cross-instance battle action',
      )
    }
  }

  // === 集群感知的匹配系统 ===

  private async handleJoinMatchmaking(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    rawPlayerData: unknown,
    ack?: AckResponse<{ status: 'QUEUED' }>,
  ) {
    try {
      // 首先验证原始数据格式
      const validatedRawData = this.validateRawPlayerData(rawPlayerData)
      const playerId = socket.data.playerId!

      // 验证玩家ID是否与连接时验证的ID一致
      if (validatedRawData.id !== playerId) {
        logger.warn(
          {
            socketId: socket.id,
            connectedPlayerId: playerId,
            requestedPlayerId: validatedRawData.id,
          },
          '玩家ID不匹配，拒绝加入匹配',
        )
        throw new Error('PLAYER_ID_MISMATCH')
      }

      // 解析为Player实例用于本地存储
      const playerData = this.validatePlayerData(rawPlayerData)
      socket.data.data = playerData

      // 使用队列专用锁确保队列操作的原子性
      await this.lockManager.withLock(LOCK_KEYS.MATCHMAKING_QUEUE, async () => {
        // 添加到集群匹配队列 - 存储原始验证过的数据而不是解析后的实例
        const entry: MatchmakingEntry = {
          playerId,
          joinTime: Date.now(),
          playerData: validatedRawData, // 存储原始数据而不是Player实例
          sessionId: socket.data.sessionId,
          metadata: {
            sessionId: socket.data.sessionId,
          },
        }

        await this.stateManager.addToMatchmakingQueue(entry)

        // 更新匹配队列大小统计
        if (this.performanceTracker) {
          const queueSize = await this.stateManager.getMatchmakingQueueSize()
          this.performanceTracker.updateMatchmakingQueueSize(queueSize)
        }

        logger.info(
          {
            socketId: socket.id,
            playerId,
            sessionId: socket.data.sessionId,
            playerName: playerData.name,
            teamSize: playerData.team.length,
          },
          '玩家加入集群匹配队列',
        )

        ack?.({
          status: 'SUCCESS',
          data: { status: 'QUEUED' },
        })

        // 不在这里直接尝试匹配，而是依赖集群事件触发
        // 这样避免了双重触发的问题
      })
    } catch (error) {
      logger.error(
        {
          socketId: socket.id,
          error: error instanceof Error ? error.stack : error,
          inputData: rawPlayerData,
        },
        '加入匹配队列失败',
      )
      this.handleValidationError(error, socket, ack)
    }
  }

  private async attemptClusterMatchmaking(): Promise<void> {
    // 使用全局匹配锁确保只有一个实例在同一时间进行匹配
    return await this.lockManager.withLock(
      LOCK_KEYS.MATCHMAKING,
      async () => {
        try {
          const queue = await this.stateManager.getMatchmakingQueue()

          logger.info(
            {
              queueLength: queue.length,
              queue: queue.map(e => ({ playerId: e.playerId, sessionId: e.sessionId, joinTime: e.joinTime })),
            },
            'Attempting cluster matchmaking',
          )

          if (queue.length < 2) {
            logger.info('Not enough players in queue for matching')
            return
          }

          logger.info({ queueLength: queue.length }, 'Found sufficient players for matching, proceeding')

          // 按加入时间排序
          const sortedQueue = queue.sort((a, b) => a.joinTime - b.joinTime)

          // 寻找可以匹配的两个session（确保不是同一个playerId）
          let player1Entry: MatchmakingEntry | null = null
          let player2Entry: MatchmakingEntry | null = null

          for (let i = 0; i < sortedQueue.length; i++) {
            if (!player1Entry) {
              player1Entry = sortedQueue[i]
              continue
            }

            const candidate = sortedQueue[i]

            // 确保不是同一个玩家的不同session
            if (candidate.playerId !== player1Entry.playerId) {
              player2Entry = candidate
              break
            }
          }

          // 如果找不到合适的匹配，返回
          if (!player1Entry || !player2Entry) {
            logger.info(
              {
                player1Entry: !!player1Entry,
                player2Entry: !!player2Entry,
                queueLength: queue.length,
                queueDetails: queue.map(e => ({ playerId: e.playerId, sessionId: e.sessionId })),
              },
              'No suitable match found - all entries may be from same player',
            )
            return
          }

          logger.info(
            {
              player1: { playerId: player1Entry.playerId, sessionId: player1Entry.sessionId },
              player2: { playerId: player2Entry.playerId, sessionId: player2Entry.sessionId },
            },
            'Found suitable match pair, proceeding with match creation',
          )

          // 使用分布式锁确保匹配的原子性
          // 基于sessionId生成锁键，确保顺序一致，避免死锁
          const session1Key = `${player1Entry.playerId}:${player1Entry.sessionId}`
          const session2Key = `${player2Entry.playerId}:${player2Entry.sessionId}`
          const sortedSessionKeys = [session1Key, session2Key].sort()
          const lockKey = `match:${sortedSessionKeys[0]}:${sortedSessionKeys[1]}`

          logger.info(
            {
              player1: { id: player1Entry.playerId, sessionId: player1Entry.sessionId },
              player2: { id: player2Entry.playerId, sessionId: player2Entry.sessionId },
              lockKey,
            },
            'Starting match creation with lock',
          )

          await this.lockManager.withLock(lockKey, async () => {
            // 再次检查session是否仍在队列中
            const currentQueue = await this.stateManager.getMatchmakingQueue()
            const p1Still = currentQueue.find(
              e => e.playerId === player1Entry!.playerId && e.sessionId === player1Entry!.sessionId,
            )
            const p2Still = currentQueue.find(
              e => e.playerId === player2Entry!.playerId && e.sessionId === player2Entry!.sessionId,
            )

            if (!p1Still || !p2Still) {
              return
            }

            // 检查玩家连接状态（基于session）
            logger.info(
              {
                player1: { playerId: player1Entry.playerId, sessionId: player1Entry.sessionId },
                player2: { playerId: player2Entry.playerId, sessionId: player2Entry.sessionId },
              },
              'About to check player connections by session',
            )

            const p1Connection = await this.stateManager.getPlayerConnectionBySession(
              player1Entry.playerId,
              player1Entry.sessionId!,
            )
            const p2Connection = await this.stateManager.getPlayerConnectionBySession(
              player2Entry.playerId,
              player2Entry.sessionId!,
            )

            logger.info(
              {
                player1: {
                  playerId: player1Entry.playerId,
                  sessionId: player1Entry.sessionId,
                  hasConnection: !!p1Connection,
                },
                player2: {
                  playerId: player2Entry.playerId,
                  sessionId: player2Entry.sessionId,
                  hasConnection: !!p2Connection,
                },
              },
              'Player connection check results',
            )

            if (
              !p1Connection ||
              !p2Connection ||
              p1Connection.status !== 'connected' ||
              p2Connection.status !== 'connected'
            ) {
              logger.info(
                {
                  player1: {
                    playerId: player1Entry.playerId,
                    sessionId: player1Entry.sessionId,
                    connection: p1Connection
                      ? { status: p1Connection.status, instanceId: p1Connection.instanceId }
                      : null,
                  },
                  player2: {
                    playerId: player2Entry.playerId,
                    sessionId: player2Entry.sessionId,
                    connection: p2Connection
                      ? { status: p2Connection.status, instanceId: p2Connection.instanceId }
                      : null,
                  },
                },
                'Player sessions not connected, skipping match',
              )
              return
            }

            // 创建战斗房间
            logger.info(
              {
                player1: { id: player1Entry.playerId, sessionId: player1Entry.sessionId },
                player2: { id: player2Entry.playerId, sessionId: player2Entry.sessionId },
              },
              'About to create cluster battle room',
            )

            const roomId = await this.createClusterBattleRoom(player1Entry, player2Entry)

            logger.info(
              {
                roomId,
                player1: { id: player1Entry.playerId, sessionId: player1Entry.sessionId },
                player2: { id: player2Entry.playerId, sessionId: player2Entry.sessionId },
              },
              'Battle room creation result',
            )

            if (roomId) {
              // 从队列中移除session
              await this.stateManager.removeFromMatchmakingQueue(player1Entry.playerId, player1Entry.sessionId)
              await this.stateManager.removeFromMatchmakingQueue(player2Entry.playerId, player2Entry.sessionId)

              // 更新匹配队列大小统计
              if (this.performanceTracker) {
                const queueSize = await this.stateManager.getMatchmakingQueueSize()
                this.performanceTracker.updateMatchmakingQueueSize(queueSize)
              }

              logger.info(
                {
                  roomId,
                  player1: { id: player1Entry.playerId, sessionId: player1Entry.sessionId },
                  player2: { id: player2Entry.playerId, sessionId: player2Entry.sessionId },
                },
                'About to notify match success',
              )

              // 通知玩家匹配成功
              await this.notifyMatchSuccess(player1Entry, player2Entry, roomId)

              logger.info(
                {
                  roomId,
                  player1: { id: player1Entry.playerId, name: player1Entry.playerData.name },
                  player2: { id: player2Entry.playerId, name: player2Entry.playerData.name },
                },
                '集群匹配成功',
              )
            } else {
              logger.error(
                {
                  player1: { id: player1Entry.playerId, sessionId: player1Entry.sessionId },
                  player2: { id: player2Entry.playerId, sessionId: player2Entry.sessionId },
                },
                'Failed to create battle room - roomId is null',
              )
            }

            logger.info(
              {
                roomId,
                player1: { id: player1Entry.playerId, sessionId: player1Entry.sessionId },
                player2: { id: player2Entry.playerId, sessionId: player2Entry.sessionId },
              },
              'Exiting withLock callback in attemptClusterMatchmaking',
            )
          })
        } catch (error) {
          logger.error(
            {
              error:
                error instanceof Error
                  ? {
                      name: error.name,
                      message: error.message,
                      stack: error.stack,
                      code: (error as any).code,
                    }
                  : error,
            },
            'Error in cluster matchmaking',
          )
        }
      },
      { ttl: 30000, retryCount: 5, retryDelay: 200 }, // 较长的TTL，适中的重试
    )
  }

  private async createClusterBattleRoom(
    player1Entry: MatchmakingEntry,
    player2Entry: MatchmakingEntry,
  ): Promise<string | null> {
    try {
      const roomId = nanoid()

      // 使用分布式锁确保房间创建的原子性
      return await this.lockManager.withLock(LOCK_KEYS.ROOM_CREATE(roomId), async () => {
        // 解析玩家数据 - 现在playerData应该是原始验证过的数据
        let player1Data, player2Data
        try {
          player1Data = PlayerParser.parse(player1Entry.playerData)
        } catch (error) {
          logger.error(
            {
              error: error instanceof Error ? error.message : error,
              playerId: player1Entry.playerId,
              playerData: player1Entry.playerData,
            },
            'Failed to parse player 1 data',
          )
          throw new Error(`Failed to parse player 1 data: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }

        try {
          player2Data = PlayerParser.parse(player2Entry.playerData)
        } catch (error) {
          logger.error(
            {
              error: error instanceof Error ? error.message : error,
              playerId: player2Entry.playerId,
              playerData: player2Entry.playerData,
            },
            'Failed to parse player 2 data',
          )
          throw new Error(`Failed to parse player 2 data: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }

        // 注意：不在这里创建 Battle 实例，而是在 createLocalBattle 中创建
        // 这样避免重复初始化导致的印记重复问题

        // 创建战报记录
        let battleRecordId: string | undefined
        if (this.battleReportService) {
          try {
            battleRecordId =
              (await this.battleReportService.startBattleRecord(
                roomId,
                player1Data.id,
                player1Data.name,
                player2Data.id,
                player2Data.name,
              )) || undefined
          } catch (error) {
            logger.error({ error }, 'Failed to create battle record')
          }
        }

        // 先创建本地Battle实例
        const session1 = player1Entry.sessionId || player1Entry.metadata?.sessionId || 'default'
        const session2 = player2Entry.sessionId || player2Entry.metadata?.sessionId || 'default'
        const tempRoomState: RoomState = {
          id: roomId,
          status: 'waiting',
          sessions: [session1, session2],
          sessionPlayers: {
            [session1]: player1Entry.playerId,
            [session2]: player2Entry.playerId,
          },
          instanceId: this.instanceId,
          lastActive: Date.now(),
          battleState: undefined, // 临时空状态，稍后更新
          metadata: {
            battleRecordId,
            createdAt: Date.now(),
          },
        }

        // 先保存临时房间状态到集群，确保setupBattleEventListeners能找到房间状态
        logger.info({ roomId }, 'About to save temp room state to cluster')
        await this.stateManager.setRoomState(tempRoomState)

        // 更新玩家房间缓存
        this.updatePlayerRoomCache(player1Entry.playerId, session1, roomId)
        this.updatePlayerRoomCache(player2Entry.playerId, session2, roomId)

        logger.info({ roomId }, 'Temp room state saved, about to create local battle')

        const battle = await this.createLocalBattle(tempRoomState, player1Data, player2Data)
        logger.info({ roomId }, 'Local battle created successfully')

        // 更新房间状态为实际的战斗状态
        logger.info({ roomId }, 'About to update room state with battle state')
        const roomState: RoomState = {
          ...tempRoomState,
          battleState: battle.getState(player1Data.id, false),
        }

        // 更新集群状态为完整的战斗状态
        logger.info({ roomId }, 'About to save updated room state to cluster')
        await this.stateManager.setRoomState(roomState)
        logger.info({ roomId }, 'Updated room state saved to cluster')

        // 将玩家加入Socket.IO房间
        logger.info(
          { roomId, player1Id: player1Entry.playerId, player2Id: player2Entry.playerId },
          'About to join players to Socket.IO room',
        )
        await this.socketAdapter.joinPlayerToRoom(player1Entry.playerId, roomId)
        await this.socketAdapter.joinPlayerToRoom(player2Entry.playerId, roomId)

        // 建立会话到房间的映射索引，优化后续查找
        await this.createSessionRoomMappings(roomState)

        logger.info({ roomId }, 'Players joined Socket.IO room successfully')

        logger.info(
          { roomId, sessions: roomState.sessions, sessionPlayers: roomState.sessionPlayers },
          'Cluster battle room created',
        )

        logger.info({ roomId }, 'About to return roomId from createClusterBattleRoom')
        return roomId
      })
    } catch (error) {
      logger.error(
        {
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : error,
          player1Id: player1Entry.playerId,
          player2Id: player2Entry.playerId,
        },
        'Failed to create cluster battle room',
      )
      return null
    }
  }

  private async notifyMatchSuccess(
    player1Entry: MatchmakingEntry,
    player2Entry: MatchmakingEntry,
    roomId: string,
  ): Promise<void> {
    try {
      const player1Id = player1Entry.playerId
      const player2Id = player2Entry.playerId
      const session1Id = player1Entry.sessionId || player1Entry.metadata?.sessionId
      const session2Id = player2Entry.sessionId || player2Entry.metadata?.sessionId

      // sessionId是必需的
      if (!session1Id || !session2Id) {
        logger.error(
          { player1Id, player2Id, session1Id, session2Id, roomId },
          'SessionId is required for both players in match notification',
        )
        return
      }

      logger.info(
        { player1Id, player2Id, session1Id, session2Id, roomId },
        'Starting match success notification process',
      )

      // 获取玩家连接信息（基于session）
      logger.info({ player1Id, player2Id, session1Id, session2Id }, 'Looking up player connections by session')

      const player1Connection = await this.stateManager.getPlayerConnectionBySession(player1Id, session1Id)
      const player2Connection = await this.stateManager.getPlayerConnectionBySession(player2Id, session2Id)

      logger.info(
        {
          player1Id,
          player2Id,
          session1Id,
          session2Id,
          player1Connection: player1Connection
            ? {
                instanceId: player1Connection.instanceId,
                socketId: player1Connection.socketId,
                status: player1Connection.status,
              }
            : null,
          player2Connection: player2Connection
            ? {
                instanceId: player2Connection.instanceId,
                socketId: player2Connection.socketId,
                status: player2Connection.status,
              }
            : null,
        },
        'Player connection lookup results',
      )

      if (!player1Connection || !player2Connection) {
        logger.error(
          {
            player1Id,
            player2Id,
            session1Id,
            session2Id,
            player1Connection: !!player1Connection,
            player2Connection: !!player2Connection,
          },
          'Player session connections not found for match notification',
        )
        return
      }

      logger.debug(
        {
          player1Id,
          player2Id,
          session1Id,
          session2Id,
          player1Instance: player1Connection.instanceId,
          player2Instance: player2Connection.instanceId,
          currentInstance: this.instanceId,
        },
        'Player connections found',
      )

      // 获取玩家名称
      const player1Name = await this.getPlayerName(player1Id)
      const player2Name = await this.getPlayerName(player2Id)

      // 构造匹配成功消息
      const player1Message = {
        status: 'SUCCESS' as const,
        data: {
          roomId,
          opponent: { id: player2Id, name: player2Name },
        },
      }

      const player2Message = {
        status: 'SUCCESS' as const,
        data: {
          roomId,
          opponent: { id: player1Id, name: player1Name },
        },
      }

      logger.info(
        {
          player1Id,
          player2Id,
          session1Id,
          session2Id,
          roomId,
          player1Message,
          player2Message,
        },
        'Sending match success notifications',
      )

      // 先将玩家加入房间，然后发送匹配成功通知
      logger.info({ player1Id, player2Id, session1Id, session2Id, roomId }, 'Adding players to battle room')

      const joinResult1 = await this.socketAdapter.joinPlayerToRoom(player1Id, roomId)
      const joinResult2 = await this.socketAdapter.joinPlayerToRoom(player2Id, roomId)

      logger.info(
        {
          player1Id,
          player2Id,
          session1Id,
          session2Id,
          roomId,
          joinResult1,
          joinResult2,
        },
        'Players joined room results',
      )

      // 发送匹配成功通知（基于session）
      const result1 = await this.sendToPlayerSession(player1Id, session1Id, 'matchSuccess', player1Message)
      const result2 = await this.sendToPlayerSession(player2Id, session2Id, 'matchSuccess', player2Message)

      logger.info(
        {
          player1Id,
          player2Id,
          session1Id,
          session2Id,
          roomId,
          result1,
          result2,
        },
        'Match success notifications sent with results',
      )
    } catch (error) {
      logger.error({ error, roomId }, 'Error sending match success notifications')
    }
  }

  // === 集群感知的房间管理 ===

  /**
   * 向特定玩家的特定会话发送消息
   */
  private async sendToPlayerSession(playerId: string, sessionId: string, event: string, data: any): Promise<boolean> {
    return await this.socketAdapter.sendToPlayerSession(playerId, sessionId, event, data)
  }

  /**
   * 移除session到房间的映射
   */
  private async removeSessionRoomMapping(playerId: string, sessionId: string, roomId: string): Promise<void> {
    try {
      const client = this.stateManager['redisManager'].getClient()
      const sessionKey = `${playerId}:${sessionId}`
      await client.srem(`session:rooms:${sessionKey}`, roomId)
    } catch (error) {
      logger.error({ error, playerId, sessionId, roomId }, 'Failed to remove session room mapping')
    }
  }

  private async getPlayerRoomFromCluster(playerId: string, sessionId: string): Promise<RoomState | null> {
    try {
      // 检查缓存
      const cacheKey = `${playerId}:${sessionId}`
      const cached = this.playerRoomCache.get(cacheKey)
      const now = Date.now()

      if (cached && now - cached.timestamp < this.PLAYER_ROOM_CACHE_TTL) {
        // 验证缓存的房间是否仍然有效
        const roomState = await this.stateManager.getRoomState(cached.roomId)
        if (roomState && roomState.sessions.includes(sessionId) && roomState.sessionPlayers[sessionId] === playerId) {
          return roomState
        }
        // 缓存失效，删除
        this.playerRoomCache.delete(cacheKey)
      }

      // 优化查找策略：首先尝试从玩家会话映射中查找
      const client = this.stateManager['redisManager'].getClient()

      // 尝试从玩家会话映射中直接获取房间ID
      const sessionRoomKey = `session:rooms:${playerId}:${sessionId}`
      const roomIds = await client.smembers(sessionRoomKey)

      // 如果找到映射，直接验证房间状态
      for (const roomId of roomIds) {
        const roomState = await this.stateManager.getRoomState(roomId)
        if (roomState && roomState.sessions.includes(sessionId) && roomState.sessionPlayers[sessionId] === playerId) {
          // 更新缓存
          this.playerRoomCache.set(cacheKey, { roomId, timestamp: now })
          return roomState
        }
        // 清理无效的映射
        await client.srem(sessionRoomKey, roomId)
      }

      // 如果直接映射查找失败，回退到遍历所有房间（但限制数量）
      const allRoomIds = await client.smembers(REDIS_KEYS.ROOMS)

      // 批量获取房间状态，减少网络往返
      const pipeline = client.pipeline()
      for (const roomId of allRoomIds.slice(0, 50)) {
        // 限制最多检查50个房间
        pipeline.hgetall(REDIS_KEYS.ROOM(roomId))
      }
      const results = await pipeline.exec()

      if (results) {
        for (let i = 0; i < results.length; i++) {
          const [err, roomData] = results[i]
          if (err || !roomData) continue

          try {
            const roomState = JSON.parse((roomData as any).data || '{}') as RoomState
            if (!roomState.id) continue

            // 检查会话匹配
            if (sessionId) {
              if (roomState.sessions.includes(sessionId) && roomState.sessionPlayers[sessionId] === playerId) {
                // 更新缓存和映射
                this.playerRoomCache.set(cacheKey, { roomId: roomState.id, timestamp: now })
                await client.sadd(sessionRoomKey, roomState.id)
                return roomState
              }
            } else {
              // 向后兼容：检查是否有任何会话对应该playerId
              for (const roomSessionId of roomState.sessions) {
                if (roomState.sessionPlayers[roomSessionId] === playerId) {
                  this.playerRoomCache.set(cacheKey, { roomId: roomState.id, timestamp: now })
                  return roomState
                }
              }
            }
          } catch (parseError) {
            logger.warn({ error: parseError, roomId: allRoomIds[i] }, 'Failed to parse room state')
          }
        }
      }

      return null
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Error getting player room from cluster')
      return null
    }
  }

  private async handlePlayerAbandon(roomId: string, playerId: string, sessionId: string): Promise<void> {
    try {
      const roomState = await this.stateManager.getRoomState(roomId)
      if (!roomState) return

      logger.warn({ playerId, roomId, sessionId }, '玩家放弃战斗')

      // 如果房间在当前实例，处理战斗逻辑
      if (roomState.instanceId === this.instanceId) {
        await this.handleClusterBattleAbandon(roomState, playerId)
      } else {
        // 通知正确的实例处理放弃逻辑
        await this.notifyInstancePlayerAbandon(roomState.instanceId, roomState.id, playerId)
      }

      // 更新房间状态 - 基于会话移除
      let sessionToRemove: string | undefined

      sessionToRemove = sessionId

      if (sessionToRemove && roomState.sessionPlayers[sessionToRemove] === playerId) {
        roomState.sessions = roomState.sessions.filter(id => id !== sessionToRemove)
        delete roomState.sessionPlayers[sessionToRemove]

        // 移除session到房间的映射
        await this.removeSessionRoomMapping(playerId, sessionToRemove, roomId)

        logger.info({ playerId, sessionId: sessionToRemove, roomId }, '已从房间中移除玩家会话')
      } else {
        logger.warn(
          { playerId, sessionId, roomId, availableSessions: Object.keys(roomState.sessionPlayers) },
          '未找到要移除的玩家会话',
        )
      }

      roomState.lastActive = Date.now()

      if (roomState.sessions.length === 0) {
        // 房间为空，删除房间
        await this.stateManager.removeRoomState(roomId)
      } else {
        // 更新房间状态
        await this.stateManager.setRoomState(roomState)
      }
    } catch (error) {
      logger.error({ error, roomId, playerId, sessionId }, 'Error handling player abandon')
    }
  }

  // === 集群战斗辅助方法 ===

  /**
   * 转发玩家操作到正确的实例并等待响应 (使用RPC)
   */
  private async forwardPlayerAction(
    targetInstanceId: string,
    action: string,
    playerId: string,
    data: any,
  ): Promise<any> {
    try {
      // 获取目标实例的RPC地址
      const targetInstance = await this.stateManager.getInstance(targetInstanceId)
      if (!targetInstance || !targetInstance.rpcAddress) {
        throw new Error(`Target instance RPC address not found: ${targetInstanceId}`)
      }

      const roomId = data.roomId
      if (!roomId) {
        throw new Error('Room ID is required for RPC forwarding')
      }

      // 根据action类型调用相应的RPC方法
      switch (action) {
        case 'submitPlayerSelection':
          return await this.rpcClient.submitPlayerSelection(
            targetInstanceId,
            targetInstance.rpcAddress,
            roomId,
            playerId,
            data.selection || data,
          )

        case 'getState':
          return await this.rpcClient.getBattleState(targetInstanceId, targetInstance.rpcAddress, roomId, playerId)

        case 'getAvailableSelection':
          return await this.rpcClient.getAvailableSelection(
            targetInstanceId,
            targetInstance.rpcAddress,
            roomId,
            playerId,
          )

        case 'ready':
          return await this.rpcClient.playerReady(targetInstanceId, targetInstance.rpcAddress, roomId, playerId)

        case 'player-abandon':
          return await this.rpcClient.playerAbandon(targetInstanceId, targetInstance.rpcAddress, roomId, playerId)

        case 'reportAnimationEnd':
          return await this.rpcClient.reportAnimationEnd(
            targetInstanceId,
            targetInstance.rpcAddress,
            roomId,
            playerId,
            data,
          )

        case 'isTimerEnabled':
          return await this.rpcClient.isTimerEnabled(targetInstanceId, targetInstance.rpcAddress, roomId, playerId)

        case 'getPlayerTimerState':
          return await this.rpcClient.getPlayerTimerState(
            targetInstanceId,
            targetInstance.rpcAddress,
            roomId,
            playerId,
            data,
          )

        case 'getAllPlayerTimerStates':
          return await this.rpcClient.getAllPlayerTimerStates(
            targetInstanceId,
            targetInstance.rpcAddress,
            roomId,
            playerId,
          )

        case 'getTimerConfig':
          return await this.rpcClient.getTimerConfig(targetInstanceId, targetInstance.rpcAddress, roomId, playerId)

        case 'startAnimation':
          return await this.rpcClient.startAnimation(
            targetInstanceId,
            targetInstance.rpcAddress,
            roomId,
            playerId,
            data,
          )

        case 'endAnimation':
          return await this.rpcClient.endAnimation(targetInstanceId, targetInstance.rpcAddress, roomId, playerId, data)

        case 'force-terminate-battle':
          return await this.rpcClient.terminateBattle(
            targetInstanceId,
            targetInstance.rpcAddress,
            roomId,
            playerId,
            data.reason || 'abandon',
          )

        default:
          throw new Error(`Unknown action type: ${action}`)
      }
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? { message: error.message, stack: error.stack, name: error.name } : error,
          targetInstanceId,
          action,
          playerId,
        },
        'Error forwarding player action via RPC',
      )
      throw error
    }
  }

  /**
   * 发送响应到请求实例
   */
  private async sendForwardResponse(
    responseChannel: string,
    requestId: string,
    success: boolean,
    data?: any,
    error?: string,
  ): Promise<void> {
    try {
      const publisher = this.stateManager['redisManager'].getPublisher()
      await publisher.publish(
        responseChannel,
        JSON.stringify({
          requestId,
          success,
          data,
          error,
          timestamp: Date.now(),
        }),
      )
    } catch (err) {
      logger.error({ error: err, responseChannel, requestId }, 'Error sending forward response')
    }
  }

  /**
   * 检查房间是否在当前实例
   */
  private isRoomInCurrentInstance(roomState: RoomState): boolean {
    return roomState.instanceId === this.instanceId
  }

  /**
   * 获取本地Battle实例
   */
  private getLocalBattle(roomId: string): Battle | null {
    const localRoom = this.localRooms.get(roomId)
    return localRoom?.battle || null
  }

  /**
   * 创建本地Battle实例
   */
  private async createLocalBattle(roomState: RoomState, player1Data: any, player2Data: any): Promise<Battle> {
    const battle = new Battle(player1Data, player2Data, {
      showHidden: false,
      timerConfig: {
        enabled: true,
        turnTimeLimit: 30,
        totalTimeLimit: 1500,
        animationPauseEnabled: true,
        maxAnimationDuration: 20000,
      },
    })

    // 创建本地房间数据
    const players = roomState.sessions.map(sessionId => roomState.sessionPlayers[sessionId]).filter(Boolean)
    const localRoom: LocalRoomData = {
      id: roomState.id,
      battle,
      players: players,
      playersReady: new Set(),
      status: 'waiting',
      lastActive: Date.now(),
      battleRecordId: roomState.metadata?.battleRecordId,
    }

    this.localRooms.set(roomState.id, localRoom)
    this.localBattles.set(roomState.id, battle)

    // 更新活跃战斗房间数统计
    if (this.performanceTracker) {
      this.performanceTracker.updateActiveBattleRooms(this.localRooms.size)
    }

    // 设置战斗事件监听
    await this.setupBattleEventListeners(battle, roomState.id)

    // 不在这里启动战斗，等待所有玩家准备好后再启动
    logger.info({ roomId: roomState.id }, 'Batftle instance created, waiting for players to be ready')

    logger.info({ roomId: roomState.id }, 'Local battle instance created')
    return battle
  }

  /**
   * 设置战斗事件监听
   */
  private async setupBattleEventListeners(battle: Battle, roomId: string): Promise<void> {
    const localRoom = this.localRooms.get(roomId)
    if (!localRoom) {
      logger.error({ roomId }, 'Local room not found when setting up battle event listeners')
      return
    }

    // 获取房间状态以获取session信息
    const roomState = await this.stateManager.getRoomState(roomId)
    if (!roomState) {
      logger.error({ roomId }, 'Room state not found when setting up battle event listeners')
      return
    }

    // 监听战斗消息用于战报记录和战斗结束处理
    battle.registerListener(
      message => {
        // 记录战斗消息到战报（如果有战报服务）
        if (this.battleReportService && localRoom.battleRecordId) {
          this.battleReportService.recordBattleMessage(roomId, message)
        }

        // 处理战斗结束
        if (message.type === BattleMessageType.BattleEnd) {
          const battleEndData = message.data as { winner: string | null; reason: string }
          logger.info(
            { roomId, winner: battleEndData.winner, reason: battleEndData.reason },
            'Battle ended, starting cleanup',
          )
          this.handleBattleEnd(roomId, battleEndData)
        }
      },
      { showAll: true }, // 用于战报记录，显示所有信息
    )

    // 为每个玩家设置单独的监听器，发送各自视角的战斗事件（基于session）
    for (const sessionId of roomState.sessions) {
      const playerId = roomState.sessionPlayers[sessionId]
      if (!playerId) continue

      battle.registerListener(
        async message => {
          // 向该玩家的特定会话发送他们视角的战斗事件（跨集群转发）
          const result = await this.sendToPlayerSession(playerId, sessionId, 'battleEvent', message)
          if (!result) {
            logger.error({ roomId, playerId, sessionId, message }, 'Failed to send battle event to player session')
          }
        },
        { viewerId: playerId as playerId }, // 显示该玩家视角的信息
      )
    }
  }

  /**
   * 处理玩家选择数据
   */
  private processPlayerSelection(playerId: string, rawData: unknown): ReturnType<typeof SelectionParser.parse> {
    try {
      const selection = SelectionParser.parse(rawData)

      // 验证选择是否属于正确的玩家
      if (selection.player !== playerId) {
        throw new Error('PLAYER_ID_MISMATCH')
      }

      return selection
    } catch (error) {
      logger.error({ error, playerId, rawData }, 'Error processing player selection')
      throw new Error('INVALID_SELECTION_DATA')
    }
  }

  /**
   * 获取玩家名称
   */
  private async getPlayerName(playerId: string): Promise<string> {
    try {
      const container = getContainer()
      const playerRepo = container.get<PlayerRepository>(TYPES.PlayerRepository)

      const player = await playerRepo.getPlayerById(playerId)
      return player?.name || `Player ${playerId.slice(0, 8)}`
    } catch (error) {
      logger.error({ error, playerId }, 'Error getting player name')
      return `Player ${playerId.slice(0, 8)}`
    }
  }

  // === 本地Battle处理方法 ===

  /**
   * 本地处理玩家选择
   */
  async handleLocalPlayerSelection(roomId: string, playerId: string, data: any): Promise<{ status: string }> {
    const battle = this.getLocalBattle(roomId)
    if (!battle) {
      logger.error(
        { roomId, playerId, availableRooms: Array.from(this.localBattles.keys()) },
        'Battle not found for local player selection',
      )
      throw new Error('BATTLE_NOT_FOUND')
    }

    const selection = this.processPlayerSelection(playerId, data)

    if (!battle.setSelection(selection)) {
      logger.error({ roomId, playerId, selection }, 'Failed to set selection in battle')
      throw new Error('INVALID_SELECTION')
    }

    return { status: 'ACTION_ACCEPTED' }
  }

  /**
   * 本地处理状态获取
   */
  async handleLocalGetState(roomId: string, playerId: string): Promise<BattleState> {
    const battle = this.getLocalBattle(roomId)
    if (!battle) {
      throw new Error('BATTLE_NOT_FOUND')
    }

    const battleState = battle.getState(playerId as playerId, false)

    return battleState
  }

  /**
   * 本地处理选择获取
   */
  async handleLocalGetSelection(roomId: string, playerId: string): Promise<PlayerSelectionSchemaType[]> {
    const battle = this.getLocalBattle(roomId)
    if (!battle) {
      throw new Error('BATTLE_NOT_FOUND')
    }

    const availableSelections = battle.getAvailableSelection(playerId as playerId)
    const serializedSelections = availableSelections.map(v => SelectionParser.serialize(v))

    return serializedSelections
  }

  /**
   * 本地处理准备状态
   */
  async handleLocalReady(roomId: string, playerId: string): Promise<{ status: string }> {
    const localRoom = this.localRooms.get(roomId)
    if (!localRoom) {
      throw new Error('ROOM_NOT_FOUND')
    }

    // 标记玩家已准备
    localRoom.playersReady.add(playerId)
    localRoom.lastActive = Date.now()

    // 检查是否所有玩家都已准备
    const allPlayersReady = localRoom.players.every(pid => localRoom.playersReady.has(pid))

    if (allPlayersReady && localRoom.status === 'waiting') {
      // 启动战斗
      localRoom.status = 'active'
      localRoom.battle.startBattle().catch(error => {
        logger.error({ error, roomId }, 'Error starting local battle')
        localRoom.status = 'ended'
        this.cleanupLocalRoom(roomId)
      })

      logger.info({ roomId }, 'Local battle started')
    }

    return { status: 'READY' }
  }

  /**
   * 本地处理玩家放弃
   */
  async handleLocalPlayerAbandon(roomId: string, playerId: string): Promise<{ status: string }> {
    const battle = this.getLocalBattle(roomId)
    if (!battle) {
      throw new Error('BATTLE_NOT_FOUND')
    }

    // 调用战斗的放弃方法
    battle.abandonPlayer(playerId as playerId)

    // 清理本地房间
    await this.cleanupLocalRoom(roomId)

    logger.info({ roomId, playerId }, 'Local player abandon processed')
    return { status: 'ABANDONED' }
  }

  /**
   * 处理战斗结束
   */
  private async handleBattleEnd(
    roomId: string,
    battleEndData: { winner: string | null; reason: string },
  ): Promise<void> {
    try {
      const localRoom = this.localRooms.get(roomId)
      if (!localRoom) {
        logger.warn({ roomId }, 'Local room not found when handling battle end')
        return
      }

      // 更新本地房间状态
      localRoom.status = 'ended'
      localRoom.lastActive = Date.now()

      // 通知所有玩家房间关闭（基于session）
      const roomState = await this.stateManager.getRoomState(roomId)
      if (roomState) {
        for (const sessionId of roomState.sessions) {
          const playerId = roomState.sessionPlayers[sessionId]
          if (playerId) {
            await this.sendToPlayerSession(playerId, sessionId, 'roomClosed', { roomId })
          }
        }
      }

      // 延迟清理，给客户端一些时间处理战斗结束事件
      setTimeout(async () => {
        await this.cleanupLocalRoom(roomId)

        // 清理会话到房间的映射
        if (roomState) {
          await this.cleanupSessionRoomMappings(roomState)
        }

        // 从集群中移除房间状态
        await this.stateManager.removeRoomState(roomId)

        // 清理相关的缓存
        if (roomState) {
          for (const sessionId of roomState.sessions) {
            const playerId = roomState.sessionPlayers[sessionId]
            if (playerId) {
              this.timerStatusCache.delete(`${playerId}:timer_enabled`)
              this.clearPlayerRoomCache(playerId, sessionId)
              this.clearConnectionCache(playerId)
            }
          }
        }

        logger.info({ roomId, winner: battleEndData.winner, reason: battleEndData.reason }, 'Battle cleanup completed')
      }, 5000) // 5秒延迟
    } catch (error) {
      logger.error({ error, roomId }, 'Error handling battle end')
    }
  }

  /**
   * 清理本地房间
   */
  private async cleanupLocalRoom(roomId: string): Promise<void> {
    try {
      const localRoom = this.localRooms.get(roomId)
      if (localRoom) {
        // 清理战斗监听器
        localRoom.battle.clearListeners()

        // 从本地映射中移除
        this.localRooms.delete(roomId)
        this.localBattles.delete(roomId)

        // 更新活跃战斗房间数统计
        if (this.performanceTracker) {
          this.performanceTracker.updateActiveBattleRooms(this.localRooms.size)
        }

        logger.info({ roomId }, 'Local room cleaned up')
      }
    } catch (error) {
      logger.error({ error, roomId }, 'Error cleaning up local room')
      if (this.performanceTracker) {
        this.performanceTracker.recordError('room_cleanup_error', 'clusterBattleServer')
      }
    }
  }

  // === 本地跨实例处理方法 ===

  /**
   * 本地处理动画结束报告
   */
  async handleLocalReportAnimationEnd(roomId: string, playerId: string, data: any): Promise<{ status: string }> {
    const battle = this.getLocalBattle(roomId)
    if (!battle) {
      throw new Error('BATTLE_NOT_FOUND')
    }

    if (data.animationId) {
      battle.endAnimation(data.animationId, data.actualDuration)
    }

    return { status: 'SUCCESS' }
  }

  /**
   * 本地处理计时器启用检查
   */
  async handleLocalIsTimerEnabled(roomId: string, playerId: string): Promise<boolean> {
    const battle = this.getLocalBattle(roomId)
    if (!battle) {
      throw new Error('BATTLE_NOT_FOUND')
    }

    const timerEnabled = battle.isTimerEnabled()
    return timerEnabled
  }

  /**
   * 本地处理玩家计时器状态获取
   */
  async handleLocalGetPlayerTimerState(roomId: string, playerId: string, data: any): Promise<any> {
    const battle = this.getLocalBattle(roomId)
    if (!battle) {
      throw new Error('BATTLE_NOT_FOUND')
    }

    const targetPlayerId = data?.playerId || playerId
    const timerState = battle.getAllPlayerTimerStates().find(state => state.playerId === targetPlayerId) ?? null

    return timerState
  }

  /**
   * 本地处理所有玩家计时器状态获取
   */
  async handleLocalGetAllPlayerTimerStates(roomId: string, playerId: string): Promise<any[]> {
    const battle = this.getLocalBattle(roomId)
    if (!battle) {
      throw new Error('BATTLE_NOT_FOUND')
    }

    const allTimerStates = battle.getAllPlayerTimerStates()
    return allTimerStates
  }

  /**
   * 本地处理计时器配置获取
   */
  async handleLocalGetTimerConfig(roomId: string, playerId: string): Promise<any> {
    const battle = this.getLocalBattle(roomId)
    if (!battle) {
      throw new Error('BATTLE_NOT_FOUND')
    }

    const timerConfig = battle.getTimerConfig()
    return timerConfig
  }

  /**
   * 本地处理动画开始
   */
  async handleLocalStartAnimation(roomId: string, playerId: string, data: any): Promise<string> {
    const battle = this.getLocalBattle(roomId)
    if (!battle) {
      throw new Error('BATTLE_NOT_FOUND')
    }

    if (!data.source || !data.expectedDuration || !data.ownerId) {
      throw new Error('INVALID_ANIMATION_DATA')
    }

    const animationId = battle.startAnimation(data.source, data.expectedDuration, data.ownerId as playerId)

    return animationId
  }

  /**
   * 本地处理动画结束
   */
  async handleLocalEndAnimation(roomId: string, playerId: string, data: any): Promise<{ status: string }> {
    const battle = this.getLocalBattle(roomId)
    if (!battle) {
      throw new Error('BATTLE_NOT_FOUND')
    }

    if (data.animationId) {
      battle.endAnimation(data.animationId, data.actualDuration)
    }

    return { status: 'SUCCESS' }
  }

  /**
   * 强制终止战斗（处理断线等情况）
   */
  private async forceTerminateBattle(
    roomState: RoomState,
    playerId: string,
    reason: 'disconnect' | 'abandon',
  ): Promise<void> {
    try {
      logger.warn({ roomId: roomState.id, playerId, reason, instanceId: roomState.instanceId }, '强制终止战斗')

      // 如果战斗在当前实例，直接调用战斗逻辑
      if (roomState.instanceId === this.instanceId) {
        await this.handleLocalBattleTerminationInternal(roomState.id, playerId, reason)
      } else {
        // 通知正确的实例终止战斗
        await this.notifyInstanceBattleTermination(roomState.instanceId, roomState.id, playerId, reason)
      }

      // 更新集群状态
      roomState.status = 'ended'
      roomState.lastActive = Date.now()

      // 记录终止信息
      if (!roomState.metadata) {
        roomState.metadata = {}
      }
      roomState.metadata.terminatedBy = playerId
      roomState.metadata.terminatedAt = Date.now()
      roomState.metadata.terminationReason = reason

      await this.stateManager.setRoomState(roomState)

      // 通知所有玩家战斗结束（基于session）
      const players = roomState.sessions.map(sessionId => roomState.sessionPlayers[sessionId]).filter(Boolean)
      for (const sessionId of roomState.sessions) {
        const pid = roomState.sessionPlayers[sessionId]
        if (pid) {
          await this.sendToPlayerSession(pid, sessionId, 'battleEvent', {
            type: 'BattleEnd',
            data: {
              winner: players.find(p => p !== playerId) || null,
              reason: reason === 'disconnect' ? 'disconnect' : 'surrender',
            },
          })
          await this.sendToPlayerSession(pid, sessionId, 'roomClosed', { roomId: roomState.id })
        }
      }

      // 延迟清理房间
      setTimeout(async () => {
        await this.stateManager.removeRoomState(roomState.id)
        logger.info({ roomId: roomState.id, playerId, reason }, 'Battle termination completed')
      }, 2000)
    } catch (error) {
      logger.error({ error, roomId: roomState.id, playerId, reason }, 'Error force terminating battle')
    }
  }

  /**
   * 本地处理战斗终止 (内部方法)
   */
  private async handleLocalBattleTerminationInternal(
    roomId: string,
    playerId: string,
    reason: 'disconnect' | 'abandon',
  ): Promise<void> {
    try {
      const battle = this.getLocalBattle(roomId)
      if (battle) {
        // 调用战斗的放弃方法，这会触发战斗结束逻辑
        battle.abandonPlayer(playerId as playerId)
        logger.info({ roomId, playerId, reason }, 'Local battle terminated via abandonPlayer')
      }

      // 清理本地房间
      await this.cleanupLocalRoom(roomId)
    } catch (error) {
      logger.error({ error, roomId, playerId, reason }, 'Error handling local battle termination')
    }
  }

  /**
   * 本地处理战斗终止 (供RPC调用)
   */
  async handleLocalBattleTermination(roomId: string, playerId: string, reason: string): Promise<{ status: string }> {
    try {
      await this.handleLocalBattleTerminationInternal(roomId, playerId, reason as 'disconnect' | 'abandon')
      return { status: 'TERMINATED' }
    } catch (error) {
      logger.error({ error, roomId, playerId, reason }, 'Error in RPC battle termination')
      throw error
    }
  }

  /**
   * 通知其他实例终止战斗
   */
  private async notifyInstanceBattleTermination(
    instanceId: string,
    roomId: string,
    playerId: string,
    reason: 'disconnect' | 'abandon',
  ): Promise<void> {
    try {
      const publisher = this.stateManager['redisManager'].getPublisher()
      const channel = `instance:${instanceId}:battle-actions`

      await publisher.publish(
        channel,
        JSON.stringify({
          from: this.instanceId,
          timestamp: Date.now(),
          action: 'force-terminate-battle',
          roomId,
          playerId,
          reason,
        }),
      )
    } catch (error) {
      logger.error({ error, instanceId, roomId, playerId, reason }, 'Error notifying instance of battle termination')
    }
  }

  /**
   * 处理集群战斗放弃（简化版本）
   */
  private async handleClusterBattleAbandon(roomState: RoomState, playerId: string): Promise<void> {
    // 重定向到强制终止战斗逻辑
    await this.forceTerminateBattle(roomState, playerId, 'abandon')
  }

  /**
   * 通知其他实例玩家放弃
   */
  private async notifyInstancePlayerAbandon(instanceId: string, roomId: string, playerId: string): Promise<void> {
    try {
      const publisher = this.stateManager['redisManager'].getPublisher()
      const channel = `instance:${instanceId}:battle-actions`

      await publisher.publish(
        channel,
        JSON.stringify({
          from: this.instanceId,
          timestamp: Date.now(),
          action: 'player-abandon',
          roomId,
          playerId,
        }),
      )
    } catch (error) {
      logger.error({ error, instanceId, roomId, playerId }, 'Error notifying instance of player abandon')
    }
  }

  // === 错误处理方法 ===

  private handleBattleActionError(
    error: unknown,
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    ack?: AckResponse<{ status: 'ACTION_ACCEPTED' }>,
  ) {
    const errorResponse: ErrorResponse = {
      status: 'ERROR',
      code: 'BATTLE_ACTION_ERROR',
      details: error instanceof Error ? error.message : 'Battle action failed',
    }
    ack?.(errorResponse)
    logger.warn({ socketId: socket.id, error: error instanceof Error ? error.stack : error }, '战斗操作时发生错误')
  }

  private handleBattleStateError(
    error: unknown,
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    ack?: AckResponse<BattleState>,
  ) {
    const errorResponse: ErrorResponse = {
      status: 'ERROR',
      code: 'GET_STATE_ERROR',
      details: error instanceof Error ? error.message : 'Failed to get battle state',
    }
    ack?.(errorResponse)
    logger.warn({ socketId: socket.id, error: error instanceof Error ? error.stack : error }, '获取战斗状态时发生错误')
  }

  private handleBattleSelectionError(
    error: unknown,
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    ack?: AckResponse<PlayerSelectionSchemaType[]>,
  ) {
    const errorResponse: ErrorResponse = {
      status: 'ERROR',
      code: 'GET_SELECTION_ERROR',
      details: error instanceof Error ? error.message : 'Failed to get available selections',
    }
    ack?.(errorResponse)
    logger.warn({ socketId: socket.id, error: error instanceof Error ? error.stack : error }, '获取可用选择时发生错误')
  }

  // === 其他必要的方法 ===

  private async handleCancelMatchmaking(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    ack?: AckResponse<{ status: 'CANCELED' }>,
  ) {
    try {
      const playerId = socket.data.playerId
      if (!playerId) {
        throw new Error('PLAYER_ID_MISSING')
      }

      // 从集群匹配队列中移除
      const sessionId = socket.data.sessionId
      await this.stateManager.removeFromMatchmakingQueue(playerId, sessionId)

      // 更新匹配队列大小统计
      if (this.performanceTracker) {
        const queueSize = await this.stateManager.getMatchmakingQueueSize()
        this.performanceTracker.updateMatchmakingQueueSize(queueSize)
      }

      logger.info({ socketId: socket.id, playerId }, '玩家取消匹配')

      ack?.({
        status: 'SUCCESS',
        data: { status: 'CANCELED' },
      })
    } catch (error) {
      this.handleCancelError(error, socket, ack)
    }
  }

  private handleCancelError(
    error: unknown,
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    ack?: AckResponse<{ status: 'CANCELED' }>,
  ) {
    const errorResponse: ErrorResponse = {
      status: 'ERROR',
      code: 'CANCEL_FAILED',
      details: error instanceof Error ? error.message : '取消匹配失败',
    }

    ack?.(errorResponse)
    logger.warn({ socketId: socket.id, error: error instanceof Error ? error.stack : error }, '取消匹配时发生错误')
  }

  private async getCurrentState(): Promise<ServerState> {
    try {
      const stats = await this.stateManager.getClusterStats()
      return {
        onlinePlayers: stats.players.connected,
        matchmakingQueue: stats.matchmaking.queueSize,
        rooms: stats.rooms.total,
        playersInRooms: stats.rooms.active * 2, // 假设每个活跃房间有2个玩家
      }
    } catch (error) {
      logger.error({ error }, 'Error getting cluster state')
      return {
        onlinePlayers: 0,
        matchmakingQueue: 0,
        rooms: 0,
        playersInRooms: 0,
      }
    }
  }

  private async handleGetServerState(
    _socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    ack?: AckResponse<ServerState>,
  ) {
    try {
      const state = await this.getCurrentState()
      ack?.({
        status: 'SUCCESS',
        data: state,
      })
    } catch (error) {
      logger.error({ error }, 'Error handling get server state')
      ack?.({
        status: 'ERROR',
        code: 'GET_STATE_ERROR',
        details: 'Failed to get server state',
      })
    }
  }

  // === 集群感知的战斗逻辑处理 ===

  private async handlePlayerSelection(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    rawData: unknown,
    ack?: AckResponse<{ status: 'ACTION_ACCEPTED' }>,
  ) {
    try {
      const playerId = socket.data.playerId
      if (!playerId) {
        throw new Error('PLAYER_ID_MISSING')
      }

      // 获取玩家所在的房间
      const sessionId = socket.data.sessionId
      if (!sessionId) {
        throw new Error('SESSION_ID_MISSING')
      }

      const roomState = await this.getPlayerRoomFromCluster(playerId, sessionId)
      if (!roomState) {
        logger.warn(
          { playerId, sessionId, socketId: socket.id, instanceId: this.instanceId },
          'Player not found in any room for selection',
        )
        throw new Error('BATTLE_NOT_FOUND')
      }

      // 检查房间是否在当前实例
      if (!this.isRoomInCurrentInstance(roomState)) {
        // 转发到正确的实例并等待响应，传递roomId
        const result = await this.forwardPlayerAction(roomState.instanceId, 'submitPlayerSelection', playerId, {
          roomId: roomState.id,
          selection: rawData,
        })

        ack?.({
          status: 'SUCCESS',
          data: result,
        })
        return
      }

      // 在当前实例处理
      const result = await this.handleLocalPlayerSelection(roomState.id, playerId, rawData)

      ack?.({
        status: 'SUCCESS',
        data: { status: result.status as 'ACTION_ACCEPTED' },
      })
    } catch (error) {
      logger.error({ error, playerId: socket.data.playerId, socketId: socket.id }, 'Error in handlePlayerSelection')
      this.handleBattleActionError(error, socket, ack)
    }
  }

  private async handleGetState(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    ack?: AckResponse<BattleState>,
  ) {
    try {
      const playerId = socket.data.playerId
      if (!playerId) {
        throw new Error('PLAYER_ID_MISSING')
      }

      // 获取玩家所在的房间
      const sessionId = socket.data.sessionId
      if (!sessionId) {
        throw new Error('SESSION_ID_MISSING')
      }

      const roomState = await this.getPlayerRoomFromCluster(playerId, sessionId)
      if (!roomState) {
        logger.warn(
          { playerId, sessionId, socketId: socket.id, instanceId: this.instanceId },
          'Player not found in any room for getState',
        )
        throw new Error('BATTLE_NOT_FOUND')
      }

      logger.debug(
        {
          playerId,
          roomId: roomState.id,
          roomInstance: roomState.instanceId,
          currentInstance: this.instanceId,
          socketId: socket.id,
        },
        'Found player room for getState',
      )

      // 检查房间是否在当前实例
      if (!this.isRoomInCurrentInstance(roomState)) {
        logger.debug(
          {
            playerId,
            roomId: roomState.id,
            targetInstance: roomState.instanceId,
            currentInstance: this.instanceId,
          },
          'Forwarding getState to correct instance',
        )

        // 转发到正确的实例获取最新状态，传递roomId
        const result = await this.forwardPlayerAction(roomState.instanceId, 'getState', playerId, {
          roomId: roomState.id,
        })

        logger.debug(
          {
            playerId,
            roomId: roomState.id,
            targetInstance: roomState.instanceId,
            result: typeof result,
          },
          'getState forwarding completed',
        )

        ack?.({
          status: 'SUCCESS',
          data: result,
        })
        return
      }

      // 在当前实例处理
      logger.debug({ playerId, roomId: roomState.id }, 'Handling getState locally')
      const result = await this.handleLocalGetState(roomState.id, playerId)

      ack?.({
        status: 'SUCCESS',
        data: result,
      })

      logger.debug({ playerId, roomId: roomState.id }, 'Battle state retrieved in cluster mode')
    } catch (error) {
      logger.error({ error, playerId: socket.data.playerId, socketId: socket.id }, 'Error in handleGetState')
      this.handleBattleStateError(error, socket, ack)
    }
  }

  private async handleGetSelection(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    ack?: AckResponse<PlayerSelectionSchemaType[]>,
  ) {
    try {
      const playerId = socket.data.playerId
      if (!playerId) {
        throw new Error('PLAYER_ID_MISSING')
      }

      // 获取玩家所在的房间
      const sessionId = socket.data.sessionId
      if (!sessionId) {
        throw new Error('SESSION_ID_MISSING')
      }

      const roomState = await this.getPlayerRoomFromCluster(playerId, sessionId)
      if (!roomState) {
        throw new Error('NOT_IN_BATTLE')
      }

      // 检查房间是否在当前实例
      if (!this.isRoomInCurrentInstance(roomState)) {
        // 转发到正确的实例，传递roomId
        const result = await this.forwardPlayerAction(roomState.instanceId, 'getAvailableSelection', playerId, {
          roomId: roomState.id,
        })
        ack?.({
          status: 'SUCCESS',
          data: result,
        })
        return
      }

      // 在当前实例处理
      const result = await this.handleLocalGetSelection(roomState.id, playerId)

      ack?.({
        status: 'SUCCESS',
        data: result,
      })
    } catch (error) {
      this.handleBattleSelectionError(error, socket, ack)
    }
  }

  private async handleReady(socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>) {
    try {
      const playerId = socket.data.playerId
      if (!playerId) {
        logger.warn({ socketId: socket.id }, '玩家不在任何房间中，无法准备')
        return
      }

      // 获取玩家所在的房间
      const sessionId = socket.data.sessionId
      if (!sessionId) {
        logger.warn({ socketId: socket.id, playerId }, '会话ID缺失，无法准备')
        return
      }

      const roomState = await this.getPlayerRoomFromCluster(playerId, sessionId)
      if (!roomState) {
        logger.warn({ socketId: socket.id, playerId, sessionId }, '找不到房间，无法准备')
        return
      }

      // 检查房间是否在当前实例
      if (!this.isRoomInCurrentInstance(roomState)) {
        // 转发到正确的实例，传递roomId
        await this.forwardPlayerAction(roomState.instanceId, 'ready', playerId, { roomId: roomState.id })
        return
      }

      // 在当前实例处理
      await this.handleLocalReady(roomState.id, playerId)

      logger.info({ socketId: socket.id, roomId: roomState.id, playerId }, '玩家已准备')
    } catch (error) {
      logger.error({ error, socketId: socket.id }, 'Error handling ready in cluster mode')
    }
  }

  // === 集群感知的辅助方法 ===

  /**
   * 处理动画结束报告
   */
  private async handleReportAnimationEnd(socket: Socket, data: any) {
    try {
      const playerId = socket.data.playerId
      if (!playerId) {
        logger.warn({ socketId: socket.id }, 'Player ID missing for animation end report')
        return
      }

      // 获取玩家所在的房间
      const sessionId = socket.data.sessionId
      const roomState = await this.getPlayerRoomFromCluster(playerId, sessionId)
      if (!roomState) {
        logger.debug({ playerId, sessionId }, 'Player not in any room for animation end')
        return
      }

      // 如果房间在当前实例，处理动画结束
      if (this.isRoomInCurrentInstance(roomState)) {
        const battle = this.getLocalBattle(roomState.id)
        if (battle && data.animationId) {
          // 结束动画追踪
          battle.endAnimation(data.animationId, data.actualDuration)
        }
      } else {
        // 转发到正确的实例，传递roomId
        await this.forwardPlayerAction(roomState.instanceId, 'reportAnimationEnd', playerId, {
          ...data,
          roomId: roomState.id,
        })
      }

      logger.debug({ playerId, roomId: roomState.id }, 'Animation end reported')
    } catch (error) {
      logger.error({ error, socketId: socket.id }, 'Error handling animation end report')
    }
  }

  /**
   * 检查计时器是否启用
   */
  private async handleIsTimerEnabled(socket: Socket, ack: any) {
    try {
      const playerId = socket.data.playerId
      if (!playerId) {
        ack?.({ status: 'ERROR', code: 'PLAYER_ID_MISSING', details: 'Player ID is required' })
        return
      }

      // 检查缓存
      const cacheKey = `${playerId}:timer_enabled`
      const cached = this.timerStatusCache.get(cacheKey)
      const now = Date.now()

      if (cached && now - cached.timestamp < this.TIMER_CACHE_TTL) {
        ack?.({ status: 'SUCCESS', data: cached.enabled })
        return
      }

      // 获取玩家所在的房间
      const sessionId = socket.data.sessionId
      const roomState = await this.getPlayerRoomFromCluster(playerId, sessionId)
      if (!roomState) {
        // 缓存结果
        this.timerStatusCache.set(cacheKey, { enabled: false, timestamp: now })
        ack?.({ status: 'SUCCESS', data: false }) // 不在房间中，计时器不启用
        return
      }

      let timerEnabled: boolean
      // 如果房间在当前实例，获取实际状态
      if (this.isRoomInCurrentInstance(roomState)) {
        const battle = this.getLocalBattle(roomState.id)
        timerEnabled = battle?.isTimerEnabled() ?? false
      } else {
        try {
          // 转发到正确的实例，传递roomId
          timerEnabled = await this.forwardPlayerAction(roomState.instanceId, 'isTimerEnabled', playerId, {
            roomId: roomState.id,
          })

          // 跨实例转发成功，使用更长的缓存时间减少后续转发
          this.timerStatusCache.set(cacheKey, { enabled: timerEnabled, timestamp: now })
          ack?.({ status: 'SUCCESS', data: timerEnabled })
          return
        } catch (forwardError) {
          // 转发失败时，返回默认值并缓存较短时间
          logger.warn(
            {
              error:
                forwardError instanceof Error
                  ? { message: forwardError.message, name: forwardError.name }
                  : forwardError,
              playerId,
              roomId: roomState.id,
              targetInstance: roomState.instanceId,
            },
            'Failed to forward isTimerEnabled, returning default value',
          )

          timerEnabled = false // 默认值
          // 缓存失败结果，但使用更短的TTL
          this.timerStatusCache.set(cacheKey, { enabled: timerEnabled, timestamp: now - this.TIMER_CACHE_TTL + 1000 })
          ack?.({ status: 'SUCCESS', data: timerEnabled })
          return
        }
      }

      // 缓存结果
      this.timerStatusCache.set(cacheKey, { enabled: timerEnabled, timestamp: now })
      ack?.({ status: 'SUCCESS', data: timerEnabled })
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? { message: error.message, stack: error.stack, name: error.name } : error,
          socketId: socket.id,
        },
        'Error checking timer enabled status',
      )
      ack?.({ status: 'ERROR', code: 'TIMER_CHECK_ERROR', details: 'Failed to check timer status' })
    }
  }

  /**
   * 获取玩家计时器状态
   */
  private async handleGetPlayerTimerState(socket: Socket, data: any, ack: any) {
    try {
      const playerId = socket.data.playerId
      if (!playerId) {
        ack?.({ status: 'ERROR', code: 'PLAYER_ID_MISSING', details: 'Player ID is required' })
        return
      }

      // 获取玩家所在的房间
      const sessionId = socket.data.sessionId
      const roomState = await this.getPlayerRoomFromCluster(playerId, sessionId)
      if (!roomState) {
        ack?.({ status: 'SUCCESS', data: null }) // 不在房间中
        return
      }

      // 如果房间在当前实例，获取实际状态
      if (this.isRoomInCurrentInstance(roomState)) {
        const battle = this.getLocalBattle(roomState.id)
        const timerState = battle?.getAllPlayerTimerStates().find(state => state.playerId === playerId) ?? null
        ack?.({ status: 'SUCCESS', data: timerState })
      } else {
        // 转发到正确的实例，传递roomId
        const result = await this.forwardPlayerAction(roomState.instanceId, 'getPlayerTimerState', playerId, {
          ...data,
          roomId: roomState.id,
        })
        ack?.({ status: 'SUCCESS', data: result })
      }
    } catch (error) {
      logger.error({ error, socketId: socket.id }, 'Error getting player timer state')
      ack?.({ status: 'ERROR', code: 'TIMER_STATE_ERROR', details: 'Failed to get timer state' })
    }
  }

  /**
   * 获取所有玩家计时器状态
   */
  private async handleGetAllPlayerTimerStates(socket: Socket, ack: any) {
    try {
      const playerId = socket.data.playerId
      if (!playerId) {
        ack?.({ status: 'ERROR', code: 'PLAYER_ID_MISSING', details: 'Player ID is required' })
        return
      }

      // 获取玩家所在的房间
      const sessionId = socket.data.sessionId
      const roomState = await this.getPlayerRoomFromCluster(playerId, sessionId)
      if (!roomState) {
        ack?.({ status: 'SUCCESS', data: [] }) // 不在房间中
        return
      }

      // 如果房间在当前实例，获取实际状态
      if (this.isRoomInCurrentInstance(roomState)) {
        const battle = this.getLocalBattle(roomState.id)
        const allTimerStates = battle?.getAllPlayerTimerStates() ?? []
        ack?.({ status: 'SUCCESS', data: allTimerStates })
      } else {
        // 转发到正确的实例，传递roomId
        const result = await this.forwardPlayerAction(roomState.instanceId, 'getAllPlayerTimerStates', playerId, {
          roomId: roomState.id,
        })
        ack?.({ status: 'SUCCESS', data: result })
      }
    } catch (error) {
      logger.error({ error, socketId: socket.id }, 'Error getting all player timer states')
      ack?.({ status: 'ERROR', code: 'TIMER_STATES_ERROR', details: 'Failed to get timer states' })
    }
  }

  /**
   * 获取计时器配置
   */
  private async handleGetTimerConfig(socket: Socket, ack: any) {
    try {
      const playerId = socket.data.playerId
      if (!playerId) {
        ack?.({ status: 'ERROR', code: 'PLAYER_ID_MISSING', details: 'Player ID is required' })
        return
      }

      // 获取玩家所在的房间
      const sessionId = socket.data.sessionId
      const roomState = await this.getPlayerRoomFromCluster(playerId, sessionId)
      if (!roomState) {
        ack?.({ status: 'SUCCESS', data: {} }) // 不在房间中，返回空配置
        return
      }

      // 如果房间在当前实例，获取实际配置
      if (this.isRoomInCurrentInstance(roomState)) {
        const battle = this.getLocalBattle(roomState.id)
        const timerConfig = battle?.getTimerConfig() ?? {}
        ack?.({ status: 'SUCCESS', data: timerConfig })
      } else {
        // 转发到正确的实例，传递roomId
        const result = await this.forwardPlayerAction(roomState.instanceId, 'getTimerConfig', playerId, {
          roomId: roomState.id,
        })
        ack?.({ status: 'SUCCESS', data: result })
      }
    } catch (error) {
      logger.error({ error, socketId: socket.id }, 'Error getting timer config')
      ack?.({ status: 'ERROR', code: 'TIMER_CONFIG_ERROR', details: 'Failed to get timer config' })
    }
  }

  /**
   * 开始动画
   */
  private async handleStartAnimation(socket: Socket, data: any, ack: any) {
    try {
      const playerId = socket.data.playerId
      if (!playerId) {
        ack?.({ status: 'ERROR', code: 'PLAYER_ID_MISSING', details: 'Player ID is required' })
        return
      }

      // 获取玩家所在的房间
      const sessionId = socket.data.sessionId
      const roomState = await this.getPlayerRoomFromCluster(playerId, sessionId)
      if (!roomState) {
        ack?.({ status: 'ERROR', code: 'NOT_IN_BATTLE', details: 'Player not in battle' })
        return
      }

      // 如果房间在当前实例，处理动画开始
      if (this.isRoomInCurrentInstance(roomState)) {
        const battle = this.getLocalBattle(roomState.id)
        if (battle && data.source && data.expectedDuration && data.ownerId) {
          const animationId = battle.startAnimation(data.source, data.expectedDuration, data.ownerId as playerId)
          ack?.({ status: 'SUCCESS', data: animationId })
        } else {
          ack?.({ status: 'ERROR', code: 'BATTLE_NOT_FOUND', details: 'Battle instance not found or invalid data' })
        }
      } else {
        // 转发到正确的实例，传递roomId
        const result = await this.forwardPlayerAction(roomState.instanceId, 'startAnimation', playerId, {
          ...data,
          roomId: roomState.id,
        })
        ack?.({ status: 'SUCCESS', data: result })
      }
    } catch (error) {
      logger.error({ error, socketId: socket.id }, 'Error starting animation')
      ack?.({ status: 'ERROR', code: 'ANIMATION_START_ERROR', details: 'Failed to start animation' })
    }
  }

  /**
   * 结束动画
   */
  private async handleEndAnimation(socket: Socket, data: any) {
    try {
      const playerId = socket.data.playerId
      if (!playerId) {
        logger.warn({ socketId: socket.id }, 'Player ID missing for animation end')
        return
      }

      // 获取玩家所在的房间
      const sessionId = socket.data.sessionId
      const roomState = await this.getPlayerRoomFromCluster(playerId, sessionId)
      if (!roomState) {
        logger.debug({ playerId, sessionId }, 'Player not in any room for animation end')
        return
      }

      // 如果房间在当前实例，处理动画结束
      if (this.isRoomInCurrentInstance(roomState)) {
        const battle = this.getLocalBattle(roomState.id)
        if (battle && data.animationId) {
          battle.endAnimation(data.animationId, data.actualDuration)
        }
      } else {
        // 转发到正确的实例，传递roomId
        await this.forwardPlayerAction(roomState.instanceId, 'endAnimation', playerId, {
          ...data,
          roomId: roomState.id,
        })
      }

      logger.debug({ playerId, roomId: roomState.id }, 'Animation ended')
    } catch (error) {
      logger.error({ error, socketId: socket.id }, 'Error ending animation')
    }
  }

  /**
   * 验证原始玩家数据格式（不解析为实例）
   */
  private validateRawPlayerData(rawData: unknown): ReturnType<typeof PlayerSchema.parse> {
    try {
      // 使用PlayerSchema进行验证，但不解析为实例
      return PlayerSchema.parse(rawData)
    } catch (error) {
      if (error instanceof ZodError) {
        logger.warn({ error: error.errors, rawData }, 'Raw player data validation failed')
        throw new Error(`Invalid player data: ${error.errors.map(e => e.message).join(', ')}`)
      }
      throw new Error('Failed to validate raw player data')
    }
  }

  /**
   * 验证并解析玩家数据为Player实例
   */
  private validatePlayerData(rawData: unknown): ReturnType<typeof PlayerParser.parse> {
    try {
      // 使用PlayerParser进行验证和解析
      return PlayerParser.parse(rawData)
    } catch (error) {
      if (error instanceof ZodError) {
        logger.warn({ error: error.errors, rawData }, 'Player data validation failed')
        throw new Error(`Invalid player data: ${error.errors.map(e => e.message).join(', ')}`)
      }
      throw new Error('Failed to validate player data')
    }
  }

  private handleValidationError(error: unknown, _socket: Socket, ack?: any) {
    const response: ErrorResponse = {
      status: 'ERROR',
      code: 'VALIDATION_ERROR',
      details: error instanceof Error ? error.message : 'Invalid data format',
    }
    ack?.(response)
  }

  // === 匹配领导者选举 ===

  /**
   * 检查当前实例是否为匹配领导者
   * 使用分布式锁实现可靠的领导者选举
   */
  private async isMatchmakingLeader(): Promise<boolean> {
    try {
      // 使用分布式锁确保leader选举的原子性
      return await this.lockManager.withLock(
        LOCK_KEYS.MATCHMAKING_LEADER_ELECTION,
        async () => {
          // 获取所有健康的实例
          const instances = await this.stateManager.getInstances()
          const healthyInstances = instances
            .filter(instance => instance.status === 'healthy')
            .map(instance => instance.id)
            .sort() // 确保顺序一致

          if (healthyInstances.length === 0) {
            logger.warn({ instanceId: this.instanceId }, 'No healthy instances found, assuming leadership')
            return true
          }

          // 使用简单的哈希选举：选择排序后的第一个实例作为领导者
          const leaderId = healthyInstances[0]
          const isLeader = leaderId === this.instanceId

          logger.debug(
            {
              instanceId: this.instanceId,
              leaderId,
              isLeader,
              healthyInstances,
            },
            'Matchmaking leadership check',
          )

          return isLeader
        },
        { ttl: 5000, retryCount: 3, retryDelay: 50 }, // 短TTL，快速重试
      )
    } catch (error) {
      logger.error(
        {
          instanceId: this.instanceId,
          error: error instanceof Error ? error.message : error,
        },
        'Error checking matchmaking leadership, assuming not leader',
      )
      return false
    }
  }

  // === 生命周期管理 ===

  private setupAutoCleanup() {
    const cleaner = setInterval(async () => {
      try {
        await this.performClusterCleanup()
      } catch (error) {
        logger.error({ error }, 'Error in cluster cleanup')
      }
    }, this.CLEANUP_INTERVAL)

    this.io.engine.on('close', () => clearInterval(cleaner))
  }

  /**
   * 执行集群清理逻辑
   */
  private async performClusterCleanup(): Promise<void> {
    try {
      const now = Date.now()
      const timeout = 30 * 60 * 1000 // 30分钟超时

      // 获取所有房间并批量检查状态
      const client = this.stateManager['redisManager'].getClient()
      const roomIds = await client.smembers('arcadia:rooms')

      if (roomIds.length === 0) {
        // 没有房间需要清理，直接进行其他清理
        await this.performOtherCleanupTasks()
        return
      }

      // 批量获取房间状态，减少网络往返
      const pipeline = client.pipeline()
      for (const roomId of roomIds) {
        pipeline.hgetall(REDIS_KEYS.ROOM(roomId))
      }
      const results = await pipeline.exec()

      const roomsToCleanup: { roomId: string; instanceId: string }[] = []

      if (results) {
        for (let i = 0; i < results.length; i++) {
          const [err, roomData] = results[i]
          if (err || !roomData) continue

          try {
            const roomState = JSON.parse((roomData as any).data || '{}') as RoomState
            if (!roomState.id || !roomState.lastActive) continue

            // 检查房间是否超时
            if (now - roomState.lastActive > timeout) {
              logger.warn({ roomId: roomState.id, lastActive: roomState.lastActive }, 'Found inactive room for cleanup')
              roomsToCleanup.push({ roomId: roomState.id, instanceId: roomState.instanceId })
            }
          } catch (parseError) {
            logger.warn({ error: parseError, roomId: roomIds[i] }, 'Failed to parse room state during cleanup')
          }
        }
      }

      // 批量处理需要清理的房间
      await this.batchCleanupRooms(roomsToCleanup)

      // 执行其他清理任务
      await this.performOtherCleanupTasks()
    } catch (error) {
      logger.error({ error }, 'Error performing cluster cleanup')
    }
  }

  /**
   * 批量清理房间
   */
  private async batchCleanupRooms(roomsToCleanup: { roomId: string; instanceId: string }[]): Promise<void> {
    if (roomsToCleanup.length === 0) return

    // 按实例分组
    const roomsByInstance = new Map<string, string[]>()
    const localRooms: string[] = []

    for (const { roomId, instanceId } of roomsToCleanup) {
      if (instanceId === this.instanceId) {
        localRooms.push(roomId)
      } else {
        if (!roomsByInstance.has(instanceId)) {
          roomsByInstance.set(instanceId, [])
        }
        roomsByInstance.get(instanceId)!.push(roomId)
      }
    }

    // 清理本地房间
    if (localRooms.length > 0) {
      await Promise.all(localRooms.map(roomId => this.cleanupLocalRoom(roomId)))
      await Promise.all(localRooms.map(roomId => this.stateManager.removeRoomState(roomId)))
      logger.info({ count: localRooms.length }, 'Cleaned up local rooms')
    }

    // 通知其他实例清理房间
    for (const [instanceId, roomIds] of roomsByInstance.entries()) {
      await this.notifyInstanceBatchCleanup(instanceId, roomIds)
    }
  }

  /**
   * 执行其他清理任务
   */
  private async performOtherCleanupTasks(): Promise<void> {
    await Promise.all([this.cleanupExpiredConnections(), this.cleanupExpiredLocks(), this.cleanupAllCaches()])
  }

  /**
   * 通知其他实例进行清理
   */
  private async notifyInstanceCleanup(instanceId: string, roomId: string): Promise<void> {
    try {
      const publisher = this.stateManager['redisManager'].getPublisher()
      const channel = `instance:${instanceId}:cleanup`

      await publisher.publish(
        channel,
        JSON.stringify({
          from: this.instanceId,
          timestamp: Date.now(),
          action: 'cleanup-room',
          roomId,
        }),
      )
    } catch (error) {
      logger.error({ error, instanceId, roomId }, 'Error notifying instance cleanup')
    }
  }

  /**
   * 批量通知其他实例进行清理
   */
  private async notifyInstanceBatchCleanup(instanceId: string, roomIds: string[]): Promise<void> {
    try {
      const publisher = this.stateManager['redisManager'].getPublisher()
      const channel = `instance:${instanceId}:cleanup`

      await publisher.publish(
        channel,
        JSON.stringify({
          from: this.instanceId,
          timestamp: Date.now(),
          action: 'cleanup-rooms-batch',
          roomIds,
        }),
      )
      logger.info({ instanceId, count: roomIds.length }, 'Notified instance for batch room cleanup')
    } catch (error) {
      logger.error({ error, instanceId, roomIds }, 'Error notifying instance batch cleanup')
    }
  }

  /**
   * 清理所有缓存
   */
  private cleanupAllCaches(): void {
    this.cleanupTimerCache()
    this.cleanupPlayerRoomCache()
    this.cleanupConnectionCache()
  }

  /**
   * 清理玩家房间缓存
   */
  private cleanupPlayerRoomCache(): void {
    try {
      const now = Date.now()
      let cleanedCount = 0

      for (const [key, cached] of this.playerRoomCache.entries()) {
        if (now - cached.timestamp > this.PLAYER_ROOM_CACHE_TTL * 2) {
          this.playerRoomCache.delete(key)
          cleanedCount++
        }
      }

      if (cleanedCount > 0) {
        logger.info({ cleanedCount }, 'Cleaned up expired player room cache entries')
      }
    } catch (error) {
      logger.error({ error }, 'Error cleaning up player room cache')
    }
  }

  /**
   * 清理连接缓存
   */
  private cleanupConnectionCache(): void {
    try {
      const now = Date.now()
      let cleanedCount = 0

      for (const [key, cached] of this.connectionCache.entries()) {
        if (now - cached.timestamp > this.CONNECTION_CACHE_TTL * 2) {
          this.connectionCache.delete(key)
          cleanedCount++
        }
      }

      if (cleanedCount > 0) {
        logger.info({ cleanedCount }, 'Cleaned up expired connection cache entries')
      }
    } catch (error) {
      logger.error({ error }, 'Error cleaning up connection cache')
    }
  }

  /**
   * 更新玩家房间缓存
   */
  private updatePlayerRoomCache(playerId: string, sessionId: string, roomId: string): void {
    const cacheKey = `${playerId}:${sessionId}`
    this.playerRoomCache.set(cacheKey, { roomId, timestamp: Date.now() })
  }

  /**
   * 清除玩家房间缓存
   */
  private clearPlayerRoomCache(playerId: string, sessionId: string): void {
    const cacheKey = `${playerId}:${sessionId}`
    this.playerRoomCache.delete(cacheKey)
  }

  /**
   * 清除连接缓存
   */
  private clearConnectionCache(playerId: string): void {
    const cacheKey = `connections:${playerId}`
    this.connectionCache.delete(cacheKey)
  }

  /**
   * 创建会话到房间的映射索引
   */
  private async createSessionRoomMappings(roomState: RoomState): Promise<void> {
    try {
      const client = this.stateManager['redisManager'].getClient()

      for (const sessionId of roomState.sessions) {
        const playerId = roomState.sessionPlayers[sessionId]
        if (playerId) {
          const sessionRoomKey = `session:rooms:${playerId}:${sessionId}`
          await client.sadd(sessionRoomKey, roomState.id)
          // 设置过期时间，防止映射泄漏
          await client.expire(sessionRoomKey, 24 * 60 * 60) // 24小时过期
        }
      }
    } catch (error) {
      logger.error({ error, roomId: roomState.id }, 'Error creating session room mappings')
    }
  }

  /**
   * 清理会话到房间的映射索引
   */
  private async cleanupSessionRoomMappings(roomState: RoomState): Promise<void> {
    try {
      const client = this.stateManager['redisManager'].getClient()

      for (const sessionId of roomState.sessions) {
        const playerId = roomState.sessionPlayers[sessionId]
        if (playerId) {
          const sessionRoomKey = `session:rooms:${playerId}:${sessionId}`
          await client.srem(sessionRoomKey, roomState.id)
        }
      }
    } catch (error) {
      logger.error({ error, roomId: roomState.id }, 'Error cleaning up session room mappings')
    }
  }

  /**
   * 清理过期的玩家连接
   */
  private async cleanupExpiredConnections(): Promise<void> {
    try {
      const now = Date.now()
      const timeout = 10 * 60 * 1000 // 10分钟超时

      const client = this.stateManager['redisManager'].getClient()

      // 获取当前匹配队列中的所有玩家会话，避免清理正在匹配的玩家连接
      const matchmakingQueue = await this.stateManager.getMatchmakingQueue()
      const playersInQueue = new Set<string>()
      for (const entry of matchmakingQueue) {
        if (entry.sessionId) {
          playersInQueue.add(`${entry.playerId}:${entry.sessionId}`)
        }
      }

      // 获取所有玩家的session连接键
      const allSessionKeys = await client.keys(REDIS_KEYS.PLAYER_SESSION_CONNECTIONS('*'))

      if (allSessionKeys.length === 0) {
        return
      }

      // 批量获取所有玩家的连接信息
      const pipeline = client.pipeline()
      const playerIds: string[] = []

      for (const sessionKey of allSessionKeys) {
        // 从key中提取playerId: player:sessions:connections:playerId
        const playerId = sessionKey.split(':').pop()
        if (playerId) {
          playerIds.push(playerId)
          pipeline.smembers(sessionKey)
        }
      }

      const results = await pipeline.exec()
      const connectionsToRemove: { playerId: string; sessionId: string }[] = []

      if (results) {
        for (let i = 0; i < results.length; i++) {
          const [err, sessionIds] = results[i]
          if (err || !sessionIds || !Array.isArray(sessionIds)) continue

          const playerId = playerIds[i]
          if (!playerId) continue

          // 批量获取该玩家所有会话的连接详情
          const sessionPipeline = client.pipeline()
          for (const sessionId of sessionIds) {
            sessionPipeline.hgetall(REDIS_KEYS.PLAYER_SESSION_CONNECTION(playerId, sessionId))
          }

          const sessionResults = await sessionPipeline.exec()
          if (!sessionResults) continue

          for (let j = 0; j < sessionResults.length; j++) {
            const [sessionErr, connectionData] = sessionResults[j]
            if (sessionErr || !connectionData) continue

            const sessionId = sessionIds[j]
            const playerSessionKey = `${playerId}:${sessionId}`

            // 跳过正在匹配队列中的玩家会话
            if (playersInQueue.has(playerSessionKey)) {
              continue
            }

            try {
              const connection = JSON.parse((connectionData as any).data || '{}')
              if (connection.lastSeen && now - connection.lastSeen > timeout) {
                connectionsToRemove.push({ playerId, sessionId })
              }
            } catch (parseError) {
              logger.warn({ error: parseError, playerId, sessionId }, 'Failed to parse connection data during cleanup')
              // 如果解析失败，也标记为需要清理
              connectionsToRemove.push({ playerId, sessionId })
            }
          }
        }
      }

      // 批量移除过期连接
      if (connectionsToRemove.length > 0) {
        await Promise.all(
          connectionsToRemove.map(({ playerId, sessionId }) =>
            this.stateManager.removePlayerConnection(playerId, sessionId),
          ),
        )
        logger.info({ count: connectionsToRemove.length }, 'Cleaned up expired player connections')
      }

      // 清理连接缓存中对应的条目
      for (const { playerId } of connectionsToRemove) {
        this.connectionCache.delete(`connections:${playerId}`)
      }
    } catch (error) {
      logger.error({ error }, 'Error cleaning up expired connections')
    }
  }

  /**
   * 清理过期的分布式锁
   */
  private async cleanupExpiredLocks(): Promise<void> {
    try {
      const cleanedCount = await this.lockManager.cleanupExpiredLocks()
      if (cleanedCount > 0) {
        logger.info({ cleanedCount }, 'Cleaned up expired distributed locks')
      }
    } catch (error) {
      logger.error({ error }, 'Error cleaning up expired locks')
    }
  }

  /**
   * 清理过期的计时器缓存
   */
  private cleanupTimerCache(): void {
    try {
      const now = Date.now()
      let cleanedCount = 0

      for (const [key, cached] of this.timerStatusCache.entries()) {
        if (now - cached.timestamp > this.TIMER_CACHE_TTL * 2) {
          // 清理超过2倍TTL的缓存
          this.timerStatusCache.delete(key)
          cleanedCount++
        }
      }

      if (cleanedCount > 0) {
        logger.info({ cleanedCount }, 'Cleaned up expired timer cache entries')
      }
    } catch (error) {
      logger.error({ error }, 'Error cleaning up timer cache')
    }
  }

  private setupHeartbeatSystem() {
    const timer = setInterval(() => {
      const now = Date.now()
      this.players.forEach((player, socketId) => {
        if (now - player.lastPing > this.HEARTBEAT_INTERVAL * 2) {
          logger.warn({ socketId }, '心跳丢失，断开连接')
          player.socket.disconnect(true)
          this.removePlayer(socketId)
        }
      })
    }, this.HEARTBEAT_INTERVAL)

    this.io.engine.on('close', () => clearInterval(timer))
  }

  /**
   * 注册玩家连接（支持多会话）
   */
  private async registerPlayerConnection(socket: Socket) {
    const playerId = socket.data.playerId
    const sessionId = socket.data.sessionId

    // 注册本地socket连接
    this.players.set(socket.id, {
      socket,
      lastPing: Date.now(),
      heartbeatTimer: setInterval(() => {
        socket.emit('ping')
      }, this.HEARTBEAT_INTERVAL),
    })

    // 更新集群中的玩家连接状态
    if (playerId) {
      try {
        const connection: PlayerConnection = {
          instanceId: this.instanceId,
          socketId: socket.id,
          lastSeen: Date.now(),
          status: 'connected',
          sessionId: sessionId,
          metadata: {
            userAgent: socket.handshake.headers['user-agent'],
            ip: socket.handshake.address,
          },
        }

        await this.stateManager.setPlayerConnection(playerId, connection)
      } catch (error) {
        logger.error({ error, playerId, sessionId }, 'Failed to register player connection')
      }
    }
  }

  /**
   * 检查玩家是否还有其他活跃连接（支持多会话）
   */
  private async hasOtherActiveConnections(
    playerId: string,
    excludeSocketId: string,
    excludeSessionId?: string,
  ): Promise<boolean> {
    try {
      // 首先检查本地连接（最快）
      for (const [socketId, playerMeta] of this.players.entries()) {
        if (
          socketId !== excludeSocketId &&
          playerMeta.socket.data.playerId === playerId &&
          playerMeta.socket.data.sessionId !== excludeSessionId
        ) {
          return true
        }
      }

      // 检查缓存的连接信息
      const cacheKey = `connections:${playerId}`
      const cached = this.connectionCache.get(cacheKey)
      const now = Date.now()

      let sessionConnections: any[]
      if (cached && now - cached.timestamp < this.CONNECTION_CACHE_TTL) {
        sessionConnections = cached.connections
      } else {
        // 缓存过期或不存在，从集群获取
        sessionConnections = await this.stateManager.getPlayerSessionConnections(playerId)
        // 更新缓存
        this.connectionCache.set(cacheKey, { connections: sessionConnections, timestamp: now })
      }

      // 检查集群中该玩家的所有会话连接
      for (const conn of sessionConnections) {
        if (conn.status === 'connected' && conn.socketId !== excludeSocketId && conn.sessionId !== excludeSessionId) {
          return true
        }
      }

      return false
    } catch (error) {
      logger.error({ error, playerId, excludeSessionId }, 'Error checking other active connections')
      return false
    }
  }

  private removePlayer(socketId: string) {
    const player = this.players.get(socketId)
    if (player?.heartbeatTimer) {
      clearInterval(player.heartbeatTimer)
    }
    this.players.delete(socketId)
  }

  async cleanup(): Promise<void> {
    try {
      logger.info('开始清理 ClusterBattleServer 资源')

      // 清理RPC服务器（只有自己创建的才停止）
      if (this.rpcServer && !this.isRpcServerInjected) {
        await this.rpcServer.stop()
        logger.info('RPC server stopped')
      } else if (this.rpcServer && this.isRpcServerInjected) {
        logger.info('Skipping RPC server stop (injected server managed externally)')
      }

      // 清理RPC客户端连接
      if (this.rpcClient) {
        this.rpcClient.closeAllClients()
        logger.info('RPC client connections closed')
      }

      // 清理所有玩家连接
      this.players.forEach((player, _socketId) => {
        if (player.heartbeatTimer) {
          clearInterval(player.heartbeatTimer)
        }
        player.socket.disconnect(true)
      })
      this.players.clear()

      // 清理所有本地房间
      const localRoomIds = Array.from(this.localRooms.keys())
      await Promise.all(localRoomIds.map(roomId => this.cleanupLocalRoom(roomId)))

      // 清理战报服务
      if (this.battleReportService) {
        await this.battleReportService.cleanup()
      }

      // 清理跨实例监听器
      const subscriber = this.stateManager['redisManager'].getSubscriber()
      await subscriber.unsubscribe(`instance:${this.instanceId}:battle-actions`)
      await subscriber.unsubscribe(`instance:${this.instanceId}:cleanup`)
      await subscriber.unsubscribe(`instance:${this.instanceId}:responses`)

      logger.info('ClusterBattleServer 资源清理完成')
    } catch (error) {
      logger.error({ error }, 'Error during ClusterBattleServer cleanup')
    }
  }
}
