import { Battle, setGlobalLogger } from '@arcadia-eternity/battle'
import { type BattleState, BattleMessageType, type playerId } from '@arcadia-eternity/const'
import { PlayerParser, SelectionParser } from '@arcadia-eternity/parser'
import type {
  AckResponse,
  ClientToServerEvents,
  ErrorResponse,
  ServerState,
  ServerToClientEvents,
  SuccessResponse,
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
import type { RoomState, MatchmakingEntry, PlayerConnection, ServiceInstance } from './types'
import { REDIS_KEYS } from './types'
import { BattleRpcServer } from './battleRpcServer'
import { BattleRpcClient } from './battleRpcClient'
import { TimerEventBatcher } from '../timer/timerEventBatcher'
import { TTLHelper } from './ttlConfig'

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

type DisconnectedPlayerInfo = {
  playerId: string
  sessionId: string
  roomId: string
  disconnectTime: number
  graceTimer: ReturnType<typeof setTimeout>
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
  private readonly DISCONNECT_GRACE_PERIOD = 60000 // 60秒掉线宽限期
  private readonly HEARTBEAT_INTERVAL = 5000
  private readonly players = new Map<string, PlayerMeta>()
  private battleReportService?: BattleReportService
  private performanceTracker?: PerformanceTracker
  private instanceId: string

  // 本地Battle实例管理
  private readonly localBattles = new Map<string, Battle>() // roomId -> Battle
  private readonly localRooms = new Map<string, LocalRoomData>() // roomId -> room data
  private readonly disconnectedPlayers = new Map<string, DisconnectedPlayerInfo>() // 掉线玩家管理

  // 新的Timer缓存和批处理系统
  private readonly timerEventBatcher: TimerEventBatcher

  // 保留旧的缓存用于兼容性（逐步迁移）
  private readonly timerStatusCache = new Map<string, { enabled: boolean; timestamp: number }>()
  private readonly TIMER_CACHE_TTL = 30000 // 30秒缓存，大幅减少跨实例调用

  // RPC相关
  private rpcServer?: BattleRpcServer
  private rpcClient: BattleRpcClient
  private rpcPort?: number
  private isRpcServerInjected = false

  // 批量消息处理相关
  private readonly messageBatches = new Map<
    string,
    { messages: any[]; timer: ReturnType<typeof setTimeout>; createdAt: number }
  >() // sessionKey -> batch
  private readonly BATCH_SIZE = 15 // 批量大小（进一步减少，避免Redis积压）
  private readonly BATCH_TIMEOUT = 50 // 批量超时时间（减少到50毫秒，更快发送）
  private readonly MAX_BATCH_AGE = 3000 // 批次最大存活时间（减少到3秒，更快清理）

  // 需要立即发送的消息类型（重要消息和需要玩家输入的消息）
  private readonly IMMEDIATE_MESSAGE_TYPES = new Set([
    'BATTLE_START',
    'BATTLE_END',
    'TURN_ACTION', // 需要玩家选择行动
    'FORCED_SWITCH', // 需要玩家强制切换
    'FAINT_SWITCH', // 需要玩家击破奖励切换
    'INVALID_ACTION', // 无效行动提示
    'ERROR', // 错误消息
  ])

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

    // 初始化Timer批处理系统
    this.timerEventBatcher = new TimerEventBatcher(async (sessionKey: string, eventType: string, data: any) => {
      const [playerId, sessionId] = sessionKey.split(':')
      await this.sendToPlayerSession(playerId, sessionId, eventType, data)
    })

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
    this.setupBatchCleanupTask()
    this.setupAutoUpdateState()
    this.setupAutoCleanup()
    this.setupClusterEventHandlers()
    this.setupCrossInstanceActionListener()
    this.setupLeaderElectionMonitoring()
    this.setupInstanceExpirationWatcher()
    this.setupRoomCleanupListener()

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

        console.log('🔍 Middleware received query:', socket.handshake.query)
        console.log('🔍 Extracted:', { playerId, sessionId })

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

        // 处理 sessionId
        if (!sessionId) {
          // 如果客户端没有提供sessionId，生成一个新的
          const newSessionId = nanoid()
          console.log('🆔 No sessionId provided, generating new one:', newSessionId)
          socket.data.sessionId = newSessionId
        } else {
          console.log('🆔 Client provided sessionId:', sessionId)
          // 对于刷新重连场景，直接使用客户端提供的 sessionId
          // 不进行严格验证，因为断线时 session 可能已被清理
          socket.data.sessionId = sessionId
          console.log('🆔 Using client sessionId:', sessionId)
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
    }, 30000)
  }

  private setupConnectionHandlers() {
    this.io.on('connection', async socket => {
      console.log('🔥 NEW CONNECTION DETECTED!', socket.id)
      logger.info(
        {
          socketId: socket.id,
          playerId: socket.data.playerId,
          sessionId: socket.data.sessionId,
          hasPlayerId: !!socket.data.playerId,
          hasSessionId: !!socket.data.sessionId,
        },
        '🔥 玩家连接',
      )

      await this.registerPlayerConnection(socket)

      // 检查是否是重连
      logger.info(
        {
          socketId: socket.id,
          playerId: socket.data.playerId,
          sessionId: socket.data.sessionId,
        },
        '开始检查重连',
      )

      const reconnectInfo = await this.handlePlayerReconnect(socket)

      logger.info(
        {
          socketId: socket.id,
          reconnectInfo,
        },
        '重连检查结果',
      )

      if (reconnectInfo.isReconnect) {
        logger.info(
          { socketId: socket.id, playerId: socket.data.playerId, sessionId: socket.data.sessionId },
          '玩家重连处理完成',
        )

        // 通知客户端需要跳转到战斗页面
        if (reconnectInfo.roomId) {
          // 在发送重连测试消息之前，再次验证房间状态
          const currentRoomState = await this.stateManager.getRoomState(reconnectInfo.roomId)

          if (currentRoomState && currentRoomState.status === 'active') {
            // 获取完整的战斗状态数据，避免客户端需要额外调用 getState
            let fullBattleState = null
            try {
              // 检查房间是否在当前实例
              if (this.isRoomInCurrentInstance(currentRoomState)) {
                // 房间在当前实例，直接获取本地战斗状态
                const battle = this.getLocalBattle(reconnectInfo.roomId)
                if (battle) {
                  fullBattleState = battle.getState(socket.data.playerId! as playerId, false)
                }
              } else {
                // 房间在其他实例，通过跨实例调用获取战斗状态
                logger.debug(
                  {
                    roomId: reconnectInfo.roomId,
                    playerId: socket.data.playerId,
                    roomInstance: currentRoomState.instanceId,
                    currentInstance: this.instanceId,
                  },
                  '房间在其他实例，通过跨实例调用获取战斗状态',
                )

                fullBattleState = await this.forwardPlayerAction(
                  currentRoomState.instanceId,
                  'getState',
                  socket.data.playerId!,
                  { roomId: reconnectInfo.roomId },
                )
              }
            } catch (error) {
              logger.warn(
                { error, roomId: reconnectInfo.roomId, playerId: socket.data.playerId },
                '获取战斗状态失败，将发送不包含状态数据的重连事件',
              )
            }

            socket.emit('battleReconnect', {
              roomId: reconnectInfo.roomId,
              shouldRedirect: true,
              battleState: 'active',
              // 包含完整的战斗状态数据，避免客户端额外调用 getState
              fullBattleState: fullBattleState || undefined,
            })

            // 测试消息发送机制是否正常工作
            const testResult = await this.sendToPlayerSession(
              socket.data.playerId!,
              socket.data.sessionId!,
              'reconnectTest',
              { message: 'Connection test after reconnect', timestamp: Date.now() },
            )

            logger.info(
              {
                socketId: socket.id,
                playerId: socket.data.playerId,
                sessionId: socket.data.sessionId,
                roomId: reconnectInfo.roomId,
                testResult,
                hasBattleState: !!fullBattleState,
              },
              '重连后消息发送测试结果',
            )
          } else {
            logger.info(
              {
                socketId: socket.id,
                playerId: socket.data.playerId,
                sessionId: socket.data.sessionId,
                roomId: reconnectInfo.roomId,
                currentStatus: currentRoomState?.status || 'not_found',
              },
              '房间状态已变更，跳过重连测试消息发送',
            )
          }
        }
      }

      socket.on('pong', async () => {
        const player = this.players.get(socket.id)
        if (player) player.lastPing = Date.now()

        // 更新集群中的玩家连接活跃时间（异步执行，不阻塞pong响应）
        const playerId = socket.data.playerId
        const sessionId = socket.data.sessionId

        if (!playerId || !sessionId) return

        // 异步更新玩家连接的lastSeen时间戳，不阻塞pong处理
        setImmediate(async () => {
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
        })

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

      // 先检查该session是否在战斗中（在清理任何数据之前）
      // 优先检查本地房间，因为本地状态更可靠
      const localRoomId = this.findPlayerInLocalRooms(playerId, sessionId)
      let roomState = null

      if (localRoomId) {
        const localRoom = this.localRooms.get(localRoomId)
        if (localRoom && localRoom.status === 'active') {
          // 构造房间状态对象
          roomState = { id: localRoomId, status: 'active' as const }
          logger.info({ playerId, sessionId, roomId: localRoomId }, '在本地房间中找到活跃战斗')
        }
      }

      // 如果本地没找到，再查询集群状态
      if (!roomState) {
        roomState = await this.getPlayerRoomFromCluster(playerId, sessionId)
      }

      if (roomState && roomState.status === 'active') {
        // 在战斗中掉线，启动宽限期
        // 更新连接状态为断开，但保持映射关系以便重连
        logger.info({ playerId, sessionId, roomId: roomState.id }, '玩家在战斗中掉线，启动宽限期')

        // 异步更新连接状态，不阻塞主流程
        this.updateDisconnectedPlayerState(playerId, sessionId).catch((error: any) => {
          logger.error({ error, playerId, sessionId }, '更新断开连接状态失败')
        })

        await this.startDisconnectGracePeriod(playerId, sessionId, roomState.id)
      } else {
        // 确认不在战斗中，才清理连接信息
        logger.info({ playerId, sessionId }, '玩家会话断线，但该会话不在任何战斗中，清理连接信息')

        // 从集群状态中移除玩家连接
        await this.stateManager.removePlayerConnection(playerId, sessionId)
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

  private async updateDisconnectedPlayerState(playerId: string, sessionId: string): Promise<void> {
    try {
      const existingConnection = await this.stateManager.getPlayerConnectionBySession(playerId, sessionId)
      if (existingConnection) {
        const disconnectedConnection: PlayerConnection = {
          ...existingConnection,
          status: 'disconnected',
          lastSeen: Date.now(),
          metadata: {
            ...existingConnection.metadata,
            disconnectedAt: Date.now(),
            reason: 'battle_disconnect',
          },
        }
        await this.stateManager.setPlayerConnection(playerId, disconnectedConnection)
        logger.info({ playerId, sessionId }, '已更新连接状态为断开，保持映射关系')
      }
    } catch (error) {
      logger.error({ error, playerId, sessionId }, '更新断开连接状态失败')
      throw error
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
    socket.on('ready', ack => this.handleReady(socket, ack))
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
        case 'instance:leave':
          this.handleInstanceLeave(event.data)
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

  /**
   * 在本地房间中查找玩家
   */
  private findPlayerInLocalRooms(playerId: string, sessionId: string): string | null {
    for (const [roomId, localRoom] of this.localRooms.entries()) {
      if (localRoom.status === 'active') {
        // 检查玩家是否在这个房间中
        if (localRoom.players.includes(playerId)) {
          logger.debug({ playerId, sessionId, roomId }, '在本地房间中找到玩家')
          return roomId
        }
      }
    }
    return null
  }

  private async handleClusterPlayerDisconnect(data: { playerId: string; instanceId: string }) {
    if (data.instanceId !== this.instanceId) {
      // Player disconnected from another instance
    }
  }

  /**
   * 处理实例离开事件，清理该实例的所有房间
   */
  private async handleInstanceLeave(data: { instanceId: string }) {
    const { instanceId } = data

    // 跳过当前实例
    if (instanceId === this.instanceId) {
      return
    }

    logger.warn({ instanceId }, 'Instance left cluster, cleaning up its rooms')

    try {
      // 获取所有房间 - 使用私有方法访问
      const allRooms = await this.stateManager['getRooms']()

      // 找到属于离开实例的房间
      const orphanedRooms = allRooms.filter((room: any) => room.instanceId === instanceId)

      if (orphanedRooms.length === 0) {
        logger.info({ instanceId }, 'No orphaned rooms found for left instance')
        return
      }

      logger.warn(
        { instanceId, orphanedRoomCount: orphanedRooms.length, roomIds: orphanedRooms.map((r: any) => r.id) },
        'Found orphaned rooms, starting cleanup',
      )

      // 批量清理孤立房间
      for (const room of orphanedRooms) {
        await this.cleanupOrphanedRoomState(room)
      }

      logger.info(
        { instanceId, cleanedRoomCount: orphanedRooms.length },
        'Completed cleanup of orphaned rooms from left instance',
      )
    } catch (error) {
      logger.error({ error, instanceId }, 'Error cleaning up rooms from left instance')
    }
  }

  /**
   * 清理孤立房间状态
   */
  private async cleanupOrphanedRoomState(room: any): Promise<void> {
    try {
      const roomId = room.id
      const targetInstanceId = room.instanceId

      logger.info({ roomId, instanceId: targetInstanceId }, 'Cleaning up orphaned room state')

      // 通知目标实例房间被清理（如果实例恢复了）
      await this.notifyRoomCleanup(targetInstanceId, roomId)

      // 清理房间状态
      await this.stateManager.removeRoomState(roomId)

      // 清理会话房间映射
      if (room.sessions && room.sessionPlayers) {
        for (const sessionId of room.sessions) {
          const sessionPlayerId = room.sessionPlayers[sessionId]
          if (sessionPlayerId) {
            // 清理会话房间映射在 Redis 中已通过 removeRoomState 处理
          }
        }
      }

      logger.info({ roomId, targetInstanceId }, 'Orphaned room state cleaned up successfully')
    } catch (error) {
      logger.error({ error, roomId: room.id }, 'Error cleaning up orphaned room state')
    }
  }

  /**
   * 通知目标实例其房间被清理
   */
  private async notifyRoomCleanup(targetInstanceId: string, roomId: string): Promise<void> {
    try {
      // 发布房间清理通知
      const publisher = this.stateManager['redisManager'].getPublisher()
      const channel = `instance:${targetInstanceId}:room-cleanup`

      const notification = {
        roomId,
        cleanedBy: this.instanceId,
        timestamp: Date.now(),
        reason: 'instance_crash',
      }

      await publisher.publish(channel, JSON.stringify(notification))

      logger.debug({ targetInstanceId, roomId, cleanedBy: this.instanceId }, 'Sent room cleanup notification')
    } catch (error) {
      logger.error({ error, targetInstanceId, roomId }, 'Failed to send room cleanup notification')
    }
  }

  private async handleClusterMatchmakingJoin(entry: MatchmakingEntry) {
    const startTime = Date.now()
    logger.info({ playerId: entry.playerId, sessionId: entry.sessionId }, 'Received cluster matchmaking join event')

    // 只有指定的匹配实例才处理匹配逻辑，避免多实例竞争
    const leadershipCheckStart = Date.now()
    const isMatchmakingLeader = await this.isMatchmakingLeader()
    const leadershipCheckDuration = Date.now() - leadershipCheckStart

    logger.info(
      {
        instanceId: this.instanceId,
        isMatchmakingLeader,
        leadershipCheckDurationMs: leadershipCheckDuration,
        source: 'handleClusterMatchmakingJoin',
      },
      'Leadership check for matchmaking completed',
    )

    if (!isMatchmakingLeader) {
      logger.debug(
        {
          instanceId: this.instanceId,
          playerId: entry.playerId,
          totalDurationMs: Date.now() - startTime,
        },
        'Not the matchmaking leader, skipping matchmaking attempt',
      )
      return
    }

    // 尝试进行匹配
    logger.info({ instanceId: this.instanceId }, 'Starting matchmaking attempt as leader')
    const matchmakingStart = Date.now()
    await this.attemptClusterMatchmaking()
    const matchmakingDuration = Date.now() - matchmakingStart

    logger.info(
      {
        instanceId: this.instanceId,
        matchmakingDurationMs: matchmakingDuration,
        totalDurationMs: Date.now() - startTime,
      },
      'Matchmaking attempt completed',
    )
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
                  connection: p1Connection
                    ? {
                        status: p1Connection.status,
                        instanceId: p1Connection.instanceId,
                        socketId: p1Connection.socketId,
                        lastSeen: p1Connection.lastSeen,
                      }
                    : null,
                },
                player2: {
                  playerId: player2Entry.playerId,
                  sessionId: player2Entry.sessionId,
                  hasConnection: !!p2Connection,
                  connection: p2Connection
                    ? {
                        status: p2Connection.status,
                        instanceId: p2Connection.instanceId,
                        socketId: p2Connection.socketId,
                        lastSeen: p2Connection.lastSeen,
                      }
                    : null,
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

              // 立即清理没有连接的匹配队列条目
              const cleanupPromises: Promise<void>[] = []
              if (!p1Connection || p1Connection.status !== 'connected') {
                logger.info(
                  { playerId: player1Entry.playerId, sessionId: player1Entry.sessionId },
                  'Removing disconnected player from matchmaking queue',
                )
                cleanupPromises.push(
                  this.stateManager.removeFromMatchmakingQueue(player1Entry.playerId, player1Entry.sessionId),
                )
              }
              if (!p2Connection || p2Connection.status !== 'connected') {
                logger.info(
                  { playerId: player2Entry.playerId, sessionId: player2Entry.sessionId },
                  'Removing disconnected player from matchmaking queue',
                )
                cleanupPromises.push(
                  this.stateManager.removeFromMatchmakingQueue(player2Entry.playerId, player2Entry.sessionId),
                )
              }

              // 等待清理完成
              await Promise.all(cleanupPromises)

              // 更新匹配队列大小统计
              if (this.performanceTracker) {
                const queueSize = await this.stateManager.getMatchmakingQueueSize()
                this.performanceTracker.updateMatchmakingQueueSize(queueSize)
              }

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

        // 先更新映射关系，确保原子性
        logger.info({ roomId }, 'About to update session room mappings')

        // 建立会话到房间的映射索引（Redis）
        await this.createSessionRoomMappings(tempRoomState)

        // 3. 最后保存房间状态到集群，此时所有映射已就绪
        logger.info({ roomId }, 'All mappings updated, about to save room state to cluster')
        await this.stateManager.setRoomState(tempRoomState)

        logger.info({ roomId }, 'Room state saved with all mappings ready, about to create local battle')

        // 创建本地战斗实例（存储在 localBattles Map 中供后续使用）
        const battle = await this.createLocalBattle(tempRoomState, player1Data, player2Data)
        logger.info({ roomId, battleId: battle.id }, 'Local battle created successfully')

        // 更新房间状态（不再存储 battleState 到 Redis）
        logger.info({ roomId }, 'About to update room state')
        const roomState: RoomState = {
          ...tempRoomState,
          status: 'active', // 更新状态为活跃
          // 移除 battleState 存储，避免 Redis 超时
          // battleState: battle.getState(player1Data.id, false),
        }

        // 更新集群状态
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
    try {
      // 添加详细日志用于调试重连问题
      logger.debug(
        {
          playerId,
          sessionId,
          event,
          dataType: typeof data,
          hasData: !!data,
        },
        '准备发送消息到玩家会话',
      )

      const result = await this.socketAdapter.sendToPlayerSession(playerId, sessionId, event, data)

      if (!result) {
        logger.warn(
          {
            playerId,
            sessionId,
            event,
          },
          '消息发送失败，可能是连接状态问题',
        )

        // 验证连接状态
        const connection = await this.stateManager.getPlayerConnectionBySession(playerId, sessionId)
        logger.warn(
          {
            playerId,
            sessionId,
            event,
            connection: connection ? { socketId: connection.socketId, status: connection.status } : null,
          },
          '连接状态检查结果',
        )
      } else {
        logger.debug(
          {
            playerId,
            sessionId,
            event,
          },
          '消息发送成功',
        )
      }

      return result
    } catch (error) {
      logger.error(
        {
          error,
          playerId,
          sessionId,
          event,
        },
        '发送消息到玩家会话时出错',
      )
      return false
    }
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
      // 直接从 Redis 查找，无本地缓存
      const client = this.stateManager['redisManager'].getClient()

      // 首先尝试从玩家会话映射中查找
      const sessionRoomKey = `session:rooms:${playerId}:${sessionId}`
      const roomIds = await client.smembers(sessionRoomKey)

      // 如果找到映射，直接验证房间状态
      for (const roomId of roomIds) {
        const roomState = await this.stateManager.getRoomState(roomId)
        if (roomState && roomState.sessions.includes(sessionId) && roomState.sessionPlayers[sessionId] === playerId) {
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
                // 重建映射索引
                await client.sadd(sessionRoomKey, roomState.id)
                return roomState
              }
            } else {
              // 向后兼容：检查是否有任何会话对应该playerId
              for (const roomSessionId of roomState.sessions) {
                if (roomState.sessionPlayers[roomSessionId] === playerId) {
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
      throw error
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
        // 目标实例不存在，清理相关房间状态
        logger.warn(
          { targetInstanceId, action, playerId, roomId: data.roomId },
          'Target instance not found, cleaning up orphaned room',
        )

        await this.handleOrphanedRoom(targetInstanceId, data.roomId, playerId)

        // 对于某些操作，返回默认值而不是抛出错误
        if (action === 'ready') {
          logger.info({ playerId, roomId: data.roomId }, 'Room cleaned up, player ready action ignored')
          return { status: 'ROOM_CLEANED' }
        }

        throw new Error(`Target instance not available: ${targetInstanceId}`)
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
   * 处理孤立房间（目标实例不存在的房间）
   */
  private async handleOrphanedRoom(targetInstanceId: string, roomId: string, playerId: string): Promise<void> {
    try {
      if (!roomId) {
        return
      }

      logger.warn({ targetInstanceId, roomId, playerId }, 'Cleaning up orphaned room due to missing target instance')

      // 获取房间状态
      const roomState = await this.stateManager.getRoomState(roomId)
      if (!roomState) {
        logger.debug({ roomId }, 'Room already cleaned up')
        return
      }

      // 确认房间确实属于不存在的实例
      if (roomState.instanceId !== targetInstanceId) {
        logger.warn(
          { roomId, expectedInstanceId: targetInstanceId, actualInstanceId: roomState.instanceId },
          'Room instance ID mismatch, skipping cleanup',
        )
        return
      }

      // 清理房间状态
      await this.stateManager.removeRoomState(roomId)

      // 清理会话房间映射（已在 removeRoomState 中处理）

      logger.info({ roomId, targetInstanceId }, 'Orphaned room cleaned up successfully')
    } catch (error) {
      logger.error({ error, targetInstanceId, roomId, playerId }, 'Error cleaning up orphaned room')
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

      // 找到对应的Player实例
      const player = battle.playerA.id === playerId ? battle.playerA : battle.playerB
      if (!player) {
        logger.error({ playerId, roomId }, 'Player not found in battle when setting up listeners')
        continue
      }

      // 在Player上注册监听器，接收Player转发的消息（已经是该玩家视角）
      player.registerListener(async message => {
        // 使用批量发送机制
        await this.addToBatch(playerId, sessionId, message)
      })
    }

    // 设置Timer事件监听器 - 新架构
    this.setupTimerEventListeners(battle, roomState)
  }

  /**
   * 设置Timer事件监听器 - 新架构
   */
  private setupTimerEventListeners(battle: Battle, roomState: RoomState): void {
    // 监听Timer快照事件
    battle.onTimerEvent('timerSnapshot', data => {
      // Timer快照包含所有玩家的信息，因为在战斗中玩家需要看到对手的Timer状态
      // 但我们可以根据房间中的玩家进行过滤，只发送房间内玩家的Timer信息
      for (const sessionId of roomState.sessions) {
        const playerId = roomState.sessionPlayers[sessionId]
        if (!playerId) continue

        // 过滤快照，只发送房间内玩家的Timer信息
        const roomPlayerIds = Object.values(roomState.sessionPlayers)
        const relevantSnapshots = data.snapshots.filter(snapshot => roomPlayerIds.includes(snapshot.playerId))

        if (relevantSnapshots.length > 0) {
          const sessionKey = `${playerId}:${sessionId}`
          this.timerEventBatcher.addSnapshots(sessionKey, relevantSnapshots)
        }
      }
    })

    // 监听Timer状态变化事件
    battle.onTimerEvent('timerStateChange', data => {
      // 只向相关玩家发送状态变化事件
      for (const sessionId of roomState.sessions) {
        const playerId = roomState.sessionPlayers[sessionId]
        if (!playerId) continue

        // 只有当状态变化涉及该玩家时才发送
        if (data.playerId === playerId) {
          const sessionKey = `${playerId}:${sessionId}`
          this.timerEventBatcher.addEvent(sessionKey, {
            type: 'stateChange' as any,
            playerId: data.playerId,
            data,
            timestamp: data.timestamp,
          })
        }
      }
    })

    // 监听传统Timer事件（保持兼容性）
    battle.onTimerEvent('timerStart', data => {
      for (const sessionId of roomState.sessions) {
        const playerId = roomState.sessionPlayers[sessionId]
        if (!playerId) continue

        this.sendToPlayerSession(playerId, sessionId, 'timerEvent', {
          type: 'timerStart',
          data,
        }).catch(error => {
          logger.error({ error, playerId, sessionId }, 'Failed to send timerStart event')
        })
      }
    })

    // 监听Timer超时事件（立即发送）
    battle.onTimerEvent('timerTimeout', data => {
      for (const sessionId of roomState.sessions) {
        const playerId = roomState.sessionPlayers[sessionId]
        if (!playerId) continue

        this.sendToPlayerSession(playerId, sessionId, 'timerEvent', {
          type: 'timerTimeout',
          data,
        }).catch(error => {
          logger.error({ error, playerId, sessionId }, 'Failed to send timerTimeout event')
        })
      }
    })
  }

  /**
   * 批量发送消息到玩家会话
   */
  private async addToBatch(playerId: string, sessionId: string, message: any): Promise<void> {
    const sessionKey = `${playerId}:${sessionId}`
    const now = Date.now()

    let batch = this.messageBatches.get(sessionKey)
    if (!batch) {
      batch = { messages: [], timer: null as any, createdAt: now }
      this.messageBatches.set(sessionKey, batch)
    }

    // 检查批次是否过期，如果过期则先清理
    if (now - batch.createdAt > this.MAX_BATCH_AGE) {
      await this.flushBatch(sessionKey)
      // 创建新批次
      batch = { messages: [], timer: null as any, createdAt: now }
      this.messageBatches.set(sessionKey, batch)
    }

    // 清除之前的定时器
    if (batch.timer) {
      clearTimeout(batch.timer)
    }

    // 添加消息到批次
    batch.messages.push(message)

    // 如果达到批量大小或者是需要立即发送的消息，立即发送
    const isImmediateMessage = this.IMMEDIATE_MESSAGE_TYPES.has(message.type)
    if (batch.messages.length >= this.BATCH_SIZE || isImmediateMessage) {
      await this.flushBatch(sessionKey)
    } else {
      // 设置定时器，在超时后发送
      batch.timer = setTimeout(() => {
        this.flushBatch(sessionKey).catch((error: any) => {
          logger.error({ error, sessionKey }, 'Error flushing batch on timeout')
        })
      }, this.BATCH_TIMEOUT)
    }
  }

  /**
   * 立即发送批次中的所有消息
   */
  private async flushBatch(sessionKey: string): Promise<void> {
    const batch = this.messageBatches.get(sessionKey)
    if (!batch || batch.messages.length === 0) {
      return
    }

    const [playerId, sessionId] = sessionKey.split(':')
    const messages = [...batch.messages]

    // 清理批次
    if (batch.timer) {
      clearTimeout(batch.timer)
    }
    this.messageBatches.delete(sessionKey)

    try {
      // 直接发送，不等待结果，不重试
      const sendPromise =
        messages.length === 1
          ? this.sendToPlayerSession(playerId, sessionId, 'battleEvent', messages[0])
          : this.sendToPlayerSession(playerId, sessionId, 'battleEventBatch', messages)

      // 不等待发送结果，发送失败就丢弃，重连时状态会自动恢复
      sendPromise.catch(error => {
        logger.debug(
          { error, sessionKey, messageCount: messages.length },
          'Batch messages send failed, will recover on reconnect',
        )
      })

      logger.debug({ sessionKey, messageCount: messages.length }, 'Batch messages sent (fire and forget)')
    } catch (error) {
      logger.debug(
        { error, sessionKey, messageCount: messages.length },
        'Error sending batch messages, will recover on reconnect',
      )
    }
  }

  /**
   * 清理所有批量消息
   */
  private async cleanupAllBatches(): Promise<void> {
    const sessionKeys = Array.from(this.messageBatches.keys())

    // 发送所有待处理的批次
    await Promise.all(sessionKeys.map(sessionKey => this.flushBatch(sessionKey)))

    // 清理所有定时器
    for (const batch of this.messageBatches.values()) {
      if (batch.timer) {
        clearTimeout(batch.timer)
      }
    }

    this.messageBatches.clear()
    logger.info({ batchCount: sessionKeys.length }, 'All message batches cleaned up')
  }

  /**
   * 清理特定玩家的批量消息
   */
  private async cleanupPlayerBatches(playerId: string, sessionId: string): Promise<void> {
    const sessionKey = `${playerId}:${sessionId}`
    const batch = this.messageBatches.get(sessionKey)

    if (batch) {
      if (batch.timer) {
        clearTimeout(batch.timer)
      }
      this.messageBatches.delete(sessionKey)

      logger.debug({ playerId, sessionId, messageCount: batch.messages.length }, '清理玩家重连前的待发送消息批次')
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

    // 检查房间状态，如果已经是active或ended，不允许再ready
    if (localRoom.status !== 'waiting') {
      logger.debug(
        { roomId, playerId, currentStatus: localRoom.status },
        'Room is not in waiting status, ignoring ready request',
      )
      return { status: 'READY' }
    }

    // 检查玩家是否已经准备过了
    if (localRoom.playersReady.has(playerId)) {
      logger.debug({ roomId, playerId }, 'Player already ready, ignoring duplicate ready request')
      return { status: 'READY' }
    }

    // 标记玩家已准备
    localRoom.playersReady.add(playerId)
    localRoom.lastActive = Date.now()

    logger.info(
      { roomId, playerId, readyCount: localRoom.playersReady.size, totalPlayers: localRoom.players.length },
      'Player marked as ready',
    )

    // 检查是否所有玩家都已准备
    const allPlayersReady = localRoom.players.every(pid => localRoom.playersReady.has(pid))

    if (allPlayersReady && localRoom.status === 'waiting') {
      // 原子性地更新状态，防止重复启动
      localRoom.status = 'active'

      logger.info({ roomId }, 'All players ready, starting battle')

      // 异步启动战斗，不阻塞当前方法
      this.startBattleAsync(roomId, localRoom).catch((error: any) => {
        logger.error({ error, roomId }, 'Error starting local battle')
        localRoom.status = 'ended'
        this.cleanupLocalRoom(roomId)
      })
    }

    return { status: 'READY' }
  }

  /**
   * 异步启动战斗，不阻塞调用方法
   */
  private async startBattleAsync(roomId: string, localRoom: LocalRoomData): Promise<void> {
    try {
      // 再次检查房间状态，确保没有竞态条件
      if (localRoom.status !== 'active') {
        logger.warn(
          { roomId, currentStatus: localRoom.status },
          'Room status changed before battle start, aborting battle start',
        )
        return
      }

      logger.info({ roomId, battleId: localRoom.battle.id }, 'Starting battle asynchronously')

      // 确保游戏资源已加载完成
      try {
        const { resourceLoadingManager } = await import('../resourceLoadingManager')
        logger.info({ roomId }, 'Waiting for game resources to be ready...')
        await resourceLoadingManager.waitForResourcesReady()
        logger.info({ roomId }, 'Game resources are ready, proceeding with battle start')
      } catch (error) {
        logger.error({ error, roomId }, 'Failed to load game resources, battle cannot start')
        throw new Error(`游戏资源加载失败: ${error instanceof Error ? error.message : error}`)
      }

      // 启动战斗，这会一直运行直到战斗结束
      await localRoom.battle.startBattle()

      logger.info({ roomId, battleId: localRoom.battle.id }, 'Battle completed successfully')

      // 战斗正常结束，清理资源
      localRoom.status = 'ended'
      await this.cleanupLocalRoom(roomId)
    } catch (error) {
      logger.error({ error, roomId, battleId: localRoom.battle.id }, 'Battle ended with error')

      // 战斗异常结束，也需要清理资源
      localRoom.status = 'ended'
      await this.cleanupLocalRoom(roomId)

      // 重新抛出错误，让调用方的 catch 处理
      throw error
    }
  }

  /**
   * 本地处理玩家放弃
   */
  async handleLocalPlayerAbandon(roomId: string, playerId: string): Promise<{ status: string }> {
    const battle = this.getLocalBattle(roomId)
    if (!battle) {
      throw new Error('BATTLE_NOT_FOUND')
    }

    // 获取房间状态用于清理映射
    const roomState = await this.stateManager.getRoomState(roomId)

    // 调用战斗的放弃方法
    battle.abandonPlayer(playerId as playerId)

    // 立即清理会话到房间的映射，防止重连到已放弃的战斗
    if (roomState) {
      await this.cleanupSessionRoomMappings(roomState)
      logger.info({ roomId, playerId }, 'Session room mappings cleaned up after player abandon')
    }

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

      // 获取房间状态用于后续清理
      const roomState = await this.stateManager.getRoomState(roomId)

      // 立即清理会话到房间的映射，防止重连到已结束的战斗
      if (roomState) {
        await this.cleanupSessionRoomMappings(roomState)
        logger.info({ roomId }, 'Session room mappings cleaned up immediately after battle end')
      }

      // 通知所有玩家房间关闭（基于session）
      if (roomState) {
        for (const sessionId of roomState.sessions) {
          const playerId = roomState.sessionPlayers[sessionId]
          if (playerId) {
            await this.sendToPlayerSession(playerId, sessionId, 'roomClosed', { roomId })
          }
        }
      }

      // 延迟清理其他资源，给客户端一些时间处理战斗结束事件
      setTimeout(async () => {
        await this.cleanupLocalRoom(roomId)

        // 从集群中移除房间状态
        await this.stateManager.removeRoomState(roomId)

        // 清理相关的缓存
        if (roomState) {
          for (const sessionId of roomState.sessions) {
            const playerId = roomState.sessionPlayers[sessionId]
            if (playerId) {
              this.timerStatusCache.delete(`${playerId}:timer_enabled`)
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
      // 获取房间状态用于清理映射
      const roomState = await this.stateManager.getRoomState(roomId)

      const battle = this.getLocalBattle(roomId)
      if (battle) {
        // 调用战斗的放弃方法，这会触发战斗结束逻辑
        battle.abandonPlayer(playerId as playerId)
        logger.info({ roomId, playerId, reason }, 'Local battle terminated via abandonPlayer')
      }

      // 立即清理会话到房间的映射，防止重连到已终止的战斗
      if (roomState) {
        await this.cleanupSessionRoomMappings(roomState)
        logger.info({ roomId, playerId, reason }, 'Session room mappings cleaned up after battle termination')
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

  private handleReadyError(
    error: unknown,
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    ack?: (response: SuccessResponse<{ status: 'READY' }> | ErrorResponse) => void,
  ) {
    const errorResponse: ErrorResponse = {
      status: 'ERROR',
      code: 'READY_ERROR',
      details: error instanceof Error ? error.message : 'Failed to ready player',
    }
    ack?.(errorResponse)
    logger.warn({ socketId: socket.id, error: error instanceof Error ? error.stack : error }, '玩家准备时发生错误')
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

  private async handleReady(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    ack?: (response: SuccessResponse<{ status: 'READY' }> | ErrorResponse) => void,
  ) {
    try {
      const playerId = socket.data.playerId
      if (!playerId) {
        logger.warn({ socketId: socket.id }, '玩家不在任何房间中，无法准备')
        ack?.({ status: 'ERROR', code: 'PLAYER_NOT_FOUND', details: '玩家不在任何房间中' })
        return
      }

      // 获取玩家所在的房间
      const sessionId = socket.data.sessionId
      if (!sessionId) {
        logger.warn({ socketId: socket.id, playerId }, '会话ID缺失，无法准备')
        ack?.({ status: 'ERROR', code: 'SESSION_MISSING', details: '会话ID缺失' })
        return
      }

      // 添加超时保护的房间查找
      const roomState = await Promise.race([
        this.getPlayerRoomFromCluster(playerId, sessionId),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('ROOM_LOOKUP_TIMEOUT')), 5000)),
      ])

      if (!roomState) {
        logger.warn({ socketId: socket.id, playerId, sessionId }, '找不到房间，无法准备')
        ack?.({ status: 'ERROR', code: 'ROOM_NOT_FOUND', details: '找不到房间' })
        return
      }

      // 检查房间是否在当前实例
      if (!this.isRoomInCurrentInstance(roomState)) {
        // 添加超时保护的转发操作
        const result = await Promise.race([
          this.forwardPlayerAction(roomState.instanceId, 'ready', playerId, { roomId: roomState.id }),
          new Promise<any>((_, reject) => setTimeout(() => reject(new Error('FORWARD_ACTION_TIMEOUT')), 10000)),
        ])
        ack?.({ status: 'SUCCESS', data: { status: result.status as 'READY' } })
        return
      }

      // 在当前实例处理
      const result = await this.handleLocalReady(roomState.id, playerId)

      logger.info({ socketId: socket.id, roomId: roomState.id, playerId }, '玩家已准备')
      ack?.({ status: 'SUCCESS', data: { status: result.status as 'READY' } })
    } catch (error) {
      logger.error({ error, socketId: socket.id }, 'Error handling ready in cluster mode')
      this.handleReadyError(error, socket, ack)
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
        logger.warn({ error: error.issues, rawData }, 'Raw player data validation failed')
        throw new Error(`Invalid player data: ${error.issues.map((e: any) => e.message).join(', ')}`)
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
        logger.warn({ error: error.issues, rawData }, 'Player data validation failed')
        throw new Error(`Invalid player data: ${error.issues.map((e: any) => e.message).join(', ')}`)
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

  // === Leader选举监控 ===

  private leaderElectionMonitorTimer?: NodeJS.Timeout

  /**
   * 设置leader选举监控
   * 定期检查和记录leader选举状态，便于调试和监控
   */
  private setupLeaderElectionMonitoring(): void {
    // 在开发环境中更频繁地监控，生产环境中减少频率以节省资源
    const monitorInterval = process.env.NODE_ENV === 'production' ? 300000 : 60000 // 生产5分钟，开发1分钟

    this.leaderElectionMonitorTimer = setInterval(async () => {
      try {
        const status = await this.getLeaderElectionStatus()

        // 记录当前leader选举状态
        logger.info(
          {
            currentInstanceId: status.currentInstanceId,
            isCurrentInstanceLeader: status.isCurrentInstanceLeader,
            selectedLeaderId: status.selectedLeaderId,
            totalInstances: status.allInstances.length,
            reachableInstances: status.allInstances.filter(i => i.isReachable).length,
            instanceDetails: status.allInstances.map(i => ({
              id: i.id,
              status: i.status,
              timeSinceHeartbeatSeconds: Math.floor(i.timeSinceHeartbeat / 1000),
              isReachable: i.isReachable,
            })),
          },
          'Leader election status monitoring',
        )

        // 如果没有可用的leader，发出警告
        if (!status.selectedLeaderId) {
          logger.warn(
            {
              currentInstanceId: status.currentInstanceId,
              totalInstances: status.allInstances.length,
              instanceStatuses: status.allInstances.map(i => ({
                id: i.id,
                status: i.status,
                isReachable: i.isReachable,
              })),
            },
            'No leader available for matchmaking - this may cause matchmaking delays',
          )
        }

        // 如果当前实例是leader但实例数量发生变化，记录信息
        if (status.isCurrentInstanceLeader && status.allInstances.length > 1) {
          logger.info(
            {
              currentInstanceId: status.currentInstanceId,
              totalInstances: status.allInstances.length,
              otherInstances: status.allInstances.filter(i => i.id !== status.currentInstanceId).map(i => i.id),
            },
            'Current instance is the matchmaking leader in a multi-instance cluster',
          )
        }
      } catch (error) {
        logger.error({ error }, 'Error during leader election monitoring')
      }
    }, monitorInterval)

    logger.info({ monitorIntervalSeconds: monitorInterval / 1000 }, 'Leader election monitoring started')
  }

  /**
   * 设置实例过期监听器
   * 监听实例 key 的过期事件，当实例崩溃时自动清理其房间
   */
  private setupInstanceExpirationWatcher(): void {
    try {
      // 创建专门用于监听的 Redis 连接
      const subscriber = this.stateManager['redisManager'].getSubscriber()

      // 启用 keyspace notifications for expired events
      // 注意：这需要 Redis 配置 notify-keyspace-events 包含 'Ex'
      const instanceKeyPattern = '__keyevent@*__:expired'

      subscriber.psubscribe(instanceKeyPattern, (err, count) => {
        if (err) {
          logger.error({ error: err }, 'Failed to subscribe to instance expiration events')
        } else {
          logger.info({ subscriptionCount: count }, 'Subscribed to instance expiration events')
        }
      })

      subscriber.on('pmessage', async (pattern, channel, expiredKey) => {
        try {
          // 检查是否是实例 key 过期
          if (expiredKey.includes('arcadia:service:instance:')) {
            // 从 key 中提取实例 ID
            // key 格式: arcadia:service:instance:instanceId
            const instanceId = expiredKey.split(':').pop()

            if (instanceId && instanceId !== this.instanceId) {
              logger.warn({ instanceId, expiredKey }, 'Detected instance expiration, cleaning up its rooms')

              // 异步清理崩溃实例的房间
              this.handleInstanceCrash(instanceId).catch(error => {
                logger.error({ error, instanceId }, 'Error handling instance crash cleanup')
              })
            }
          }
        } catch (error) {
          logger.error({ error, pattern, channel, expiredKey }, 'Error processing instance expiration event')
        }
      })

      logger.info('Instance expiration watcher setup completed')
    } catch (error) {
      logger.error({ error }, 'Failed to setup instance expiration watcher')
    }
  }

  /**
   * 设置房间清理通知监听器
   * 监听其他实例发送的房间清理通知
   */
  private setupRoomCleanupListener(): void {
    try {
      const subscriber = this.stateManager['redisManager'].getSubscriber()
      const channel = `instance:${this.instanceId}:room-cleanup`

      subscriber.subscribe(channel, (err, count) => {
        if (err) {
          logger.error({ error: err, channel }, 'Failed to subscribe to room cleanup notifications')
        } else {
          logger.info({ channel, subscriptionCount: count }, 'Subscribed to room cleanup notifications')
        }
      })

      subscriber.on('message', async (receivedChannel, message) => {
        try {
          if (receivedChannel === channel) {
            const notification = JSON.parse(message)
            await this.handleRoomCleanupNotification(notification)
          }
        } catch (error) {
          logger.error({ error, channel: receivedChannel, message }, 'Error processing room cleanup notification')
        }
      })

      logger.info({ channel }, 'Room cleanup listener setup completed')
    } catch (error) {
      logger.error({ error }, 'Failed to setup room cleanup listener')
    }
  }

  /**
   * 处理房间清理通知
   */
  private async handleRoomCleanupNotification(notification: {
    roomId: string
    cleanedBy: string
    timestamp: number
    reason: string
  }): Promise<void> {
    try {
      const { roomId, cleanedBy, reason } = notification

      logger.warn({ roomId, cleanedBy, reason }, 'Received notification that room was cleaned up by another instance')

      // 检查本地是否有这个房间
      const localRoom = this.localRooms.get(roomId)
      if (localRoom) {
        logger.warn(
          { roomId, cleanedBy, localRoomStatus: localRoom.status },
          'Local room found, cleaning up local state',
        )

        // 通知所有连接的客户端房间已被清理
        await this.notifyClientsRoomCleaned(roomId, reason)

        // 清理本地房间状态
        await this.cleanupLocalRoom(roomId)

        logger.info({ roomId, cleanedBy }, 'Local room state cleaned up after external cleanup notification')
      } else {
        logger.debug({ roomId, cleanedBy }, 'No local room found for cleanup notification')
      }
    } catch (error) {
      logger.error({ error, notification }, 'Error handling room cleanup notification')
    }
  }

  /**
   * 通知客户端房间已被清理
   */
  private async notifyClientsRoomCleaned(roomId: string, reason: string): Promise<void> {
    try {
      // 获取房间内的所有客户端
      const roomSockets = this.io.sockets.adapter.rooms.get(roomId)

      if (roomSockets && roomSockets.size > 0) {
        logger.info({ roomId, clientCount: roomSockets.size, reason }, 'Notifying clients that room was cleaned up')

        // 向房间内所有客户端发送清理通知
        this.io.to(roomId).emit('roomClosed', {
          roomId,
        })

        // 断开所有客户端与房间的连接
        for (const socketId of roomSockets) {
          const socket = this.io.sockets.sockets.get(socketId)
          if (socket) {
            socket.leave(roomId)
          }
        }
      }
    } catch (error) {
      logger.error({ error, roomId, reason }, 'Error notifying clients of room cleanup')
    }
  }

  /**
   * 处理实例崩溃，清理其所有房间
   */
  private async handleInstanceCrash(instanceId: string): Promise<void> {
    try {
      logger.warn({ instanceId }, 'Handling instance crash, starting room cleanup')

      // 获取所有房间
      const allRooms = await this.stateManager['getRooms']()

      // 找到属于崩溃实例的房间
      const crashedInstanceRooms = allRooms.filter((room: any) => room.instanceId === instanceId)

      if (crashedInstanceRooms.length === 0) {
        logger.info({ instanceId }, 'No rooms found for crashed instance')
        return
      }

      logger.warn(
        {
          instanceId,
          roomCount: crashedInstanceRooms.length,
          roomIds: crashedInstanceRooms.map((r: any) => r.id),
        },
        'Found rooms belonging to crashed instance, starting cleanup',
      )

      // 批量清理房间
      let cleanedCount = 0
      for (const room of crashedInstanceRooms) {
        try {
          await this.cleanupOrphanedRoomState(room)
          cleanedCount++
        } catch (error) {
          logger.error({ error, roomId: room.id, instanceId }, 'Failed to cleanup room from crashed instance')
        }
      }

      logger.info(
        { instanceId, totalRooms: crashedInstanceRooms.length, cleanedRooms: cleanedCount },
        'Completed cleanup of rooms from crashed instance',
      )
    } catch (error) {
      logger.error({ error, instanceId }, 'Error handling instance crash')
    }
  }

  // === 匹配领导者选举 ===

  /**
   * 获取当前集群的leader选举状态信息
   * 用于监控和调试
   */
  async getLeaderElectionStatus(): Promise<{
    currentInstanceId: string
    isCurrentInstanceLeader: boolean
    allInstances: Array<{
      id: string
      status: string
      lastHeartbeat: number
      timeSinceHeartbeat: number
      isReachable: boolean
    }>
    selectedLeaderId: string | null
    electionTimestamp: number
  }> {
    try {
      const electionStart = Date.now()

      // 获取所有实例
      const instances = await this.stateManager.getInstances()
      const healthyInstances = instances
        .filter(instance => instance.status === 'healthy')
        .sort((a, b) => a.id.localeCompare(b.id))

      // 检查每个实例的可达性
      const instancesWithReachability = await Promise.all(
        healthyInstances.map(async instance => {
          const isReachable = instance.id === this.instanceId || (await this.verifyInstanceReachability(instance))
          return {
            id: instance.id,
            status: instance.status,
            lastHeartbeat: instance.lastHeartbeat,
            timeSinceHeartbeat: Date.now() - instance.lastHeartbeat,
            isReachable,
          }
        }),
      )

      // 选择leader
      const reachableInstances = instancesWithReachability.filter(i => i.isReachable)
      const selectedLeaderId = reachableInstances.length > 0 ? reachableInstances[0].id : null
      const isCurrentInstanceLeader = selectedLeaderId === this.instanceId

      return {
        currentInstanceId: this.instanceId,
        isCurrentInstanceLeader,
        allInstances: instancesWithReachability,
        selectedLeaderId,
        electionTimestamp: electionStart,
      }
    } catch (error) {
      logger.error({ error }, 'Error getting leader election status')
      return {
        currentInstanceId: this.instanceId,
        isCurrentInstanceLeader: false,
        allInstances: [],
        selectedLeaderId: null,
        electionTimestamp: Date.now(),
      }
    }
  }

  /**
   * 检查当前实例是否为匹配领导者
   * 使用分布式锁实现可靠的领导者选举，并验证选出的leader确实可用
   */
  private async isMatchmakingLeader(): Promise<boolean> {
    try {
      // 使用分布式锁确保leader选举的原子性
      return await this.lockManager.withLock(
        LOCK_KEYS.MATCHMAKING_LEADER_ELECTION,
        async () => {
          // 获取所有实例（已经过滤了过期实例）
          const instances = await this.stateManager.getInstances()
          const healthyInstances = instances
            .filter(instance => instance.status === 'healthy')
            .sort((a, b) => a.id.localeCompare(b.id)) // 确保顺序一致

          logger.debug(
            {
              instanceId: this.instanceId,
              totalInstances: instances.length,
              healthyInstances: healthyInstances.map(i => ({
                id: i.id,
                status: i.status,
                lastHeartbeat: i.lastHeartbeat,
                timeSinceHeartbeat: Date.now() - i.lastHeartbeat,
              })),
            },
            'Leader election: evaluating instances',
          )

          if (healthyInstances.length === 0) {
            logger.warn({ instanceId: this.instanceId }, 'No healthy instances found, assuming leadership')
            return true
          }

          // 验证候选leader是否真正可用
          let selectedLeader: ServiceInstance | null = null

          for (const instance of healthyInstances) {
            // 如果是当前实例，直接认为可用
            if (instance.id === this.instanceId) {
              selectedLeader = instance
              break
            }

            // 对于其他实例，进行额外的可达性检查
            const isReachable = await this.verifyInstanceReachability(instance)
            if (isReachable) {
              selectedLeader = instance
              break
            } else {
              logger.warn(
                {
                  instanceId: instance.id,
                  lastHeartbeat: instance.lastHeartbeat,
                  timeSinceHeartbeat: Date.now() - instance.lastHeartbeat,
                },
                'Instance appears healthy but is not reachable, skipping for leader election',
              )
            }
          }

          if (!selectedLeader) {
            logger.warn(
              { instanceId: this.instanceId, healthyInstanceCount: healthyInstances.length },
              'No reachable instances found, assuming leadership',
            )
            return true
          }

          const isLeader = selectedLeader.id === this.instanceId

          logger.info(
            {
              instanceId: this.instanceId,
              selectedLeaderId: selectedLeader.id,
              isLeader,
              healthyInstanceCount: healthyInstances.length,
              evaluatedInstances: healthyInstances.map(i => i.id),
            },
            'Matchmaking leadership election result',
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

  /**
   * 验证实例的可达性
   * 这里可以实现简单的健康检查，比如检查实例的心跳时间
   */
  private async verifyInstanceReachability(instance: ServiceInstance): Promise<boolean> {
    try {
      const now = Date.now()
      const timeSinceLastHeartbeat = now - instance.lastHeartbeat

      // 使用更严格的心跳检查：如果心跳超过1.5倍间隔，认为不可达
      const isProduction = process.env.NODE_ENV === 'production'
      // 从环境变量或默认值获取心跳间隔
      const heartbeatInterval = parseInt(process.env.CLUSTER_HEARTBEAT_INTERVAL || (isProduction ? '300000' : '120000'))
      const reachabilityTimeout = heartbeatInterval * 1.5

      const isReachable = timeSinceLastHeartbeat <= reachabilityTimeout

      logger.debug(
        {
          instanceId: instance.id,
          timeSinceLastHeartbeat: Math.floor(timeSinceLastHeartbeat / 1000),
          reachabilityTimeoutSeconds: Math.floor(reachabilityTimeout / 1000),
          isReachable,
        },
        'Instance reachability check',
      )

      return isReachable
    } catch (error) {
      logger.error({ error, instanceId: instance.id }, 'Error verifying instance reachability, assuming not reachable')
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
   * 注意：大部分数据清理现在通过 TTL 自动处理，这里只保留必要的清理
   */
  private async performOtherCleanupTasks(): Promise<void> {
    await Promise.all([
      // 保留本地缓存清理，因为这些是内存中的数据
      this.cleanupAllCaches(),
      // 保留孤立匹配队列条目清理，因为这需要业务逻辑判断
      this.cleanupOrphanedMatchmakingEntries(),
    ])

    // 连接清理和锁清理现在通过 TTL 自动处理，不再需要手动清理
    logger.debug('Other cleanup tasks completed - most data now auto-expires via TTL')
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

    // 清理Timer批处理系统
    const batchStats = this.timerEventBatcher.getBatchStats()

    if (batchStats.eventBatches > 0 || batchStats.snapshotBatches > 0) {
      logger.debug(
        {
          timerBatches: batchStats,
        },
        'Timer system batch status',
      )
    }
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
   * 清理孤立的匹配队列条目（没有对应连接的条目）
   */
  private async cleanupOrphanedMatchmakingEntries(): Promise<void> {
    try {
      const matchmakingQueue = await this.stateManager.getMatchmakingQueue()
      if (matchmakingQueue.length === 0) {
        return
      }

      const entriesToRemove: { playerId: string; sessionId: string }[] = []

      // 只检查少量最旧的条目，避免大量 Redis 查询
      // TTL 会自动清理过期的队列条目，这里只处理连接状态不一致的情况
      const entriesToCheck = matchmakingQueue.slice(0, Math.min(10, matchmakingQueue.length))

      for (const entry of entriesToCheck) {
        if (!entry.sessionId) continue

        const connection = await this.stateManager.getPlayerConnectionBySession(entry.playerId, entry.sessionId)
        if (!connection || connection.status !== 'connected') {
          entriesToRemove.push({ playerId: entry.playerId, sessionId: entry.sessionId })
        }
      }

      // 批量移除孤立的匹配队列条目
      if (entriesToRemove.length > 0) {
        await Promise.all(
          entriesToRemove.map(({ playerId, sessionId }) =>
            this.stateManager.removeFromMatchmakingQueue(playerId, sessionId),
          ),
        )
        logger.info(
          { count: entriesToRemove.length },
          'Cleaned up orphaned matchmaking entries (TTL handles most cases)',
        )

        // 更新匹配队列大小统计
        if (this.performanceTracker) {
          const queueSize = await this.stateManager.getMatchmakingQueueSize()
          this.performanceTracker.updateMatchmakingQueueSize(queueSize)
        }
      }
    } catch (error) {
      logger.error({ error }, 'Error cleaning up orphaned matchmaking entries')
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

  private async isValidSession(playerId: string, sessionId: string): Promise<boolean> {
    try {
      const session = await this.stateManager.getSession(playerId, sessionId)
      return session !== null
    } catch {
      return false
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

  private setupBatchCleanupTask() {
    const timer = setInterval(() => {
      this.cleanupExpiredBatches()
      this.monitorBatchBacklog() // 监控批次积压
    }, 15000) // 每15秒清理一次过期批次（更频繁）

    this.io.engine.on('close', () => clearInterval(timer))
  }

  /**
   * 监控消息批次积压情况
   */
  private monitorBatchBacklog(): void {
    const batchCount = this.messageBatches.size
    const now = Date.now()
    let oldBatchCount = 0
    let totalMessages = 0

    for (const [, batch] of this.messageBatches.entries()) {
      totalMessages += batch.messages.length
      if (now - batch.createdAt > 2000) {
        // 超过2秒的批次
        oldBatchCount++
      }
    }

    // 如果积压严重，记录警告
    if (batchCount > 50 || oldBatchCount > 10 || totalMessages > 200) {
      logger.warn(
        {
          totalBatches: batchCount,
          oldBatches: oldBatchCount,
          totalMessages,
        },
        'Message batch backlog detected - potential Redis performance issue',
      )
    }

    // 定期记录统计信息
    if (batchCount > 0) {
      logger.debug(
        {
          totalBatches: batchCount,
          totalMessages,
          oldBatches: oldBatchCount,
        },
        'Message batch statistics',
      )
    }
  }

  private cleanupExpiredBatches() {
    const now = Date.now()
    const expiredKeys: string[] = []

    for (const [sessionKey, batch] of this.messageBatches.entries()) {
      if (now - batch.createdAt > this.MAX_BATCH_AGE) {
        expiredKeys.push(sessionKey)
      }
    }

    for (const sessionKey of expiredKeys) {
      this.flushBatch(sessionKey).catch((error: any) => {
        logger.error({ error, sessionKey }, 'Error flushing expired batch')
      })
    }

    if (expiredKeys.length > 0) {
      logger.debug({ expiredCount: expiredKeys.length }, 'Cleaned up expired message batches')
    }
  }

  /**
   * 注册玩家连接（支持多会话）
   */
  private async registerPlayerConnection(socket: Socket) {
    const playerId = socket.data.playerId
    const sessionId = socket.data.sessionId

    logger.info(
      {
        socketId: socket.id,
        playerId,
        sessionId,
        hasPlayerId: !!playerId,
        hasSessionId: !!sessionId,
      },
      'Registering player connection',
    )

    // 注册本地socket连接
    this.players.set(socket.id, {
      socket,
      lastPing: Date.now(),
      heartbeatTimer: setInterval(() => {
        socket.emit('ping')
      }, this.HEARTBEAT_INTERVAL),
    })

    // 更新集群中的玩家连接状态
    if (playerId && sessionId) {
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

        logger.info({ playerId, sessionId, instanceId: this.instanceId }, 'Setting player connection in cluster')
        await this.stateManager.setPlayerConnection(playerId, connection)
      } catch (error) {
        logger.error({ error, playerId, sessionId, socketId: socket.id }, 'Failed to register player connection')
      }
    } else {
      logger.warn(
        {
          socketId: socket.id,
          playerId,
          sessionId,
          hasPlayerId: !!playerId,
          hasSessionId: !!sessionId,
        },
        'Cannot register player connection - missing playerId or sessionId',
      )
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

      const sessionConnections = await this.stateManager.getPlayerSessionConnections(playerId)

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

      // 清理leader选举监控定时器
      if (this.leaderElectionMonitorTimer) {
        clearInterval(this.leaderElectionMonitorTimer)
        this.leaderElectionMonitorTimer = undefined
        logger.info('Leader election monitor timer cleared')
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

      // 清理所有批量消息
      await this.cleanupAllBatches()

      // 清理Timer系统
      this.timerEventBatcher.cleanup()

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

  // === 掉线宽限期处理 ===

  private async startDisconnectGracePeriod(playerId: string, sessionId: string, roomId: string) {
    logger.warn({ playerId, sessionId, roomId }, '玩家在战斗中掉线，启动宽限期')

    // 暂停战斗计时器
    await this.pauseBattleForDisconnect(roomId, playerId)

    // 设置宽限期计时器
    const graceTimer = setTimeout(async () => {
      logger.warn({ playerId, sessionId, roomId }, '掉线宽限期结束，判定为放弃战斗')
      await this.handlePlayerAbandon(roomId, playerId, sessionId)
      this.disconnectedPlayers.delete(`${playerId}:${sessionId}`)
    }, this.DISCONNECT_GRACE_PERIOD)

    // 记录掉线信息
    this.disconnectedPlayers.set(`${playerId}:${sessionId}`, {
      playerId,
      sessionId,
      roomId,
      disconnectTime: Date.now(),
      graceTimer,
    })

    // 通知对手玩家掉线
    await this.notifyOpponentDisconnect(roomId, playerId)
  }

  private async pauseBattleForDisconnect(roomId: string, playerId: string) {
    // 网络对战中的掉线处理：暂停计时器
    const battle = this.getLocalBattle(roomId)
    if (battle) {
      // 暂停该玩家的计时器
      battle.timerManager.pauseTimers([playerId as playerId], 'system')
      logger.info({ roomId, playerId }, '玩家掉线，暂停计时器')
    }
  }

  private async notifyOpponentDisconnect(roomId: string, disconnectedPlayerId: string) {
    try {
      const roomState = await this.stateManager.getRoomState(roomId)
      if (!roomState) return

      // 找到对手并通知
      for (const sessionId of roomState.sessions) {
        const playerId = roomState.sessionPlayers[sessionId]
        if (playerId && playerId !== disconnectedPlayerId) {
          await this.sendToPlayerSession(playerId, sessionId, 'opponentDisconnected', {
            disconnectedPlayerId,
            graceTimeRemaining: this.DISCONNECT_GRACE_PERIOD,
          })
        }
      }
    } catch (error) {
      logger.error({ error, roomId, disconnectedPlayerId }, 'Failed to notify opponent of disconnect')
    }
  }

  private async handlePlayerReconnect(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
  ): Promise<{ isReconnect: boolean; roomId?: string }> {
    const playerId = socket.data.playerId
    const sessionId = socket.data.sessionId

    logger.info(
      {
        playerId,
        sessionId,
        hasPlayerId: !!playerId,
        hasSessionId: !!sessionId,
      },
      'handlePlayerReconnect 开始',
    )

    if (!playerId || !sessionId) {
      logger.info('handlePlayerReconnect: 缺少 playerId 或 sessionId')
      return { isReconnect: false }
    }

    const disconnectKey = `${playerId}:${sessionId}`
    const disconnectInfo = this.disconnectedPlayers.get(disconnectKey)

    // 情况1：处理掉线重连（玩家在宽限期内重连）
    if (disconnectInfo) {
      logger.info({ playerId, sessionId, roomId: disconnectInfo.roomId }, '玩家掉线重连成功，恢复战斗状态')

      // 清除宽限期计时器
      clearTimeout(disconnectInfo.graceTimer)
      this.disconnectedPlayers.delete(disconnectKey)

      // 强制刷新连接状态，确保最新的socket信息被更新（不等待结果）
      this.stateManager.forceRefreshPlayerConnection(playerId, sessionId).catch(error => {
        logger.debug({ error, playerId, sessionId }, 'Force refresh connection failed')
      })

      // 恢复战斗状态（不等待结果）
      this.resumeBattleAfterReconnect(disconnectInfo.roomId, playerId).catch(error => {
        logger.debug({ error, roomId: disconnectInfo.roomId, playerId }, 'Resume battle after reconnect failed')
      })

      // 清理该玩家的待发送消息批次（因为连接已更新）
      await this.cleanupPlayerBatches(playerId, sessionId)

      // 发送完整的战斗状态给重连的玩家（不等待结果）
      this.sendBattleStateToPlayer(socket, disconnectInfo.roomId).catch(error => {
        logger.debug(
          { error, playerId, sessionId, roomId: disconnectInfo.roomId },
          'Send battle state failed, will recover on next reconnect',
        )
      })

      // 通知对手玩家已重连（不等待结果）
      this.notifyOpponentReconnect(disconnectInfo.roomId, playerId).catch(error => {
        logger.debug({ error, playerId, roomId: disconnectInfo.roomId }, 'Notify opponent reconnect failed')
      })

      return { isReconnect: true, roomId: disconnectInfo.roomId }
    }

    // 情况2：处理主动重连（如刷新页面）
    // 检查玩家是否还在某个活跃的战斗房间中
    logger.info({ playerId, sessionId }, '检查玩家是否在活跃战斗房间中')
    const roomState = await this.getPlayerRoomFromCluster(playerId, sessionId)

    logger.info(
      {
        playerId,
        sessionId,
        roomState: roomState ? { id: roomState.id, status: roomState.status } : null,
      },
      '房间状态查询结果',
    )

    // 只有当房间状态为 'active' 时才进行重连处理
    // 避免对已结束或正在清理的房间发送重连测试消息
    if (roomState && roomState.status === 'active') {
      logger.info({ playerId, sessionId, roomId: roomState.id }, '玩家主动重连到活跃战斗房间')

      // 清理该玩家的待发送消息批次（因为连接已更新）
      await this.cleanupPlayerBatches(playerId, sessionId)

      // 发送完整的战斗状态给重连的玩家（不等待结果）
      this.sendBattleStateToPlayer(socket, roomState.id).catch(error => {
        logger.debug(
          { error, playerId, sessionId, roomId: roomState.id },
          'Send battle state failed, will recover on next reconnect',
        )
      })

      // 通知对手玩家已重连（不等待结果）
      this.notifyOpponentReconnect(roomState.id, playerId).catch(error => {
        logger.debug({ error, playerId, roomId: roomState.id }, 'Notify opponent reconnect failed')
      })

      return { isReconnect: true, roomId: roomState.id }
    } else if (roomState && roomState.status === 'ended') {
      // 如果房间已结束，记录日志但不进行重连处理
      logger.info(
        { playerId, sessionId, roomId: roomState.id, status: roomState.status },
        '玩家尝试重连到已结束的战斗房间，跳过重连处理',
      )
    }

    logger.info({ playerId, sessionId }, '没有找到活跃的战斗房间，不是重连')
    return { isReconnect: false }
  }

  private async resumeBattleAfterReconnect(roomId: string, playerId: string) {
    try {
      // 获取房间状态以确定房间所在实例
      const roomState = await this.stateManager.getRoomState(roomId)
      if (!roomState) {
        logger.warn({ roomId, playerId }, '房间状态不存在，无法恢复战斗')
        return
      }

      // 检查房间是否在当前实例
      if (this.isRoomInCurrentInstance(roomState)) {
        // 房间在当前实例，直接处理本地战斗
        const battle = this.getLocalBattle(roomId)
        if (battle) {
          // 恢复该玩家的计时器
          battle.timerManager.resumeTimers([playerId as playerId])
          logger.info({ roomId, playerId }, '玩家重连，恢复本地计时器')
        }
      } else {
        // 房间在其他实例，通过跨实例调用恢复计时器
        logger.debug(
          {
            roomId,
            playerId,
            roomInstance: roomState.instanceId,
            currentInstance: this.instanceId,
          },
          '房间在其他实例，通过跨实例调用恢复计时器',
        )

        try {
          // 这里需要添加一个新的跨实例操作来恢复计时器
          // 暂时记录日志，实际的计时器恢复会在目标实例的重连处理中完成
          logger.info(
            { roomId, playerId, roomInstance: roomState.instanceId },
            '跨实例重连，计时器恢复将在目标实例处理',
          )
        } catch (error) {
          logger.warn({ error, roomId, playerId, roomInstance: roomState.instanceId }, '跨实例恢复计时器失败')
        }
      }

      // 重连后清理可能的资源泄漏（这个可以在任何实例执行）
      await this.cleanupReconnectResources(roomId, playerId)

      logger.info({ roomId, playerId }, '玩家重连处理完成，清理资源')
    } catch (error) {
      logger.error({ error, roomId, playerId }, '恢复战斗重连时出错')
    }
  }

  /**
   * 清理重连后可能的资源泄漏
   */
  private async cleanupReconnectResources(roomId: string, playerId: string): Promise<void> {
    try {
      // 1. 清理过期的消息批次
      const expiredKeys: string[] = []
      const now = Date.now()

      for (const [sessionKey, batch] of this.messageBatches.entries()) {
        if (sessionKey.startsWith(`${playerId}:`) && now - batch.createdAt > this.MAX_BATCH_AGE) {
          expiredKeys.push(sessionKey)
        }
      }

      for (const sessionKey of expiredKeys) {
        await this.flushBatch(sessionKey).catch((error: any) => {
          logger.error({ error, sessionKey }, 'Error flushing expired batch during reconnect cleanup')
        })
      }

      logger.debug({ roomId, playerId, cleanedBatches: expiredKeys.length }, 'Cleaned up reconnect resources')
    } catch (error) {
      logger.error({ error, roomId, playerId }, 'Error during reconnect resource cleanup')
    }
  }

  private async sendBattleStateToPlayer(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    roomId: string,
  ) {
    try {
      const playerId = socket.data.playerId as playerId

      // 获取房间状态以确定房间所在实例
      const roomState = await this.stateManager.getRoomState(roomId)
      if (!roomState) {
        logger.warn({ roomId, playerId }, '房间状态不存在，无法发送战斗状态')
        return
      }

      // 检查房间是否在当前实例
      if (this.isRoomInCurrentInstance(roomState)) {
        // 房间在当前实例，直接获取本地战斗
        const battle = this.getLocalBattle(roomId)
        if (battle) {
          // 重连时，让客户端重新获取完整的战斗状态
          // 不需要通过事件发送，客户端会主动调用 getState
          logger.info({ roomId, playerId }, '玩家重连，等待客户端主动获取战斗状态')

          // 发送计时器快照
          const timerState = battle.timerManager.getPlayerState(playerId)
          if (timerState) {
            socket.emit('timerSnapshot', {
              snapshots: [timerState],
            })
          }
        }
      } else {
        // 房间在其他实例，通过跨实例调用获取计时器状态
        logger.debug(
          {
            roomId,
            playerId,
            roomInstance: roomState.instanceId,
            currentInstance: this.instanceId,
          },
          '房间在其他实例，通过跨实例调用获取计时器状态',
        )

        try {
          const timerState = await this.forwardPlayerAction(roomState.instanceId, 'getPlayerTimerState', playerId, {
            roomId,
            playerId,
          })

          if (timerState) {
            socket.emit('timerSnapshot', {
              snapshots: [timerState],
            })
          }
        } catch (error) {
          logger.warn({ error, roomId, playerId, roomInstance: roomState.instanceId }, '跨实例获取计时器状态失败')
        }
      }
    } catch (error) {
      logger.error({ error, roomId, playerId: socket.data.playerId }, '发送战斗状态到玩家时出错')
    }
  }

  private async notifyOpponentReconnect(roomId: string, reconnectedPlayerId: string) {
    try {
      const roomState = await this.stateManager.getRoomState(roomId)
      if (!roomState) return

      // 找到对手并通知
      for (const sessionId of roomState.sessions) {
        const playerId = roomState.sessionPlayers[sessionId]
        if (playerId && playerId !== reconnectedPlayerId) {
          await this.sendToPlayerSession(playerId, sessionId, 'opponentReconnected', {
            reconnectedPlayerId,
          })
        }
      }
    } catch (error) {
      logger.error({ error, roomId, reconnectedPlayerId }, 'Failed to notify opponent of reconnect')
    }
  }
}
