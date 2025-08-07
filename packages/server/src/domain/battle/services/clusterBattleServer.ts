import { Battle, setGlobalLogger } from '@arcadia-eternity/battle'
import { type BattleState, type playerId } from '@arcadia-eternity/const'
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
import { BattleReportService, type BattleReportConfig } from '../../report/services/battleReportService'
import type { IAuthService, JWTPayload } from '../../auth/services/authService'
import { PlayerRepository } from '@arcadia-eternity/database'
import type { ClusterStateManager } from '../../../cluster/core/clusterStateManager'
import type { SocketClusterAdapter } from '../../../cluster/communication/socketClusterAdapter'
import type { DistributedLockManager } from '../../../cluster/redis/distributedLock'
import type { PerformanceTracker } from '../../../cluster/monitoring/performanceTracker'
import type { RoomState, MatchmakingEntry, PlayerConnection, ServiceInstance } from '../../../cluster/types'
import { REDIS_KEYS } from '../../../cluster/types'
import { BattleRpcServer } from '../../../cluster/communication/rpc/battleRpcServer'
import { BattleRpcClient } from '../../../cluster/communication/rpc/battleRpcClient'
import type { ServiceDiscoveryManager } from '../../../cluster/discovery/serviceDiscovery'
import { TYPES } from '../../../types'
import type { MatchmakingCallbacks, BattleCallbacks, IMatchmakingService, IBattleService } from './interfaces'
import { PrivateRoomService } from '../../room/services/privateRoomService'
import { PrivateRoomHandlers } from '../../room/handlers/privateRoomHandlers'
import { SessionStateManager } from '../../session/sessionStateManager'
import { injectable, inject, optional } from 'inversify'

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

@injectable()
export class ClusterBattleServer {
  private readonly CLEANUP_INTERVAL = 5 * 60 * 1000
  private readonly DISCONNECT_GRACE_PERIOD = 60000 // 60秒掉线宽限期
  private readonly HEARTBEAT_INTERVAL = 5000
  private readonly players = new Map<string, PlayerMeta>()
  private battleReportService?: BattleReportService
  private performanceTracker?: PerformanceTracker
  private serviceDiscovery?: ServiceDiscoveryManager
  private instanceId: string

  // 保留旧的缓存用于兼容性（逐步迁移）
  private readonly timerStatusCache = new Map<string, { enabled: boolean; timestamp: number }>()
  private readonly TIMER_CACHE_TTL = 30000 // 30秒缓存，大幅减少跨实例调用

  // 服务实例（在初始化时设置）
  private matchmakingService!: IMatchmakingService
  private battleService!: IBattleService
  private privateRoomService!: PrivateRoomService
  private privateRoomHandlers!: PrivateRoomHandlers

  // RPC相关
  private rpcServer?: BattleRpcServer
  private rpcClient: BattleRpcClient
  private rpcPort?: number

  // 批量消息处理现在由 clusterBattleService 管理

  constructor(
    @inject(TYPES.SocketIOServer)
    private readonly io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    @inject(TYPES.ClusterStateManager) private readonly stateManager: ClusterStateManager,
    @inject(TYPES.SocketClusterAdapter) private readonly socketAdapter: SocketClusterAdapter,
    @inject(TYPES.DistributedLockManager) private readonly lockManager: DistributedLockManager,
    @inject(TYPES.SessionStateManager) private readonly sessionStateManager: SessionStateManager,
    @inject(TYPES.InstanceId) instanceId: string,
    @inject(TYPES.PlayerRepository) private readonly playerRepository: PlayerRepository,
    @inject(TYPES.AuthService) private readonly authService: IAuthService,
    @optional() @inject(TYPES.RpcPort) rpcPort?: number,
    @optional() @inject(TYPES.BattleReportConfig) private readonly _battleReportConfig?: BattleReportConfig,
  ) {
    this.instanceId = instanceId || nanoid()
    this.rpcPort = rpcPort
    this.rpcClient = new BattleRpcClient()

    // Timer批处理系统现在由 clusterBattleService 管理
    // this.timerEventBatcher = new TimerEventBatcher(...)

    // RPC服务器将通过setRpcServer方法设置

    // 初始化战报服务
    if (this._battleReportConfig) {
      this.battleReportService = new BattleReportService(this._battleReportConfig, logger)
    }

    // 服务实例已通过 DI 注入，无需手动获取
  }

  /**
   * 设置RPC服务器实例（用于解决循环依赖）
   */
  setRpcServer(rpcServer: BattleRpcServer): void {
    this.rpcServer = rpcServer
  }

  /**
   * 设置服务实例（在 DI 容器创建后调用）
   */
  setServices(matchmakingService: IMatchmakingService, battleService: IBattleService): void {
    this.matchmakingService = matchmakingService
    this.battleService = battleService

    // 初始化私人房间服务
    this.privateRoomService = new PrivateRoomService(
      this.stateManager,
      this.lockManager,
      this.socketAdapter,
      this.sessionStateManager,
    )

    // 初始化私人房间处理器
    this.privateRoomHandlers = new PrivateRoomHandlers(this.privateRoomService, this.socketAdapter)

    // 设置私人房间的战斗创建回调
    this.privateRoomService.setBattleCallbacks({
      createClusterBattleRoom: async (player1Entry, player2Entry, spectators) => {
        return await this.battleService.createClusterBattleRoom(player1Entry, player2Entry, spectators)
      },
      joinSpectateBattle: async (battleRoomId, spectator) => {
        return await this.joinSpectateBattle(battleRoomId, spectator)
      },
    })

    // 订阅私人房间事件
    this.subscribeToPrivateRoomEvents()
  }

  setPerformanceTracker(tracker: PerformanceTracker): void {
    this.performanceTracker = tracker
    // 启动性能数据同步
    this.startPerformanceDataSync()
  }

  setServiceDiscovery(serviceDiscovery: ServiceDiscoveryManager): void {
    this.serviceDiscovery = serviceDiscovery
  }

  get currentInstanceId(): string {
    return this.instanceId
  }

  /**
   * 启动性能数据同步到集群状态管理器
   */
  private startPerformanceDataSync(): void {
    if (!this.performanceTracker) {
      return
    }

    // 每30秒同步一次性能数据
    setInterval(() => {
      if (this.performanceTracker) {
        const performanceData = this.performanceTracker.getCurrentPerformanceData()

        // 更新活跃战斗数和排队玩家数 - 从 battleService 获取
        performanceData.activeBattles = this.battleService ? this.battleService.getAllLocalRooms().size : 0
        performanceData.queuedPlayers = 0 // 这个值会在其他地方更新

        // 同步到集群状态管理器
        this.stateManager.updateInstancePerformance(performanceData).catch(error => {
          logger.error({ error }, 'Failed to sync performance data to cluster state')
        })
      }
    }, 30000) // 30秒

    logger.debug('Performance data sync started')
  }

  /**
   * 订阅私人房间事件
   */
  private subscribeToPrivateRoomEvents(): void {
    try {
      const subscriber = this.stateManager.redisManager.getSubscriber()

      // 订阅所有私人房间事件
      subscriber.psubscribe('private_room_events:*')

      subscriber.on('pmessage', (pattern: string, channel: string, message: string) => {
        try {
          const data = JSON.parse(message)
          const { roomCode, event } = data

          // 转发事件给房间内的所有客户端
          this.forwardPrivateRoomEvent(roomCode, event)
        } catch (error) {
          logger.error({ error, channel, message }, 'Failed to process private room event')
        }
      })

      logger.debug('Subscribed to private room events')
    } catch (error) {
      logger.error({ error }, 'Failed to subscribe to private room events')
    }
  }

  /**
   * 转发私人房间事件给客户端
   */
  private async forwardPrivateRoomEvent(roomCode: string, event: any): Promise<void> {
    try {
      // 获取房间内的所有玩家和观战者
      const room = await this.privateRoomService?.getRoom(roomCode)
      if (!room) return

      const allParticipants = [
        ...room.players.map(p => ({ playerId: p.playerId, sessionId: p.sessionId })),
        ...room.spectators.map(s => ({ playerId: s.playerId, sessionId: s.sessionId })),
      ]

      // 向所有参与者发送事件
      for (const participant of allParticipants) {
        await this.socketAdapter.sendToPlayerSession(
          participant.playerId,
          participant.sessionId,
          'privateRoomEvent',
          event,
        )
      }

      logger.debug(
        { roomCode, eventType: event.type, participantCount: allParticipants.length },
        'Private room event forwarded',
      )
    } catch (error) {
      logger.error({ error, roomCode, event }, 'Failed to forward private room event')
    }
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
        const currentInstance = this.stateManager.currentInstance
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
    // setupBatchCleanupTask 已移动到 clusterBattleService
    this.setupAutoUpdateState()
    this.setupAutoCleanup()
    this.setupClusterEventHandlers()
    this.setupCrossInstanceActionListener()
    this.setupLeaderElectionMonitoring()
    this.setupInstanceExpirationWatcher()
    this.setupRoomCleanupListener()
    this.setupStateUpdateListener()

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

        // 检查玩家是否存在
        const player = await this.playerRepository.getPlayerById(playerId)
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
        const payload = this.authService.verifyAccessTokenAsync
          ? await this.authService.verifyAccessTokenAsync(token)
          : this.authService.verifyAccessToken(token)
        if (!payload) {
          return next(new Error('INVALID_TOKEN'))
        }

        // 如果提供了sessionId，验证会话是否存在且有效
        if (sessionId && this.authService.getSession) {
          try {
            const session = await this.authService.getSession(playerId, sessionId)
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

  private lastBroadcastState: ServerState | null = null
  private broadcastDebounceTimer: NodeJS.Timeout | null = null
  private readonly BROADCAST_DEBOUNCE_MS = 1000 // 1秒防抖
  private readonly AUTO_BROADCAST_INTERVAL = 5000 // 5秒定时广播

  private setupAutoUpdateState() {
    // 定时广播，间隔缩短到5秒，只有Leader才广播
    setInterval(async () => {
      try {
        // 检查当前实例是否为Leader
        const leaderStatus = await this.getLeaderElectionStatus()
        if (leaderStatus.isCurrentInstanceLeader) {
          await this.broadcastServerState(false) // 不强制广播，会检查状态变化
          logger.debug('Periodic server state update by leader')
        }
      } catch (error) {
        logger.error({ error }, 'Error in auto server state update')
      }
    }, this.AUTO_BROADCAST_INTERVAL)
  }

  /**
   * 广播服务器状态，支持防抖和状态变化检测
   */
  private async broadcastServerState(force: boolean = false): Promise<void> {
    try {
      const currentState = await this.getCurrentState()

      // 检查状态是否有变化（除非强制广播）
      if (!force && this.lastBroadcastState && this.isStateEqual(currentState, this.lastBroadcastState)) {
        return // 状态没有变化，跳过广播
      }

      this.lastBroadcastState = { ...currentState }
      this.io.emit('updateState', currentState)

      logger.debug({ state: currentState }, 'Server state broadcasted')
    } catch (error) {
      logger.error({ error }, 'Error broadcasting server state')
    }
  }

  /**
   * 防抖广播服务器状态（只有Leader才广播）
   */
  private debouncedBroadcastServerState(): void {
    if (this.broadcastDebounceTimer) {
      clearTimeout(this.broadcastDebounceTimer)
    }

    this.broadcastDebounceTimer = setTimeout(async () => {
      // 检查当前实例是否为Leader
      const leaderStatus = await this.getLeaderElectionStatus()
      if (leaderStatus.isCurrentInstanceLeader) {
        await this.broadcastServerState(true) // 防抖后的广播总是强制执行
        logger.debug('Server state broadcasted by leader instance')
      } else {
        // 非Leader实例发布状态变化事件，通知Leader广播
        await this.notifyLeaderToUpdateState()
        logger.debug('Non-leader instance notified leader to update state')
      }
      this.broadcastDebounceTimer = null
    }, this.BROADCAST_DEBOUNCE_MS)
  }

  /**
   * 通知Leader实例更新服务器状态
   */
  private async notifyLeaderToUpdateState(): Promise<void> {
    try {
      const publisher = this.stateManager.redisManager.getPublisher()
      await publisher.publish(
        'cluster:state-update-request',
        JSON.stringify({
          instanceId: this.instanceId,
          timestamp: Date.now(),
        }),
      )
    } catch (error) {
      logger.error({ error }, 'Failed to notify leader to update state')
    }
  }

  /**
   * 设置状态更新监听器（Leader监听其他实例的更新请求）
   */
  private setupStateUpdateListener(): void {
    const subscriber = this.stateManager.redisManager.getSubscriber()

    subscriber.subscribe('cluster:state-update-request', err => {
      if (err) {
        logger.error({ error: err }, 'Failed to subscribe to state update requests')
      } else {
        logger.debug('Subscribed to cluster state update requests')
      }
    })

    subscriber.on('message', async (channel, message) => {
      if (channel === 'cluster:state-update-request') {
        try {
          const request = JSON.parse(message)

          // 只有Leader才处理状态更新请求
          const leaderStatus = await this.getLeaderElectionStatus()
          if (leaderStatus.isCurrentInstanceLeader) {
            logger.debug({ requestFrom: request.instanceId }, 'Leader received state update request')
            // 立即广播最新状态
            await this.broadcastServerState(true)
          }
        } catch (error) {
          logger.error({ error, message }, 'Error processing state update request')
        }
      }
    })
  }

  /**
   * 检查两个服务器状态是否相等
   */
  private isStateEqual(state1: ServerState, state2: ServerState): boolean {
    return (
      state1.onlinePlayers === state2.onlinePlayers &&
      state1.matchmakingQueue === state2.matchmakingQueue &&
      state1.rooms === state2.rooms &&
      state1.playersInRooms === state2.playersInRooms
    )
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

        // 处理私人房间重连
        if (this.privateRoomService) {
          const { playerId, sessionId } = socket.data
          if (playerId && sessionId) {
            try {
              const currentRoom = await this.privateRoomService.getPlayerSessionCurrentRoom(playerId, sessionId)
              if (currentRoom && currentRoom.status === 'started') {
                logger.info(
                  { playerId, sessionId, roomCode: currentRoom.config.roomCode },
                  '玩家在私人房间战斗中重连，更新状态为在线',
                )
                await this.privateRoomService.handlePlayerReconnect(currentRoom.config.roomCode, playerId, sessionId)
              }
            } catch (error) {
              logger.error({ error, playerId, sessionId }, 'Failed to handle private room reconnect')
            }
          }
        }

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

      // 检查该session是否在战斗中
      const roomState = await this.getPlayerRoomFromCluster(playerId, sessionId)

      // 检查是否为观战者
      const battle = roomState ? this.battleService.getLocalBattle(roomState.id) : undefined
      const isPlayer = battle ? battle.playerA.id === playerId || battle.playerB.id === playerId : false

      if (roomState && !isPlayer) {
        logger.info({ playerId, sessionId, roomId: roomState.id }, '观战者断开连接，立即清理资源')
        await this.stateManager.removePlayerConnection(playerId, sessionId)
        await this.battleService.removeSpectatorFromRoom(roomState.id, sessionId)
        // 新增：移除观战者的会话房间映射
        await this.removeSessionRoomMapping(playerId, sessionId, roomState.id)
        this.debouncedBroadcastServerState()
        return
      }

      if (roomState && roomState.status === 'active') {
        // 玩家在战斗中掉线，启动宽限期
        logger.info({ playerId, sessionId, roomId: roomState.id }, '玩家在战斗中掉线，启动宽限期')

        // 异步更新连接状态
        this.updateDisconnectedPlayerState(playerId, sessionId).catch((error: any) => {
          logger.error({ error, playerId, sessionId }, '更新断开连接状态失败')
        })

        await this.startDisconnectGracePeriod(playerId, sessionId, roomState.id)
      } else {
        // 玩家不在战斗中，直接清理连接信息
        logger.info({ playerId, sessionId }, '玩家不在战斗中，清理连接信息')
        await this.stateManager.removePlayerConnection(playerId, sessionId)
        this.debouncedBroadcastServerState()
      }

      // 从匹配队列中移除
      await this.stateManager.removeFromMatchmakingQueue(playerId, sessionId)

      // 处理私人房间断线
      if (this.privateRoomService) {
        await this.handlePrivateRoomDisconnect(playerId, sessionId)
      }

      // 更新性能统计
      if (this.performanceTracker) {
        const queueSize = await this.stateManager.getMatchmakingQueueSize()
        this.performanceTracker.updateMatchmakingQueueSize(queueSize)
      }

      // 检查其他活跃连接
      const hasOtherConnections = await this.hasOtherActiveConnections(playerId, socket.id, sessionId)
      logger.info(
        { playerId, sessionId, hasOtherConnections },
        hasOtherConnections ? '玩家还有其他活跃连接' : '玩家所有连接都已断开',
      )
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Error handling player disconnect')
    }
  }

  private async handlePrivateRoomDisconnect(playerId: string, sessionId: string): Promise<void> {
    try {
      const currentRoom = await this.privateRoomService.getPlayerSessionCurrentRoom(playerId, sessionId)
      if (currentRoom) {
        if (currentRoom.status === 'started') {
          logger.info(
            { playerId, sessionId, roomCode: currentRoom.config.roomCode },
            '玩家在私人房间战斗中掉线，更新连接状态',
          )
          await this.privateRoomService.handlePlayerDisconnect(currentRoom.config.roomCode, playerId, sessionId)
        } else {
          logger.info(
            { playerId, sessionId, roomCode: currentRoom.config.roomCode },
            '玩家在私人房间中断线（非战斗状态），移除玩家会话',
          )
          await this.privateRoomService.leaveRoom(currentRoom.config.roomCode, playerId, sessionId)
        }
      }
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Failed to handle private room disconnect')
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

    // 私人房间相关事件处理
    socket.on('createPrivateRoom', (data, ack) => this.privateRoomHandlers?.handleCreateRoom(socket, data, ack))
    socket.on('joinPrivateRoom', (data, ack) => this.privateRoomHandlers?.handleJoinRoom(socket, data, ack))
    socket.on('joinPrivateRoomAsSpectator', (data, ack) =>
      this.privateRoomHandlers?.handleJoinAsSpectator(socket, data, ack),
    )
    socket.on('leavePrivateRoom', ack => this.privateRoomHandlers?.handleLeaveRoom(socket, ack))
    socket.on('togglePrivateRoomReady', (data, ack) => this.privateRoomHandlers?.handleToggleReady(socket, data, ack))
    socket.on('startPrivateRoomBattle', (data, ack) => this.privateRoomHandlers?.handleStartBattle(socket, data, ack))
    socket.on('switchToSpectator', (data, ack) => this.privateRoomHandlers?.handleSwitchToSpectator(socket, data, ack))
    socket.on('switchToPlayer', (data, ack) => this.privateRoomHandlers?.handleSwitchToPlayer(socket, data, ack))
    socket.on('getPrivateRoomInfo', (data, ack) => this.privateRoomHandlers?.handleGetRoomInfo(socket, data, ack))
    socket.on('updatePrivateRoomRuleSet', (data, ack) =>
      this.privateRoomHandlers?.handleUpdateRuleSet(socket, data, ack),
    )
    socket.on('updatePrivateRoomConfig', (data, ack) =>
      this.privateRoomHandlers?.handleUpdateRoomConfig(socket, data, ack),
    )
    socket.on('transferPrivateRoomHost', (data, ack) => this.privateRoomHandlers?.handleTransferHost(socket, data, ack))
    socket.on('kickPlayerFromPrivateRoom', (data, ack) => this.privateRoomHandlers?.handleKickPlayer(socket, data, ack))
    socket.on('getCurrentPrivateRoom', ack => this.privateRoomHandlers?.handleGetCurrentRoom(socket, ack))
    socket.on('joinSpectateBattle', (data, ack) =>
      this.privateRoomHandlers?.handleJoinSpectateBattle(socket, data, ack),
    )
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
    if (!this.battleService) {
      return null
    }

    const localRooms = this.battleService.getAllLocalRooms()
    for (const [roomId, localRoom] of localRooms.entries()) {
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
      // 获取所有房间 - 使用公共方法访问
      const allRooms = await this.stateManager.getRooms()

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
      const publisher = this.stateManager.redisManager.getPublisher()
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
    // 委托给匹配服务处理
    await this.matchmakingService.handleClusterMatchmakingJoin(entry)
  }

  /**
   * 设置跨实例操作监听器
   */
  private setupCrossInstanceActionListener(): void {
    const subscriber = this.stateManager.redisManager.getSubscriber()
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
            result = await this.battleService.handleLocalPlayerSelection(roomId, playerId, selectionData)
            break

          case 'getState':
            result = await this.battleService.handleLocalGetState(roomId, playerId)
            break

          case 'getAvailableSelection':
            result = await this.battleService.handleLocalGetSelection(roomId, playerId)
            break

          case 'ready':
            result = await this.battleService.handleLocalReady(roomId, playerId)
            break

          case 'player-abandon':
            result = await this.battleService.handleLocalPlayerAbandon(roomId, playerId)
            break

          case 'force-terminate-battle':
            result = await this.battleService.handleLocalBattleTermination(roomId, playerId, data.reason || 'abandon')
            break

          case 'reportAnimationEnd':
            result = await this.battleService.handleLocalReportAnimationEnd(roomId, playerId, data)
            break

          case 'isTimerEnabled':
            result = await this.battleService.handleLocalIsTimerEnabled(roomId, playerId)
            break

          case 'getPlayerTimerState':
            result = await this.battleService.handleLocalGetPlayerTimerState(roomId, playerId, data)
            break

          case 'getAllPlayerTimerStates':
            result = await this.battleService.handleLocalGetAllPlayerTimerStates(roomId, playerId)
            break

          case 'getTimerConfig':
            result = await this.battleService.handleLocalGetTimerConfig(roomId, playerId)
            break

          case 'startAnimation':
            result = await this.battleService.handleLocalStartAnimation(roomId, playerId, data)
            break

          case 'endAnimation':
            result = await this.battleService.handleLocalEndAnimation(roomId, playerId, data)
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
    rawData: unknown,
    ack?: AckResponse<{ status: 'QUEUED' }>,
  ) {
    // 委托给匹配服务处理
    await this.matchmakingService.handleJoinMatchmaking(socket, rawData, ack)
  }

  async createClusterBattleRoom(
    player1Entry: MatchmakingEntry,
    player2Entry: MatchmakingEntry,
    spectators: { playerId: string; sessionId: string }[] = [],
  ): Promise<string | null> {
    // 委托给 battleService 处理
    return await this.battleService.createClusterBattleRoom(player1Entry, player2Entry, spectators)
  }

  async joinSpectateBattle(roomId: string, spectator: { playerId: string; sessionId: string }): Promise<boolean> {
    const roomState = await this.stateManager.getRoomState(roomId)
    if (!roomState) {
      throw new Error('ROOM_NOT_FOUND')
    }

    if (this.isRoomInCurrentInstance(roomState)) {
      return this.battleService.joinSpectateBattle(roomId, spectator)
    } else {
      const targetInstance = await this.stateManager.getInstance(roomState.instanceId)
      if (!targetInstance || !targetInstance.rpcAddress) {
        throw new Error('TARGET_INSTANCE_NOT_AVAILABLE')
      }
      return this.rpcClient.joinSpectateBattle(
        roomState.instanceId,
        targetInstance.rpcAddress,
        roomId,
        spectator.playerId,
        spectator.sessionId,
      )
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
      const client = this.stateManager.redisManager.getClient()
      await client.srem(REDIS_KEYS.SESSION_ROOM_MAPPING(playerId, sessionId), roomId)
    } catch (error) {
      logger.error({ error, playerId, sessionId, roomId }, 'Failed to remove session room mapping')
    }
  }

  private async getPlayerRoomFromCluster(playerId: string, sessionId: string): Promise<RoomState | null> {
    try {
      // 直接从 Redis 查找，无本地缓存
      const client = this.stateManager.redisManager.getClient()

      // 首先尝试从玩家会话映射中查找
      const sessionRoomKey = REDIS_KEYS.SESSION_ROOM_MAPPING(playerId, sessionId)
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
      const publisher = this.stateManager.redisManager.getPublisher()
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
   * 获取玩家名称
   */
  private async getPlayerName(playerId: string): Promise<string> {
    try {
      const player = await this.playerRepository.getPlayerById(playerId)
      return player?.name || `Player ${playerId.slice(0, 8)}`
    } catch (error) {
      logger.error({ error, playerId }, 'Error getting player name')
      return `Player ${playerId.slice(0, 8)}`
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
      const publisher = this.stateManager.redisManager.getPublisher()
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
    await this.battleService.forceTerminateBattle(roomState, playerId, 'abandon')
  }

  /**
   * 通知其他实例玩家放弃
   */
  private async notifyInstancePlayerAbandon(instanceId: string, roomId: string, playerId: string): Promise<void> {
    try {
      const publisher = this.stateManager.redisManager.getPublisher()
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
    // 委托给匹配服务处理
    await this.matchmakingService.handleCancelMatchmaking(socket, ack)
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
      const result = await this.battleService.handleLocalPlayerSelection(roomState.id, playerId, rawData)

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
      const result = await this.battleService.handleLocalGetState(roomState.id, playerId)

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
      const result = await this.battleService.handleLocalGetSelection(roomState.id, playerId)

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
      const result = await this.battleService.handleLocalReady(roomState.id, playerId)

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
      const subscriber = this.stateManager.redisManager.getSubscriber()

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
      const subscriber = this.stateManager.redisManager.getSubscriber()
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
      const localRoom = this.battleService ? this.battleService.getLocalRoom(roomId) : null
      if (localRoom) {
        logger.warn(
          { roomId, cleanedBy, localRoomStatus: localRoom.status },
          'Local room found, cleaning up local state',
        )

        // 通知所有连接的客户端房间已被清理
        await this.notifyClientsRoomCleaned(roomId, reason)

        // 清理本地房间状态
        await this.battleService.cleanupLocalRoom(roomId)

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
      const allRooms = await this.stateManager.getRooms()

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
      const client = this.stateManager.redisManager.getClient()
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
      await Promise.all(localRooms.map(roomId => this.battleService.cleanupLocalRoom(roomId)))
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
      const publisher = this.stateManager.redisManager.getPublisher()
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
      const publisher = this.stateManager.redisManager.getPublisher()
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

    // Timer批处理系统现在由 battleService 管理
    // const batchStats = this.timerEventBatcher.getBatchStats()
    // this.timerEventBatcher.cleanup()
  }

  /**
   * 创建会话到房间的映射索引
   */
  private async createSessionRoomMappings(roomState: RoomState): Promise<void> {
    try {
      const client = this.stateManager.redisManager.getClient()

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
      const client = this.stateManager.redisManager.getClient()

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
      // 获取所有活跃的规则集
      const activeRuleSetIds = await this.stateManager.getActiveRuleSetIds()
      if (activeRuleSetIds.length === 0) {
        return
      }

      const entriesToRemove: { playerId: string; sessionId: string }[] = []

      // 检查每个规则集的队列
      for (const ruleSetId of activeRuleSetIds) {
        const queue = await this.stateManager.getRuleBasedQueue(ruleSetId)
        if (queue.length === 0) continue

        // 只检查少量最旧的条目，避免大量 Redis 查询
        // TTL 会自动清理过期的队列条目，这里只处理连接状态不一致的情况
        const entriesToCheck = queue.slice(0, Math.min(5, queue.length))

        for (const entry of entriesToCheck) {
          if (!entry.sessionId) continue

          const connection = await this.stateManager.getPlayerConnectionBySession(entry.playerId, entry.sessionId)
          if (!connection || connection.status !== 'connected') {
            entriesToRemove.push({ playerId: entry.playerId, sessionId: entry.sessionId })
          }
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
          'Cleaned up orphaned matchmaking entries from rule-based queues (TTL handles most cases)',
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

      const client = this.stateManager.redisManager.getClient()

      // 获取当前匹配队列中的所有玩家会话，避免清理正在匹配的玩家连接
      const activeRuleSetIds = await this.stateManager.getActiveRuleSetIds()
      const playersInQueue = new Set<string>()

      for (const ruleSetId of activeRuleSetIds) {
        const queue = await this.stateManager.getRuleBasedQueue(ruleSetId)
        for (const entry of queue) {
          if (entry.sessionId) {
            playersInQueue.add(`${entry.playerId}:${entry.sessionId}`)
          }
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

  // setupBatchCleanupTask 已移动到 clusterBattleService

  // monitorBatchBacklog 方法已移动到 clusterBattleService

  // cleanupExpiredBatches 方法已移动到 clusterBattleService

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

        // 玩家连接后立即广播服务器状态更新
        this.debouncedBroadcastServerState()
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

      // 清理RPC服务器（由DI容器管理，不需要手动停止）
      if (this.rpcServer) {
        logger.info('RPC server cleanup managed by DI container')
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
      const localRoomIds = this.battleService ? Array.from(this.battleService.getAllLocalRooms().keys()) : []
      await Promise.all(localRoomIds.map(roomId => this.battleService.cleanupLocalRoom(roomId)))

      // 清理所有批量消息
      await this.battleService.cleanupAllBatches()

      // Timer系统现在由 battleService 管理
      // this.timerEventBatcher.cleanup()

      // 清理战报服务
      if (this.battleReportService) {
        await this.battleReportService.cleanup()
      }

      // 清理跨实例监听器
      const subscriber = this.stateManager.redisManager.getSubscriber()
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
    await this.battleService.pauseBattleForDisconnect(roomId, playerId)

    // 设置宽限期计时器
    const graceTimer = setTimeout(async () => {
      logger.warn({ playerId, sessionId, roomId }, '掉线宽限期结束，判定为放弃战斗')
      await this.handlePlayerAbandon(roomId, playerId, sessionId)
      this.battleService.removeDisconnectedPlayer(`${playerId}:${sessionId}`)
    }, this.DISCONNECT_GRACE_PERIOD)

    // 记录掉线信息
    this.battleService.addDisconnectedPlayer(playerId, sessionId, roomId)

    // 通知对手玩家掉线
    await this.battleService.notifyOpponentDisconnect(roomId, playerId)
  }

  // pauseBattleForDisconnect 和 notifyOpponentDisconnect 方法已移动到 clusterBattleService

  private async resumeBattle(socket: Socket, roomId: string): Promise<void> {
    const playerId = socket.data.playerId as string
    const sessionId = socket.data.sessionId as string

    // 强制刷新连接状态
    await this.stateManager.forceRefreshPlayerConnection(playerId, sessionId)

    // 恢复战斗状态
    await this.battleService.resumeBattleAfterReconnect(roomId, playerId)

    // 清理待发送消息批次
    await this.battleService.cleanupPlayerBatches(playerId, sessionId)

    // 发送战斗状态给重连玩家
    await this.sendBattleStateToPlayer(socket, roomId)

    // 通知对手重连
    await this.notifyOpponentReconnect(roomId, playerId)
  }

  private async handlePlayerReconnect(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
  ): Promise<{ isReconnect: boolean; roomId?: string }> {
    const playerId = socket.data.playerId
    const sessionId = socket.data.sessionId

    if (!playerId || !sessionId) {
      return { isReconnect: false }
    }

    // 检查是否为观战者
    const roomState = await this.getPlayerRoomFromCluster(playerId, sessionId)
    if (roomState?.spectators?.some((s: { sessionId: string }) => s.sessionId === sessionId)) {
      logger.info({ playerId, sessionId, roomId: roomState.id }, '观战者尝试重连，已忽略')
      return { isReconnect: false } // 观战者不允许重连
    }

    // 处理玩家掉线重连
    const disconnectKey = `${playerId}:${sessionId}`
    const disconnectInfo = this.battleService.getDisconnectedPlayer(disconnectKey)

    if (disconnectInfo) {
      logger.info({ playerId, sessionId, roomId: disconnectInfo.roomId }, '玩家掉线重连成功')
      clearTimeout(disconnectInfo.graceTimer)
      this.battleService.removeDisconnectedPlayer(disconnectKey)

      await this.resumeBattle(socket, disconnectInfo.roomId)
      return { isReconnect: true, roomId: disconnectInfo.roomId }
    }

    // 处理玩家主动重连（如刷新页面）
    if (roomState && roomState.status === 'active') {
      logger.info({ playerId, sessionId, roomId: roomState.id }, '玩家主动重连到活跃战斗')
      await this.resumeBattle(socket, roomState.id)
      return { isReconnect: true, roomId: roomState.id }
    }

    logger.info({ playerId, sessionId }, '没有找到活跃战斗，不是重连')
    return { isReconnect: false }
  }

  // resumeBattleAfterReconnect 方法已移动到 clusterBattleService

  // cleanupReconnectResources 方法已移动到 clusterBattleService

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

  // === 委托方法 ===

  /**
   * 获取本地战斗实例（委托给战斗服务）
   */
  private getLocalBattle(roomId: string): Battle | undefined {
    return this.battleService.getLocalBattle(roomId)
  }

  /**
   * 检查房间是否在当前实例（委托给战斗服务）
   */
  private isRoomInCurrentInstance(roomState: RoomState): boolean {
    return this.battleService.isRoomInCurrentInstance(roomState)
  }

  /**
   * 获取断线玩家信息（委托给战斗服务）
   */
  private getDisconnectedPlayer(key: string) {
    return this.battleService.getDisconnectedPlayer(key)
  }

  // 断线玩家管理方法已移动到 clusterBattleService，直接调用即可

  /**
   * 验证实例的可达性
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

  // === RPC 委托方法 ===

  /**
   * RPC 委托方法：处理玩家选择（委托给战斗服务）
   */
  async handleLocalPlayerSelection(roomId: string, playerId: string, data: any): Promise<{ status: string }> {
    return await this.battleService.handleLocalPlayerSelection(roomId, playerId, data)
  }

  /**
   * RPC 委托方法：获取可用选择（委托给战斗服务）
   */
  async handleLocalGetSelection(roomId: string, playerId: string): Promise<any[]> {
    return await this.battleService.handleLocalGetSelection(roomId, playerId)
  }

  /**
   * RPC 委托方法：获取战斗状态（委托给战斗服务）
   */
  async handleLocalGetState(roomId: string, playerId: string): Promise<any> {
    return await this.battleService.handleLocalGetState(roomId, playerId)
  }

  /**
   * RPC 委托方法：玩家准备（委托给战斗服务）
   */
  async handleLocalReady(roomId: string, playerId: string): Promise<{ status: string }> {
    return await this.battleService.handleLocalReady(roomId, playerId)
  }

  /**
   * RPC 委托方法：玩家放弃（委托给战斗服务）
   */
  async handleLocalPlayerAbandon(roomId: string, playerId: string): Promise<{ status: string }> {
    return await this.battleService.handleLocalPlayerAbandon(roomId, playerId)
  }

  /**
   * RPC 委托方法：动画结束报告（委托给战斗服务）
   */
  async handleLocalReportAnimationEnd(roomId: string, playerId: string, data: any): Promise<{ status: string }> {
    return await this.battleService.handleLocalReportAnimationEnd(roomId, playerId, data)
  }

  /**
   * RPC 委托方法：计时器启用检查（委托给战斗服务）
   */
  async handleLocalIsTimerEnabled(roomId: string, playerId: string): Promise<boolean> {
    return await this.battleService.handleLocalIsTimerEnabled(roomId, playerId)
  }

  /**
   * RPC 委托方法：获取玩家计时器状态（委托给战斗服务）
   */
  async handleLocalGetPlayerTimerState(roomId: string, playerId: string, data: any): Promise<any> {
    return await this.battleService.handleLocalGetPlayerTimerState(roomId, playerId, data)
  }

  /**
   * RPC 委托方法：获取所有玩家计时器状态（委托给战斗服务）
   */
  async handleLocalGetAllPlayerTimerStates(roomId: string, playerId: string): Promise<any[]> {
    return await this.battleService.handleLocalGetAllPlayerTimerStates(roomId, playerId)
  }

  /**
   * RPC 委托方法：获取计时器配置（委托给战斗服务）
   */
  async handleLocalGetTimerConfig(roomId: string, playerId: string): Promise<any> {
    return await this.battleService.handleLocalGetTimerConfig(roomId, playerId)
  }

  /**
   * RPC 委托方法：开始动画（委托给战斗服务）
   */
  async handleLocalStartAnimation(roomId: string, playerId: string, data: any): Promise<string> {
    return await this.battleService.handleLocalStartAnimation(roomId, playerId, data)
  }

  /**
   * RPC 委托方法：结束动画（委托给战斗服务）
   */
  async handleLocalEndAnimation(roomId: string, playerId: string, data: any): Promise<{ status: string }> {
    return await this.battleService.handleLocalEndAnimation(roomId, playerId, data)
  }

  /**
   * RPC 委托方法：战斗终止（委托给战斗服务）
   */
  async handleLocalBattleTermination(roomId: string, playerId: string, reason: string): Promise<{ status: string }> {
    return await this.battleService.handleLocalBattleTermination(roomId, playerId, reason)
  }

  // === 回调接口实现 ===

  /**
   * 创建匹配服务回调
   */
  createMatchmakingCallbacks(): MatchmakingCallbacks {
    return {
      createLocalBattle: async (roomState: RoomState, player1Data: any, player2Data: any) => {
        return await this.battleService.createLocalBattle(roomState, player1Data, player2Data)
      },
      sendToPlayerSession: async (playerId: string, sessionId: string, event: string, data: any) => {
        return await this.sendToPlayerSession(playerId, sessionId, event, data)
      },
      getPlayerName: async (playerId: string) => {
        return await this.getPlayerName(playerId)
      },
      createSessionRoomMappings: async (roomState: RoomState) => {
        await this.createSessionRoomMappings(roomState)
      },
      verifyInstanceReachability: async (instance: ServiceInstance) => {
        return await this.verifyInstanceReachability(instance)
      },
      createClusterBattleRoom: async (player1Entry: any, player2Entry: any) => {
        return await this.battleService.createClusterBattleRoom(player1Entry, player2Entry)
      },
      broadcastServerStateUpdate: () => {
        this.debouncedBroadcastServerState()
      },
    }
  }

  /**
   * 创建战斗服务回调
   */
  createBattleCallbacks(): BattleCallbacks {
    return {
      sendToPlayerSession: async (playerId: string, sessionId: string, event: string, data: any) => {
        return await this.sendToPlayerSession(playerId, sessionId, event, data)
      },
      addToBatch: async (playerId: string, sessionId: string, message: any) => {
        // 延迟获取 battleService，确保它已经被设置
        if (this.battleService) {
          await this.battleService.addToBatch(playerId, sessionId, message)
        } else {
          logger.error({ playerId, sessionId }, 'BattleService not set when trying to add to batch')
        }
      },
      cleanupSessionRoomMappings: async (roomState: RoomState) => {
        await this.cleanupSessionRoomMappings(roomState)
      },
      forwardPlayerAction: async (instanceId: string, action: string, playerId: string, data: any) => {
        return await this.forwardPlayerAction(instanceId, action, playerId, data)
      },
      createSessionRoomMappings: async (roomState: RoomState) => {
        await this.createSessionRoomMappings(roomState)
      },
      joinPlayerToRoom: async (playerId: string, roomId: string) => {
        await this.socketAdapter.joinPlayerToRoom(playerId, roomId)
      },
      handlePrivateRoomBattleFinished: async (
        battleRoomId: string,
        battleResult: { winner: string | null; reason: string },
      ) => {
        if (this.privateRoomService) {
          await this.privateRoomService.handleBattleFinished(battleRoomId, battleResult)
        }
      },
    }
  }
}
