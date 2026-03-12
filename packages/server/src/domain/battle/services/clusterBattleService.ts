import { setGlobalLogger } from '@arcadia-eternity/battle'
import {
  type BattleState,
  BattleStatus,
  BattleMessageType,
  type playerId,
  type BattleMessage,
  type PlayerSelection,
  type TimerEvent,
  type TimerSnapshot,
  type PlayerTimerState,
  type TimerConfig,
  TimerEventType,
} from '@arcadia-eternity/const'
import {
  PlayerSchema,
  PlayerSelectionSchema,
  parseWithErrors,
  type PlayerSchemaType,
  type PlayerSelectionSchemaType,
} from '@arcadia-eternity/schema'
import type { IBattleSystem, BattleRuntimeSnapshot } from '@arcadia-eternity/interface'

import pino from 'pino'
import type { ClusterStateManager } from '../../../cluster/core/clusterStateManager'
import type { DistributedLockManager } from '../../../cluster/redis/distributedLock'
import type { PerformanceTracker } from '../../../cluster/monitoring/performanceTracker'
import type { RealtimeTransport } from '../../../realtime/realtimeTransport'

import {
  type RoomState,
  type MatchmakingEntry,
  REDIS_KEYS,
  BattleControlEventType,
  type BattleControlEvent,
  type BattleCreatedEventPayload,
  type CleanupEventPayload,
} from '../../../cluster/types'
import { BattleReportService, type BattleReportConfig } from '../../report/services/battleReportService'
import { TimerEventBatcher } from './timerEventBatcher'
import type { BattleCallbacks, IBattleService } from './interfaces'
import { TYPES } from '../../../types'
import { injectable, inject, optional } from 'inversify'
import { nanoid } from 'nanoid'
import { LOCK_KEYS } from '../../../cluster/redis/distributedLock'
import type { SessionStateManager } from 'src/domain/session/sessionStateManager'
import { TTLHelper } from '../../../cluster/config/ttlConfig'
import {
  InMemoryBattleRuntimeHost,
  type LocalBattleRoomData,
  type LocalBattleRuntimeInstance,
} from '../runtime/battleRuntimeHost'
import { LocalBattleRuntimeFactory } from '../runtime/localBattleRuntimeFactory'
import { cleanupLocalBattleRuntime, startLocalBattleRuntime } from '../runtime/localBattleRuntimeLifecycle'
import { RedisOwnershipCoordinator, type OwnershipCoordinator, type RuntimeOwnershipRecord } from '../runtime/ownershipCoordinator'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  formatters: {
    level: label => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
})

type BattleViewOptions = {
  viewerId?: playerId
  showHidden?: boolean
  showAll?: boolean
}

type BattleSystemWithView = IBattleSystem & {
  BattleEvent(callback: (message: BattleMessage) => void, options?: BattleViewOptions): () => void
}

type DisconnectedPlayerInfo = {
  playerId: string
  sessionId: string
  roomId: string
  disconnectTime: number
  graceTimer?: ReturnType<typeof setTimeout>
}

type CleanupLocalRoomOptions = {
  removeRuntimeArtifacts?: boolean
  releaseOwnership?: boolean
  publishCleanupEvent?: boolean
}

type BattleRuntimeBootstrap = {
  roomId: string
  player1Data: PlayerSchemaType
  player2Data: PlayerSchemaType
  createdAt: number
}

type RoomRuntimeBootstrapMetadata = {
  player1Data: PlayerSchemaType
  player2Data: PlayerSchemaType
  createdAt: number
}

type BattleActionLogEntry = {
  seq: number
  selection: PlayerSelection
  recordedAt: number
}

type PersistedBattleRuntimeSnapshot = BattleRuntimeSnapshot & {
  actionSeq: number
  capturedAt: number
  boundary?: {
    triggerMessageType: BattleMessageType
    battleStatus?: string
    currentTurn?: number
    currentPhase?: string
  }
}

type SnapshotCapableBattleSystem = IBattleSystem & {
  createRuntimeSnapshot: () => Promise<BattleRuntimeSnapshot>
  restoreRuntimeSnapshot: (snapshot: BattleRuntimeSnapshot) => Promise<void>
}

@injectable()
export class ClusterBattleService implements IBattleService {
  // 使用 TTL 配置管理断线宽限期，完全依赖 Redis TTL
  private get DISCONNECT_GRACE_PERIOD(): number {
    return TTLHelper.getTTLForDataType('disconnect', 'gracePeriod')
  }

  // 本地 battle runtime 管理
  private readonly runtimeHost = new InMemoryBattleRuntimeHost()
  private readonly disconnectedPlayers = new Map<string, DisconnectedPlayerInfo>() // 掉线玩家管理
  private readonly localSpectators = new Map<string, Set<{ playerId: string; sessionId: string }>>() // roomId -> Set of spectators
  private ownershipLeaseRenewalTimer: ReturnType<typeof setInterval> | null = null

  // TTL 过期监听器状态（兼容旧逻辑保留字段，当前不再用于战斗判负）
  private ttlExpirationListenerSetup = false

  // Timer事件批处理系统
  private readonly timerEventBatcher: TimerEventBatcher

  // 批量消息处理相关
  private readonly spectatorMessageBatches = new Map<
    string,
    { messages: BattleMessage[]; timer: ReturnType<typeof setTimeout> | null; createdAt: number }
  >() // roomId -> batch

  // 批量消息处理相关
  private readonly messageBatches = new Map<
    string,
    { messages: BattleMessage[]; timer: ReturnType<typeof setTimeout> | null; createdAt: number }
  >() // sessionKey -> batch
  private readonly BATCH_SIZE = 15 // 批量大小（进一步减少，避免Redis积压）
  private readonly BATCH_TIMEOUT = 50 // 批量超时时间（减少到50毫秒，更快发送）
  private readonly MAX_BATCH_AGE = 3000 // 批次最大存活时间（减少到3秒，更快清理）

  // 需要立即发送的消息类型（重要消息和需要玩家输入的消息）
  private readonly IMMEDIATE_MESSAGE_TYPES = new Set<BattleMessageType>([
    BattleMessageType.BattleStart,
    BattleMessageType.BattleEnd,
    BattleMessageType.TurnAction,
    BattleMessageType.ForcedSwitch,
    BattleMessageType.FaintSwitch,
    BattleMessageType.TurnStart,
    BattleMessageType.TurnEnd,
    BattleMessageType.TeamSelectionStart,
    BattleMessageType.TeamSelectionComplete,
  ])
  private readonly RUNTIME_SNAPSHOT_MESSAGE_TYPES = new Set<BattleMessageType>([
    BattleMessageType.BattleStart,
    BattleMessageType.TeamSelectionComplete,
    BattleMessageType.TurnEnd,
    BattleMessageType.BattleEnd,
  ])

  private battleReportService?: BattleReportService
  private readonly localBattleFactory: LocalBattleRuntimeFactory
  private readonly ownershipCoordinator: OwnershipCoordinator

  constructor(
    @inject(TYPES.ClusterStateManager) private readonly stateManager: ClusterStateManager,
    @inject(TYPES.DistributedLockManager) private readonly lockManager: DistributedLockManager,
    @inject(TYPES.ClusterRealtimeGateway) private readonly battleRouting: RealtimeTransport,
    @inject(TYPES.BattleCallbacks) private readonly callbacks: BattleCallbacks,
    @inject(TYPES.InstanceId) private readonly instanceId: string,
    @inject(TYPES.SessionStateManager) private readonly sessionStateManager: SessionStateManager,
    @inject(TYPES.PerformanceTracker) @optional() private readonly performanceTracker?: PerformanceTracker,
    @inject(TYPES.BattleReportConfig) @optional() private readonly _battleReportConfig?: BattleReportConfig,
  ) {
    this.localBattleFactory = new LocalBattleRuntimeFactory(logger)
    this.ownershipCoordinator = new RedisOwnershipCoordinator(this.stateManager.redisManager, this.instanceId)

    // 初始化Timer批处理系统
    this.timerEventBatcher = new TimerEventBatcher(
      async (
        sessionKey: string,
        eventType: string,
        data: TimerEvent | TimerEvent[] | { snapshots: TimerSnapshot[] },
      ) => {
        const [playerId, sessionId] = sessionKey.split(':')
        await this.callbacks.sendToPlayerSession(playerId, sessionId, eventType, data)
      },
    )

    // 初始化战报服务
    if (this._battleReportConfig) {
      logger.info('✅ 初始化战报服务')
      this.battleReportService = new BattleReportService(this._battleReportConfig, logger)
    } else {
      logger.warn('❌ 战报服务未初始化')
    }

    // 设置Battle系统的全局logger
    setGlobalLogger(logger)
    this.subscribeToBattleControlEvents()
    this.startOwnershipLeaseRenewalLoop()
  }

  private get OWNERSHIP_LEASE_RENEW_INTERVAL_MS(): number {
    const leaseTtlMs = TTLHelper.getTTLForDataType('lock')
    return Math.max(1000, Math.floor(leaseTtlMs / 3))
  }

  private startOwnershipLeaseRenewalLoop(): void {
    if (this.ownershipLeaseRenewalTimer) {
      return
    }

    this.ownershipLeaseRenewalTimer = setInterval(() => {
      this.refreshLocalRuntimeOwnershipLeases().catch(error => {
        logger.warn({ error }, 'Failed to refresh local runtime ownership leases')
      })
    }, this.OWNERSHIP_LEASE_RENEW_INTERVAL_MS)
    this.ownershipLeaseRenewalTimer.unref?.()
  }

  private stopOwnershipLeaseRenewalLoop(): void {
    if (!this.ownershipLeaseRenewalTimer) {
      return
    }
    clearInterval(this.ownershipLeaseRenewalTimer)
    this.ownershipLeaseRenewalTimer = null
  }

  private async refreshLocalRuntimeOwnershipLeases(): Promise<void> {
    const roomIds = this.runtimeHost.listRoomIds()
    if (roomIds.length === 0) {
      return
    }

    for (const roomId of roomIds) {
      try {
        const claimed = await this.ownershipCoordinator.claim(roomId, this.instanceId)
        if (claimed.ownerInstanceId !== this.instanceId) {
          const ownerUnavailable = await this.isOwnerInstanceUnavailable(claimed.ownerInstanceId)
          if (ownerUnavailable) {
            logger.warn(
              {
                roomId,
                currentInstance: this.instanceId,
                staleOwnerInstanceId: claimed.ownerInstanceId,
              },
              'Ownership lease points to unavailable owner, forcing ownership preemption',
            )
            const preempted = await this.forceClaimRuntimeOwnership(roomId)
            if (preempted.ownerInstanceId === this.instanceId) {
              await this.updateRoomRoutingAfterOwnershipPreempt(roomId)
              continue
            }
          }
          await this.dropLocalRuntimeAfterOwnershipLost(roomId, claimed.ownerInstanceId)
        }
      } catch (error) {
        logger.warn({ roomId, error }, 'Failed to refresh ownership lease for local runtime')
      }
    }
  }

  private async isOwnerInstanceUnavailable(ownerInstanceId: string): Promise<boolean> {
    const ownerInstance = await this.stateManager.getInstance(ownerInstanceId)
    if (!ownerInstance) {
      return true
    }

    if (ownerInstance.status !== 'healthy') {
      return true
    }

    const heartbeatTtlMs = TTLHelper.getTTLForDataType('serviceInstance', 'heartbeat')
    return Date.now() - ownerInstance.lastHeartbeat > heartbeatTtlMs
  }

  private async forceClaimRuntimeOwnership(roomId: string): Promise<RuntimeOwnershipRecord> {
    const now = Date.now()
    const leaseTtlMs = TTLHelper.getTTLForDataType('lock')
    const record: RuntimeOwnershipRecord = {
      roomId,
      ownerInstanceId: this.instanceId,
      status: 'active',
      leaseExpireAt: now + leaseTtlMs,
      lastUpdatedAt: now,
    }
    const ttlSeconds = Math.max(1, Math.ceil(leaseTtlMs / 1000))
    const client = this.stateManager.redisManager.getClient()
    await client.setex(REDIS_KEYS.BATTLE_RUNTIME_OWNERSHIP(roomId), ttlSeconds, JSON.stringify(record))
    return record
  }

  private async updateRoomRoutingAfterOwnershipPreempt(roomId: string): Promise<void> {
    try {
      const roomState = await this.stateManager.getRoomState(roomId)
      if (!roomState) {
        return
      }
      if (roomState.instanceId === this.instanceId) {
        return
      }
      roomState.instanceId = this.instanceId
      roomState.lastActive = Date.now()
      await this.stateManager.setRoomState(roomState)
    } catch (error) {
      logger.warn({ roomId, error }, 'Failed to update room routing after ownership preemption')
    }
  }

  private async dropLocalRuntimeAfterOwnershipLost(roomId: string, newOwnerInstanceId: string): Promise<void> {
    const runtime = this.runtimeHost.getInstance(roomId)
    if (!runtime) {
      return
    }

    logger.warn(
      {
        roomId,
        currentInstance: this.instanceId,
        newOwnerInstanceId,
      },
      'Local runtime ownership lost during lease refresh, dropping local runtime to avoid split-brain',
    )

    try {
      await cleanupLocalBattleRuntime(runtime.data)
    } catch (error) {
      logger.warn({ roomId, error }, 'Failed to cleanup local runtime after ownership loss')
    }

    this.runtimeHost.remove(roomId)
    if (this.performanceTracker) {
      this.performanceTracker.updateActiveBattleRooms(this.runtimeHost.size())
    }

    try {
      const roomState = await this.stateManager.getRoomState(roomId)
      if (roomState && roomState.instanceId === this.instanceId) {
        roomState.instanceId = newOwnerInstanceId
        roomState.lastActive = Date.now()
        await this.stateManager.setRoomState(roomState)
      }
    } catch (error) {
      logger.warn({ roomId, error }, 'Failed to update room routing after ownership loss')
    }
  }

  /**
   * 订阅战斗控制事件
   */
  private subscribeToBattleControlEvents(): void {
    try {
      const subscriber = this.stateManager.redisManager.getSubscriber()
      const channel = REDIS_KEYS.BATTLE_CONTROL_CHANNEL

      subscriber.subscribe(channel, err => {
        if (err) {
          logger.error({ err }, `Failed to subscribe to ${channel}`)
          return
        }
        logger.info(`Successfully subscribed to ${channel}`)
      })

      subscriber.on('message', (receivedChannel, message) => {
        if (receivedChannel === channel) {
          try {
            const payload = JSON.parse(message) as BattleControlEvent
            switch (payload.event) {
              case BattleControlEventType.Cleanup:
                this.cleanupSpectatorsForRoom(payload.roomId)
                break
              case BattleControlEventType.BattleCreated:
                this.handleRemoteBattleCreated(payload.roomId, payload.spectators)
                break
              default:
                logger.warn({ payload }, 'Received unknown battle control event')
            }
          } catch (error) {
            logger.error({ error, message }, 'Failed to process battle control event')
          }
        }
      })
    } catch (error) {
      logger.error({ error }, 'Failed to set up battle control subscription')
    }
  }

  /**
   * 处理远程战斗创建事件，用于同步观战者列表
   */
  async handleRemoteBattleCreated(
    roomId: string,
    spectators: { playerId: string; sessionId: string }[],
  ): Promise<void> {
    if (!spectators || spectators.length === 0) {
      return
    }

    // 找出存在于当前实例的观战者
    const localInstanceSpectators = new Set<{ playerId: string; sessionId: string }>()
    const localSessionIds = await this.battleRouting.getLocalSessionIds()

    for (const spectator of spectators) {
      if (localSessionIds.has(spectator.sessionId)) {
        localInstanceSpectators.add(spectator)
      }
    }

    if (localInstanceSpectators.size > 0) {
      this.localSpectators.set(roomId, localInstanceSpectators)
      logger.info(
        {
          roomId,
          instanceId: this.instanceId,
          count: localInstanceSpectators.size,
          totalSpectators: spectators.length,
        },
        'Local spectators registered for new battle from remote event',
      )
    }
  }

  /**
   * 发布战斗创建事件，通知所有实例同步观战者
   */
  private async publishBattleCreatedEvent(
    roomId: string,
    spectators: { playerId: string; sessionId: string }[],
  ): Promise<void> {
    try {
      const publisher = this.stateManager.redisManager.getPublisher()
      const channel = REDIS_KEYS.BATTLE_CONTROL_CHANNEL
      const message: BattleCreatedEventPayload = {
        event: BattleControlEventType.BattleCreated,
        roomId,
        spectators,
        sourceInstance: this.instanceId,
      }
      await publisher.publish(channel, JSON.stringify(message))
    } catch (error) {
      logger.error({ error, roomId }, 'Failed to publish battle created event')
    }
  }

  /**
   * 创建本地Battle实例
   */
  async createLocalBattle(
    roomState: RoomState,
    player1Data: PlayerSchemaType,
    player2Data: PlayerSchemaType,
    options?: { preserveRuntimeJournal?: boolean },
  ): Promise<IBattleSystem> {
    const battle = await this.localBattleFactory.createBattleSystem(roomState, player1Data, player2Data)
    const localRoom = this.localBattleFactory.createRoomData(roomState, battle, player1Data, player2Data)

    this.runtimeHost.register(localRoom)
    await this.ownershipCoordinator.claim(roomState.id, this.instanceId)

    // 更新活跃战斗房间数统计
    if (this.performanceTracker) {
      this.performanceTracker.updateActiveBattleRooms(this.runtimeHost.size())
    }

    // 设置战斗事件监听
    await this.setupBattleEventListeners(battle, roomState.id)
    await this.persistBattleRuntimeBootstrap(roomState.id, player1Data, player2Data)
    await this.persistRoomMetadataRuntimeBootstrap(roomState.id, player1Data, player2Data)
    if (!options?.preserveRuntimeJournal) {
      await this.resetBattleActionJournal(roomState.id)
    }

    // 不在这里启动战斗，等待所有玩家准备好后再启动
    logger.info({ roomId: roomState.id }, 'Battle instance created, waiting for players to be ready')

    logger.info({ roomId: roomState.id }, 'Local battle instance created')
    return battle
  }

  /**
   * 创建集群战斗房间
   */
  async createClusterBattleRoom(
    player1Entry: MatchmakingEntry,
    player2Entry: MatchmakingEntry,
    spectators: { playerId: string; sessionId: string }[] = [],
  ): Promise<string | null> {
    try {
      const roomId = nanoid()

      // 使用分布式锁确保房间创建的原子性
      return await this.lockManager.withLock(LOCK_KEYS.ROOM_CREATE(roomId), async () => {
        // 解析玩家数据 - 现在playerData应该是原始验证过的数据
        let player1Data, player2Data
        try {
          player1Data = parseWithErrors(PlayerSchema, player1Entry.playerData)
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
          player2Data = parseWithErrors(PlayerSchema, player2Entry.playerData)
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

        // 先创建本地Battle实例
        const session1 = player1Entry.sessionId || player1Entry.metadata?.sessionId || 'default'
        const session2 = player2Entry.sessionId || player2Entry.metadata?.sessionId || 'default'

        // 获取规则集信息，优先使用player1的规则集，如果不存在则使用player2的，最后默认为休闲规则集
        const ruleSetId = player1Entry.ruleSetId || player2Entry.ruleSetId || 'casual_standard_ruleset'

        // 检查是否是私人房间战斗
        const isPrivateRoom = player1Entry.metadata?.privateRoom || player2Entry.metadata?.privateRoom || false
        const roomCode = player1Entry.metadata?.roomCode || player2Entry.metadata?.roomCode
        const requiredPackLock = player1Entry.metadata?.requiredPackLock || player2Entry.metadata?.requiredPackLock
        const requiredAssetLock =
          player1Entry.metadata?.requiredAssetLock || player2Entry.metadata?.requiredAssetLock

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
                ruleSetId,
                { isPrivateRoom },
              )) || undefined
          } catch (error) {
            logger.error({ error }, 'Failed to create battle record')
          }
        }

        // 将观战者添加到会话和玩家映射中
        const spectatorSessionPlayers = spectators.reduce(
          (acc, s) => {
            acc[s.sessionId] = s.playerId
            return acc
          },
          {} as Record<string, string>,
        )

        const tempRoomState: RoomState = {
          id: roomId,
          status: 'waiting',
          sessions: [session1, session2],
          sessionPlayers: {
            [session1]: player1Entry.playerId,
            [session2]: player2Entry.playerId,
            ...spectatorSessionPlayers,
          },
          instanceId: this.instanceId,
          lastActive: Date.now(),
          battleState: undefined, // 临时空状态，稍后更新
          spectators: spectators,
          metadata: {
            battleRecordId,
            createdAt: Date.now(),
            ruleSetId, // 添加规则集信息
            privateRoom: isPrivateRoom,
            roomCode: roomCode,
            requiredPackLock,
            requiredAssetLock,
            runtimeBootstrap: {
              player1Data,
              player2Data,
              createdAt: Date.now(),
            } satisfies RoomRuntimeBootstrapMetadata,
          },
        }

        // 先更新映射关系，确保原子性
        logger.info({ roomId }, 'About to update session room mappings')

        // 建立会话到房间的映射索引（Redis）
        await this.callbacks.createSessionRoomMappings(tempRoomState)

        // 3. 最后保存房间状态到集群，此时所有映射已就绪
        logger.info({ roomId }, 'All mappings updated, about to save room state to cluster')
        await this.stateManager.setRoomState(tempRoomState)

        logger.info({ roomId }, 'Room state saved with all mappings ready, about to create local battle')

        // 创建本地战斗实例
        await this.createLocalBattle(tempRoomState, player1Data, player2Data)
        logger.info({ roomId }, 'Local battle created successfully')

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
        await this.callbacks.joinPlayerToRoom(player1Entry.playerId, roomId)
        await this.callbacks.joinPlayerToRoom(player2Entry.playerId, roomId)
        for (const spectator of spectators) {
          await this.callbacks.joinPlayerToRoom(spectator.playerId, roomId)
        }

        logger.info({ roomId }, 'Players joined Socket.IO room successfully')

        logger.info(
          { roomId, sessions: roomState.sessions, sessionPlayers: roomState.sessionPlayers },
          'Cluster battle room created',
        )

        // 发布战斗创建事件，通知所有实例同步观战者
        await this.publishBattleCreatedEvent(roomId, spectators)

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

  /**
   * 获取本地战斗实例
   */
  getLocalBattle(roomId: string): IBattleSystem | undefined {
    return this.runtimeHost.getBattle(roomId)
  }

  /**
   * 检查房间是否在当前实例
   */
  isRoomInCurrentInstance(roomState: RoomState): boolean {
    return roomState.instanceId === this.instanceId
  }

  /**
   * 获取本地房间数据
   */
  getLocalRoom(roomId: string): LocalBattleRoomData | undefined {
    return this.runtimeHost.getRoom(roomId)
  }

  /**
   * 获取所有本地房间
   */
  getAllLocalRooms(): Map<string, LocalBattleRoomData> {
    return this.runtimeHost.getAllRooms()
  }

  /**
   * 获取所有本地战斗
   */
  getAllLocalBattles(): Map<string, IBattleSystem> {
    return this.runtimeHost.getAllBattles()
  }

  /**
   * 获取断线玩家信息
   */
  getDisconnectedPlayer(key: string): DisconnectedPlayerInfo | undefined {
    return this.disconnectedPlayers.get(key)
  }

  /**
   * 添加断线玩家信息（仅用于重连定位，不再由 server 负责倒计时判负）
   */
  async addDisconnectedPlayer(
    playerId: string,
    sessionId: string,
    roomId: string,
    graceTimer?: ReturnType<typeof setTimeout>,
  ): Promise<void> {
    const key = `${playerId}:${sessionId}`
    const disconnectTime = Date.now()
    const gracePeriodTTL = this.DISCONNECT_GRACE_PERIOD
    const expiresAt = disconnectTime + gracePeriodTTL

    // Redis集群存储 - 使用 TTL 自动过期
    const redisInfo = {
      playerId,
      sessionId,
      roomId,
      disconnectTime,
      instanceId: this.instanceId,
      expiresAt,
    }

    const client = this.stateManager.redisManager.getClient()
    const redisKey = REDIS_KEYS.DISCONNECTED_PLAYER(playerId, sessionId)

    // 使用 Redis TTL 自动清理重连索引，不参与战斗判负
    await client.set(redisKey, JSON.stringify(redisInfo), 'PX', gracePeriodTTL)
    await client.sadd(REDIS_KEYS.DISCONNECTED_PLAYERS, redisKey)

    // 本地存储仅用于快速查询，不包含任何 server 侧倒计时
    const info: DisconnectedPlayerInfo = {
      playerId,
      sessionId,
      roomId,
      disconnectTime,
      graceTimer,
    }
    this.disconnectedPlayers.set(key, info)

    logger.info(
      { playerId, sessionId, roomId, gracePeriodTTL, expiresAt },
      '断线玩家信息已添加（重连索引），战斗判负由 v2 timer 负责',
    )
  }

  /**
   * 移除断线玩家信息
   */
  async removeDisconnectedPlayer(key: string): Promise<void> {
    const info = this.disconnectedPlayers.get(key)
    if (info?.graceTimer) {
      clearTimeout(info.graceTimer)
    }
    this.disconnectedPlayers.delete(key)

    // 从Redis集群中移除
    const [playerId, sessionId] = key.split(':')
    const client = this.stateManager.redisManager.getClient()
    const redisKey = REDIS_KEYS.DISCONNECTED_PLAYER(playerId, sessionId)

    await client.del(redisKey)
    await client.srem(REDIS_KEYS.DISCONNECTED_PLAYERS, redisKey)
  }

  /**
   * 清理所有断线玩家信息
   */
  async clearAllDisconnectedPlayers(): Promise<void> {
    for (const [key, info] of this.disconnectedPlayers.entries()) {
      if (info.graceTimer) {
        clearTimeout(info.graceTimer)
      }
    }
    this.disconnectedPlayers.clear()

    // 清理Redis中本实例相关的断线玩家
    const client = this.stateManager.redisManager.getClient()
    const disconnectedKeys = await client.smembers(REDIS_KEYS.DISCONNECTED_PLAYERS)

    for (const redisKey of disconnectedKeys) {
      const playerInfoStr = await client.get(redisKey)
      if (playerInfoStr) {
        const playerInfo = JSON.parse(playerInfoStr)
        if (playerInfo.instanceId === this.instanceId) {
          await client.del(redisKey)
          await client.srem(REDIS_KEYS.DISCONNECTED_PLAYERS, redisKey)
        }
      }
    }
  }

  /**
   * 设置 TTL 过期监听器 - 监听 Redis 键过期事件
   */
  private async setupTTLExpirationListener(): Promise<void> {
    if (this.ttlExpirationListenerSetup) {
      return
    }

    try {
      // 创建专门用于监听的 Redis 连接
      const subscriber = this.stateManager.redisManager.getSubscriber()

      // 启用 keyspace notifications for expired events
      // 注意：这需要 Redis 配置 notify-keyspace-events 包含 'Ex'
      const expiredKeyPattern = '__keyevent@*__:expired'

      subscriber.psubscribe(expiredKeyPattern, (err, count) => {
        if (err) {
          logger.error({ error: err }, 'Failed to subscribe to Redis key expiration events')
        } else {
          logger.info(
            { subscriptionCount: count },
            'Subscribed to Redis key expiration events for TTL-based disconnect management',
          )
        }
      })

      subscriber.on('pmessage', async (pattern, channel, expiredKey) => {
        try {
          // 检查是否是断线玩家 key 过期
          if (expiredKey.includes(':disconnected:player:')) {
            await this.handleDisconnectedPlayerTTLExpired(expiredKey)
          }
        } catch (error) {
          logger.error({ error, pattern, channel, expiredKey }, 'Error processing TTL expiration event')
        }
      })

      this.ttlExpirationListenerSetup = true
      logger.info('TTL expiration listener setup completed for disconnect management')
    } catch (error) {
      logger.error({ error }, 'Failed to setup TTL expiration listener')
    }
  }

  /**
   * 处理断线玩家 TTL 过期事件
   */
  private async handleDisconnectedPlayerTTLExpired(expiredKey: string): Promise<void> {
    try {
      // 从过期的 key 中提取玩家信息
      // key 格式: arcadia:disconnected:player:playerId:sessionId
      const keyParts = expiredKey.split(':')
      if (keyParts.length < 5) {
        logger.warn({ expiredKey }, 'Invalid disconnected player key format')
        return
      }

      const playerId = keyParts[keyParts.length - 2]
      const sessionId = keyParts[keyParts.length - 1]
      const playerKey = `${playerId}:${sessionId}`

      logger.warn({ playerId, sessionId, expiredKey }, 'Disconnected player TTL expired, handling battle abandonment')

      // 检查本地是否有这个断线玩家
      const localInfo = this.disconnectedPlayers.get(playerKey)
      if (localInfo) {
        // 清理本地信息
        if (localInfo.graceTimer) {
          clearTimeout(localInfo.graceTimer)
        }
        this.disconnectedPlayers.delete(playerKey)

        // 处理战斗放弃逻辑
        await this.handlePlayerAbandonmentAfterTTLExpiry(localInfo.roomId, playerId, sessionId)
      } else {
        // 可能是跨实例的断线玩家，检查 Redis 是否还有相关房间信息
        await this.handleCrossInstanceDisconnectExpiry(playerId, sessionId)
      }

      // 清理 Redis 中的相关索引
      const client = this.stateManager.redisManager.getClient()
      await client.srem(REDIS_KEYS.DISCONNECTED_PLAYERS, expiredKey)
    } catch (error) {
      logger.error({ error, expiredKey }, 'Error handling disconnected player TTL expiration')
    }
  }

  /**
   * 检查并处理过期的玩家（备份机制）
   */
  private async checkAndHandleExpiredPlayer(playerKey: string): Promise<void> {
    try {
      const [playerId, sessionId] = playerKey.split(':')
      if (!playerId || !sessionId) {
        return
      }

      // 检查 Redis 中的 TTL 状态
      const client = this.stateManager.redisManager.getClient()
      const redisKey = REDIS_KEYS.DISCONNECTED_PLAYER(playerId, sessionId)
      const ttl = await client.pttl(redisKey)

      // 如果 TTL 已过期（-2）或不存在（-1）
      if (ttl <= 0) {
        const localInfo = this.disconnectedPlayers.get(playerKey)
        if (!localInfo) {
          return
        }

        // Redis key 不存在但玩家已连上，说明可能是跨实例重连后清理了 key，不应误判为掉线超时
        const connection = await this.stateManager.getPlayerConnectionBySession(playerId, sessionId)
        if (connection?.status === 'connected') {
          logger.info(
            { playerId, sessionId, ttl, roomId: localInfo.roomId },
            'Disconnect key already cleaned after reconnect, skipping abandonment',
          )
          if (localInfo.graceTimer) {
            clearTimeout(localInfo.graceTimer)
          }
          this.disconnectedPlayers.delete(playerKey)
          return
        }

        // 房间已结束或玩家会话映射已失效时，仅清理本地缓存，避免重复 terminate
        const roomState = await this.stateManager.getRoomState(localInfo.roomId)
        const playerStillBoundToSession =
          roomState?.status === 'active' &&
          roomState.sessions.includes(sessionId) &&
          roomState.sessionPlayers[sessionId] === playerId
        if (!playerStillBoundToSession) {
          logger.info(
            { playerId, sessionId, ttl, roomId: localInfo.roomId },
            'Disconnect session binding no longer active, skipping abandonment',
          )
          if (localInfo.graceTimer) {
            clearTimeout(localInfo.graceTimer)
          }
          this.disconnectedPlayers.delete(playerKey)
          return
        }

        logger.info({ playerId, sessionId, ttl, roomId: localInfo.roomId }, 'Player disconnect TTL expired, handling abandonment')
        await this.handlePlayerAbandonmentAfterTTLExpiry(localInfo.roomId, playerId, sessionId)
        this.disconnectedPlayers.delete(playerKey)
      }
    } catch (error) {
      logger.error({ error, playerKey }, 'Error checking expired player')
    }
  }

  /**
   * 处理 TTL 过期后的玩家战斗放弃
   */
  private async handlePlayerAbandonmentAfterTTLExpiry(
    roomId: string,
    playerId: string,
    sessionId: string,
  ): Promise<void> {
    try {
      logger.warn({ roomId, playerId, sessionId }, 'Handling player abandonment after TTL expiry')

      // 获取房间状态
      const roomState = await this.stateManager.getRoomState(roomId)
      if (!roomState || roomState.status !== 'active') {
        logger.info({ roomId, playerId, sessionId }, 'Room no longer active, skipping abandonment handling')
        return
      }

      // 如果房间在当前实例，直接处理
      if (this.isRoomInCurrentInstance(roomState)) {
        await this.forceTerminateBattle(roomState, playerId, 'disconnect')
      } else {
        // 通知正确的实例处理放弃逻辑
        await this.notifyInstancePlayerAbandon(roomState.instanceId, roomId, playerId, 'disconnect')
      }

      logger.info({ roomId, playerId, sessionId }, 'Player abandonment handled after TTL expiry')
    } catch (error) {
      logger.error({ error, roomId, playerId, sessionId }, 'Error handling player abandonment after TTL expiry')
    }
  }

  /**
   * 处理跨实例断线过期
   */
  private async handleCrossInstanceDisconnectExpiry(playerId: string, sessionId: string): Promise<void> {
    try {
      // 通过会话房间映射查找玩家所在的房间
      const client = this.stateManager.redisManager.getClient()
      const sessionRoomKey = REDIS_KEYS.SESSION_ROOM_MAPPING(playerId, sessionId)
      const roomIds = await client.smembers(sessionRoomKey)

      for (const roomId of roomIds) {
        const roomState = await this.stateManager.getRoomState(roomId)
        if (roomState && roomState.status === 'active') {
          logger.info(
            { playerId, sessionId, roomId, roomInstance: roomState.instanceId },
            'Found active room for expired cross-instance disconnect, notifying instance',
          )
          await this.notifyInstancePlayerAbandon(roomState.instanceId, roomId, playerId, 'disconnect_timeout')
        }
      }
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Error handling cross-instance disconnect expiry')
    }
  }

  /**
   * 通知其他实例玩家因超时放弃
   */
  private async notifyInstancePlayerAbandon(
    instanceId: string,
    roomId: string,
    playerId: string,
    reason: string,
  ): Promise<void> {
    try {
      if (instanceId === this.instanceId) {
        return // 不需要通知自己
      }

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
          reason,
        }),
      )

      logger.info({ instanceId, roomId, playerId, reason }, 'Notified instance of player abandonment due to TTL expiry')
    } catch (error) {
      logger.error({ error, instanceId, roomId, playerId, reason }, 'Error notifying instance of player abandon')
    }
  }

  /**
   * 获取Timer事件批处理器
   */
  getTimerEventBatcher(): TimerEventBatcher {
    return this.timerEventBatcher
  }

  private async getRuntimeOrRecover(roomId: string, operation: string): Promise<LocalBattleRuntimeInstance | undefined> {
    const existing = this.runtimeHost.getInstance(roomId)
    if (existing) {
      return existing
    }

    const recovered = await this.recoverLocalBattleRuntime(roomId)
    if (!recovered) {
      logger.warn({ roomId, operation }, 'Local runtime missing and recovery failed')
      return undefined
    }

    const runtime = this.runtimeHost.getInstance(roomId)
    if (!runtime) {
      logger.warn({ roomId, operation }, 'Local runtime recovery reported success but runtime is still missing')
      return undefined
    }
    return runtime
  }

  /**
   * 设置战斗事件监听
   */
  private async setupBattleEventListeners(battle: IBattleSystem, roomId: string): Promise<void> {
    const runtime = this.runtimeHost.getInstance(roomId)
    if (!runtime) {
      logger.error({ roomId }, 'Local room not found when setting up battle event listeners')
      return
    }

    // 获取房间状态以获取session信息
    const roomState = await this.stateManager.getRoomState(roomId)
    if (!roomState) {
      logger.error({ roomId }, 'Room state not found when setting up battle event listeners')
      return
    }

    // 1. 为战斗核心事件（如结束、战报）和观战者设置一个统一的、上帝视角的事件监听器
    const battleWithView = battle as BattleSystemWithView
    battleWithView.BattleEvent(
      async message => {
        // 优先将消息广播给所有观战者
        await this.addToSpectatorBatch(roomId, message)

        if (this.RUNTIME_SNAPSHOT_MESSAGE_TYPES.has(message.type)) {
          await this.persistBattleRuntimeWorldSnapshot(roomId, battle, message.type)
        }

        // 记录战报
        if (this.battleReportService && runtime.data.battleRecordId) {
          this.battleReportService.recordBattleMessage(roomId, message)
        }

        // 检查是否是战斗结束事件，并处理所有后续逻辑
        if (message.type === BattleMessageType.BattleEnd) {
          const battleEndData = message.data as { winner: string | null; reason: string }
          logger.info({ roomId, winner: battleEndData.winner, reason: battleEndData.reason }, 'Battle ended')

          // 更新本地房间状态
          runtime.status = 'ended'
          runtime.data.lastActive = Date.now()
          const currentRoomState = await this.stateManager.getRoomState(roomId)!

          // 如果是私人房间，发布战斗结束事件
          if (runtime.data.privateRoom && roomState && roomState.metadata?.roomCode) {
            await this.publishPrivateBattleFinishedEvent(roomState.metadata.roomCode, roomId, battleEndData)
            if (currentRoomState)
              await this.sessionStateManager.batchUpdateSessionStates(
                currentRoomState.sessions.map(sessionId => ({
                  sessionId,
                  playerId: currentRoomState.sessionPlayers[sessionId],
                })),
                'private_room',
              )
          } else {
            if (currentRoomState)
              await this.sessionStateManager.batchUpdateSessionStates(
                currentRoomState.sessions.map(sessionId => ({
                  sessionId,
                  playerId: currentRoomState.sessionPlayers[sessionId],
                })),
                'idle',
              )
          }

          // 延迟清理所有资源，给客户端一些时间处理战斗结束事件
          setTimeout(async () => {
            const currentRoomState = await this.stateManager.getRoomState(roomId)
            if (currentRoomState) {
              // 清理会话映射
              await this.callbacks.cleanupSessionRoomMappings(currentRoomState)
              logger.info({ roomId }, 'Session room mappings cleaned up after battle end')

              await Promise.all(
                currentRoomState.sessions.map(async sessionId => {
                  const playerId = currentRoomState.sessionPlayers[sessionId]
                  if (playerId) {
                    await this.callbacks.sendToPlayerSession(playerId, sessionId, 'roomClosed', { roomId })
                  }
                }),
              )
            }

            // 清理本地和集群状态
            await this.cleanupLocalRoom(roomId)
            await this.stateManager.removeRoomState(roomId)

            logger.info(
              { roomId, winner: battleEndData.winner, reason: battleEndData.reason },
              'Battle cleanup completed',
            )
          }, 5000) // 5秒延迟
        }
      },
      { showAll: true },
    )

    // 2. 为每个玩家设置单独的、具有正确视角的事件监听器
    const playerSessions = roomState.sessions.filter(sessionId => roomState.sessionPlayers[sessionId])
    for (const sessionId of playerSessions) {
      const playerId = roomState.sessionPlayers[sessionId]
      if (!playerId) continue

      battleWithView.BattleEvent(
        async (message: BattleMessage) => {
          await this.addToBatch(playerId, sessionId, message)
        },
        { viewerId: playerId as playerId },
      )
    }

    // 3. 设置Timer事件监听器
    this.setupTimerEventListeners(battle, roomState)
  }

  /**
   * 设置Timer事件监听器 - 新架构
   */
  private setupTimerEventListeners(battle: IBattleSystem, roomState: RoomState): void {
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
            type: TimerEventType.StateChange,
            data,
            timestamp: Date.now(),
          })
        }
      }
    })

    // 监听Timer暂停/恢复事件
    battle.onTimerEvent('timerPause', data => {
      for (const sessionId of roomState.sessions) {
        const playerId = roomState.sessionPlayers[sessionId]
        if (!playerId) continue

        const sessionKey = `${playerId}:${sessionId}`
        this.timerEventBatcher.addEvent(sessionKey, {
          type: TimerEventType.Pause,
          data,
          timestamp: Date.now(),
        })
      }
    })

    battle.onTimerEvent('timerResume', data => {
      for (const sessionId of roomState.sessions) {
        const playerId = roomState.sessionPlayers[sessionId]
        if (!playerId) continue

        const sessionKey = `${playerId}:${sessionId}`
        this.timerEventBatcher.addEvent(sessionKey, {
          type: TimerEventType.Resume,
          data,
          timestamp: Date.now(),
        })
      }
    })
  }

  /**
   * 本地处理玩家选择
   */
  async handleLocalPlayerSelection(roomId: string, playerId: string, data: unknown): Promise<{ status: string }> {
    const runtime = await this.getRuntimeOrRecover(roomId, 'handleLocalPlayerSelection')
    if (!runtime) {
      logger.error(
        { roomId, playerId, availableRooms: this.runtimeHost.listRoomIds() },
        'Battle not found for local player selection',
      )
      throw new Error('BATTLE_NOT_FOUND')
    }

    const selection = this.processPlayerSelection(playerId, data)

    try {
      await runtime.submitAction(selection)
      await this.appendBattleActionLog(roomId, selection)
    } catch (error) {
      logger.error({ roomId, playerId, selection, error }, 'Failed to submit selection in battle')
      throw new Error('INVALID_SELECTION')
    }

    return { status: 'ACTION_ACCEPTED' }
  }

  /**
   * 本地处理状态获取
   */
  async handleLocalGetState(roomId: string, playerId: string): Promise<BattleState> {
    const runtime = await this.getRuntimeOrRecover(roomId, 'handleLocalGetState')
    if (!runtime) {
      throw new Error('BATTLE_NOT_FOUND')
    }

    // 检查是否是观战者
    const roomState = await this.stateManager.getRoomState(roomId)
    const isSpectator = roomState?.spectators.some(s => s.playerId === playerId) ?? false

    const battleState = await runtime.getState(playerId as playerId, isSpectator)
    await this.persistBattleStateSnapshot(roomId, playerId, battleState)

    return battleState
  }

  /**
   * 本地处理选择获取
   */
  async handleLocalGetSelection(roomId: string, playerId: string): Promise<PlayerSelectionSchemaType[]> {
    const runtime = await this.getRuntimeOrRecover(roomId, 'handleLocalGetSelection')
    if (!runtime) {
      throw new Error('BATTLE_NOT_FOUND')
    }

    const availableSelections = await runtime.getAvailableSelection(playerId as playerId)
    const serializedSelections = availableSelections.map(v =>
      parseWithErrors(PlayerSelectionSchema, v),
    ) as PlayerSelectionSchemaType[]

    return serializedSelections
  }

  private async persistBattleStateSnapshot(roomId: string, playerId: string, battleState: BattleState): Promise<void> {
    try {
      const client = this.stateManager.redisManager.getClient()
      const ttlSeconds = this.getBattleRuntimeDataTtlSeconds()
      await client.setex(
        REDIS_KEYS.BATTLE_RUNTIME_PLAYER_SNAPSHOT(roomId, playerId),
        ttlSeconds,
        JSON.stringify(battleState),
      )
    } catch (error) {
      logger.warn({ roomId, playerId, error }, 'Failed to persist battle state snapshot')
    }
  }

  private getBattleRuntimeDataTtlSeconds(): number {
    return Math.max(1, Math.ceil(TTLHelper.getTTLForDataType('room', 'active') / 1000))
  }

  private async persistBattleRuntimeBootstrap(
    roomId: string,
    player1Data: PlayerSchemaType,
    player2Data: PlayerSchemaType,
  ): Promise<void> {
    try {
      const client = this.stateManager.redisManager.getClient()
      const payload: BattleRuntimeBootstrap = {
        roomId,
        player1Data,
        player2Data,
        createdAt: Date.now(),
      }
      await client.setex(
        REDIS_KEYS.BATTLE_RUNTIME_BOOTSTRAP(roomId),
        this.getBattleRuntimeDataTtlSeconds(),
        JSON.stringify(payload),
      )
    } catch (error) {
      logger.warn({ roomId, error }, 'Failed to persist battle runtime bootstrap payload')
    }
  }

  private async appendBattleActionLog(roomId: string, selection: PlayerSelection): Promise<void> {
    try {
      const client = this.stateManager.redisManager.getClient()
      const ttlSeconds = this.getBattleRuntimeDataTtlSeconds()
      const seq = await this.nextBattleActionSeq(roomId)
      const key = REDIS_KEYS.BATTLE_RUNTIME_ACTION_LOG(roomId)
      const entry: BattleActionLogEntry = {
        seq,
        selection,
        recordedAt: Date.now(),
      }
      await client.rpush(key, JSON.stringify(entry))
      await client.expire(key, ttlSeconds)
      await client.expire(REDIS_KEYS.BATTLE_RUNTIME_ACTION_SEQ(roomId), ttlSeconds)
      await this.persistBattleReplayCursor(roomId, seq)
    } catch (error) {
      logger.warn({ roomId, selection, error }, 'Failed to append battle action log')
    }
  }

  private async readBattleRuntimeBootstrap(roomId: string): Promise<BattleRuntimeBootstrap | null> {
    try {
      const client = this.stateManager.redisManager.getClient()
      const raw = await client.get(REDIS_KEYS.BATTLE_RUNTIME_BOOTSTRAP(roomId))
      if (raw) {
        const parsed = JSON.parse(raw) as BattleRuntimeBootstrap
        if (parsed.roomId !== roomId) {
          return null
        }
        return {
          roomId,
          player1Data: parsed.player1Data as PlayerSchemaType,
          player2Data: parsed.player2Data as PlayerSchemaType,
          createdAt: parsed.createdAt,
        }
      }

      // Redis bootstrap 缺失时，从 roomState.metadata 回填，避免接管恢复被单点 key 阻塞
      const roomState = await this.stateManager.getRoomState(roomId)
      const metadataBootstrap = this.parseRoomMetadataBootstrap(roomState?.metadata?.runtimeBootstrap)
      if (!metadataBootstrap) {
        return null
      }

      await this.persistBattleRuntimeBootstrap(roomId, metadataBootstrap.player1Data, metadataBootstrap.player2Data)

      logger.warn(
        { roomId },
        'Recovered battle runtime bootstrap from room metadata fallback and re-persisted Redis bootstrap key',
      )

      return {
        roomId,
        player1Data: metadataBootstrap.player1Data,
        player2Data: metadataBootstrap.player2Data,
        createdAt: metadataBootstrap.createdAt,
      }
    } catch (error) {
      logger.warn({ roomId, error }, 'Failed to read battle runtime bootstrap payload')
      return null
    }
  }

  private parseRoomMetadataBootstrap(raw: unknown): RoomRuntimeBootstrapMetadata | null {
    try {
      const candidate = this.normalizeRoomMetadataBootstrap(raw)
      if (!candidate.player1Data || !candidate.player2Data) {
        return null
      }

      const player1Data = parseWithErrors(
        PlayerSchema,
        this.parseMaybeJson(candidate.player1Data),
      ) as PlayerSchemaType
      const player2Data = parseWithErrors(
        PlayerSchema,
        this.parseMaybeJson(candidate.player2Data),
      ) as PlayerSchemaType
      const createdAt =
        typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt)
          ? candidate.createdAt
          : Date.now()

      return {
        player1Data,
        player2Data,
        createdAt,
      }
    } catch (error) {
      logger.warn({ error }, 'Invalid room metadata runtime bootstrap payload')
      return null
    }
  }

  private normalizeRoomMetadataBootstrap(raw: unknown): {
    player1Data?: unknown
    player2Data?: unknown
    createdAt?: unknown
  } {
    const parsedRaw = this.parseMaybeJson(raw)
    if (!parsedRaw || typeof parsedRaw !== 'object') {
      return {}
    }

    const candidate = parsedRaw as {
      roomId?: unknown
      player1Data?: unknown
      player2Data?: unknown
      createdAt?: unknown
      payload?: unknown
    }

    if (!candidate.player1Data || !candidate.player2Data) {
      const payload = this.parseMaybeJson(candidate.payload)
      if (payload && typeof payload === 'object') {
        const payloadCandidate = payload as {
          player1Data?: unknown
          player2Data?: unknown
          createdAt?: unknown
        }
        return {
          player1Data: payloadCandidate.player1Data,
          player2Data: payloadCandidate.player2Data,
          createdAt: payloadCandidate.createdAt,
        }
      }
    }

    return {
      player1Data: candidate.player1Data,
      player2Data: candidate.player2Data,
      createdAt: candidate.createdAt,
    }
  }

  private parseMaybeJson(value: unknown): unknown {
    if (typeof value !== 'string') {
      return value
    }

    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }

  private async persistRoomMetadataRuntimeBootstrap(
    roomId: string,
    player1Data: PlayerSchemaType,
    player2Data: PlayerSchemaType,
  ): Promise<void> {
    try {
      const roomState = await this.stateManager.getRoomState(roomId)
      if (!roomState) {
        return
      }

      const existing = this.parseRoomMetadataBootstrap(roomState.metadata?.runtimeBootstrap)
      if (
        existing
        && existing.player1Data.id === player1Data.id
        && existing.player2Data.id === player2Data.id
      ) {
        return
      }

      roomState.metadata = {
        ...(roomState.metadata ?? {}),
        runtimeBootstrap: {
          player1Data,
          player2Data,
          createdAt: Date.now(),
        } satisfies RoomRuntimeBootstrapMetadata,
      }
      await this.stateManager.setRoomState(roomState)
    } catch (error) {
      logger.warn({ roomId, error }, 'Failed to persist room metadata runtime bootstrap')
    }
  }

  private async readBattleActionLog(roomId: string, afterSeq: number): Promise<BattleActionLogEntry[]> {
    try {
      const client = this.stateManager.redisManager.getClient()
      const rawEntries = await client.lrange(REDIS_KEYS.BATTLE_RUNTIME_ACTION_LOG(roomId), 0, -1)
      const entries = rawEntries
        .map((raw, index) => {
          const parsed = JSON.parse(raw) as unknown
          if (parsed && typeof parsed === 'object' && 'seq' in parsed && 'selection' in parsed) {
            const seq = Number((parsed as { seq: number }).seq)
            if (!Number.isFinite(seq)) {
              return null
            }
            const selection = parseWithErrors(
              PlayerSelectionSchema,
              (parsed as { selection: unknown }).selection,
            ) as PlayerSelection
            return {
              seq,
              selection,
              recordedAt: Number((parsed as { recordedAt?: number }).recordedAt ?? Date.now()),
            } satisfies BattleActionLogEntry
          }

          // Legacy payload fallback: plain selection JSON without seq.
          const selection = parseWithErrors(PlayerSelectionSchema, parsed) as PlayerSelection
          return {
            seq: index + 1,
            selection,
            recordedAt: Date.now(),
          } satisfies BattleActionLogEntry
        })
        .filter((entry): entry is BattleActionLogEntry => entry !== null)
        .sort((a, b) => a.seq - b.seq)

      return entries.filter(entry => entry.seq > afterSeq)
    } catch (error) {
      logger.warn({ roomId, afterSeq, error }, 'Failed to read battle action log')
      return []
    }
  }

  private async nextBattleActionSeq(roomId: string): Promise<number> {
    const client = this.stateManager.redisManager.getClient()
    const key = REDIS_KEYS.BATTLE_RUNTIME_ACTION_SEQ(roomId)
    return client.incr(key)
  }

  private async readBattleActionSeq(roomId: string): Promise<number> {
    try {
      const client = this.stateManager.redisManager.getClient()
      const raw = await client.get(REDIS_KEYS.BATTLE_RUNTIME_ACTION_SEQ(roomId))
      if (!raw) return 0
      const parsed = Number(raw)
      if (!Number.isFinite(parsed) || parsed < 0) return 0
      return parsed
    } catch (error) {
      logger.warn({ roomId, error }, 'Failed to read battle action seq')
      return 0
    }
  }

  private async readBattleReplayCursor(roomId: string): Promise<number> {
    try {
      const client = this.stateManager.redisManager.getClient()
      const raw = await client.get(REDIS_KEYS.BATTLE_RUNTIME_REPLAY_CURSOR(roomId))
      if (!raw) {
        return 0
      }
      const parsed = Number(raw)
      if (!Number.isFinite(parsed) || parsed < 0) {
        return 0
      }
      return parsed
    } catch (error) {
      logger.warn({ roomId, error }, 'Failed to read battle replay cursor')
      return 0
    }
  }

  private async persistBattleReplayCursor(roomId: string, cursor: number): Promise<void> {
    try {
      const client = this.stateManager.redisManager.getClient()
      await client.setex(
        REDIS_KEYS.BATTLE_RUNTIME_REPLAY_CURSOR(roomId),
        this.getBattleRuntimeDataTtlSeconds(),
        String(Math.max(0, Math.floor(cursor))),
      )
    } catch (error) {
      logger.warn({ roomId, cursor, error }, 'Failed to persist battle replay cursor')
    }
  }

  private async resetBattleActionJournal(roomId: string): Promise<void> {
    try {
      const client = this.stateManager.redisManager.getClient()
      await client.del(REDIS_KEYS.BATTLE_RUNTIME_ACTION_LOG(roomId))
      await client.del(REDIS_KEYS.BATTLE_RUNTIME_ACTION_SEQ(roomId))
      await client.del(REDIS_KEYS.BATTLE_RUNTIME_WORLD_SNAPSHOT(roomId))
      await this.persistBattleReplayCursor(roomId, 0)
    } catch (error) {
      logger.warn({ roomId, error }, 'Failed to reset battle action journal')
    }
  }

  private isSnapshotCapableBattleSystem(battle: IBattleSystem): battle is SnapshotCapableBattleSystem {
    return (
      typeof (battle as SnapshotCapableBattleSystem).createRuntimeSnapshot === 'function' &&
      typeof (battle as SnapshotCapableBattleSystem).restoreRuntimeSnapshot === 'function'
    )
  }

  private async persistBattleRuntimeWorldSnapshot(
    roomId: string,
    battle: IBattleSystem,
    triggerMessageType: BattleMessageType,
  ): Promise<void> {
    if (!this.isSnapshotCapableBattleSystem(battle)) {
      return
    }

    try {
      const actionSeq = await this.readBattleActionSeq(roomId)
      const snapshot = await battle.createRuntimeSnapshot()
      let boundary: PersistedBattleRuntimeSnapshot['boundary'] = {
        triggerMessageType,
      }
      try {
        const fullState = await battle.getState(undefined, true)
        boundary = {
          ...boundary,
          battleStatus: fullState.status,
          currentTurn: fullState.currentTurn,
          currentPhase: fullState.currentPhase,
        }
      } catch {
        // Best-effort metadata, keep persistence path non-blocking.
      }
      const payload: PersistedBattleRuntimeSnapshot = {
        ...snapshot,
        actionSeq,
        capturedAt: Date.now(),
        boundary,
      }
      const client = this.stateManager.redisManager.getClient()
      await client.setex(
        REDIS_KEYS.BATTLE_RUNTIME_WORLD_SNAPSHOT(roomId),
        this.getBattleRuntimeDataTtlSeconds(),
        JSON.stringify(payload),
      )
    } catch (error) {
      logger.warn({ roomId, error }, 'Failed to persist runtime world snapshot')
    }
  }

  private async readBattleRuntimeWorldSnapshot(roomId: string): Promise<PersistedBattleRuntimeSnapshot | null> {
    try {
      const client = this.stateManager.redisManager.getClient()
      const raw = await client.get(REDIS_KEYS.BATTLE_RUNTIME_WORLD_SNAPSHOT(roomId))
      if (!raw) {
        return null
      }
      const parsed = JSON.parse(raw) as Partial<PersistedBattleRuntimeSnapshot>
      if (typeof parsed.format !== 'string' || typeof parsed.version !== 'number' || typeof parsed.payload !== 'string') {
        return null
      }
      return {
        format: parsed.format,
        version: parsed.version,
        payload: parsed.payload,
        actionSeq: Number.isFinite(parsed.actionSeq) ? Number(parsed.actionSeq) : 0,
        capturedAt: Number.isFinite(parsed.capturedAt) ? Number(parsed.capturedAt) : Date.now(),
        boundary:
          parsed.boundary &&
          typeof parsed.boundary === 'object' &&
          'triggerMessageType' in parsed.boundary &&
          Object.values(BattleMessageType).includes(
            (parsed.boundary as { triggerMessageType?: BattleMessageType }).triggerMessageType as BattleMessageType,
          )
            ? {
                triggerMessageType: (parsed.boundary as { triggerMessageType: BattleMessageType }).triggerMessageType,
                battleStatus:
                  typeof (parsed.boundary as { battleStatus?: unknown }).battleStatus === 'string'
                    ? (parsed.boundary as { battleStatus: string }).battleStatus
                    : undefined,
                currentTurn:
                  typeof (parsed.boundary as { currentTurn?: unknown }).currentTurn === 'number'
                  && Number.isFinite((parsed.boundary as { currentTurn: number }).currentTurn)
                    ? (parsed.boundary as { currentTurn: number }).currentTurn
                    : undefined,
                currentPhase:
                  typeof (parsed.boundary as { currentPhase?: unknown }).currentPhase === 'string'
                    ? (parsed.boundary as { currentPhase: string }).currentPhase
                    : undefined,
              }
            : undefined,
      }
    } catch (error) {
      logger.warn({ roomId, error }, 'Failed to read runtime world snapshot')
      return null
    }
  }

  async recoverLocalBattleRuntime(roomId: string): Promise<boolean> {
    if (this.runtimeHost.getInstance(roomId)) {
      return true
    }

    const roomState = await this.stateManager.getRoomState(roomId)
    if (!roomState || roomState.status !== 'active') {
      return false
    }

    const bootstrap = await this.readBattleRuntimeBootstrap(roomId)
    if (!bootstrap) {
      logger.warn({ roomId }, 'Cannot recover local battle runtime: bootstrap payload missing')
      return false
    }

    try {
      await this.createLocalBattle(roomState, bootstrap.player1Data, bootstrap.player2Data, {
        preserveRuntimeJournal: true,
      })
      const runtime = this.runtimeHost.getInstance(roomId)
      if (!runtime) {
        return false
      }

      runtime.status = 'active'
      runtime.data.playersReady.clear()
      for (const battlePlayerId of runtime.data.battlePlayerIds) {
        runtime.data.playersReady.add(battlePlayerId)
      }

      let replayStartSeq = 0
      const latestActionSeq = await this.readBattleActionSeq(roomId)
      const runtimeSnapshot = await this.readBattleRuntimeWorldSnapshot(roomId)
      if (runtimeSnapshot && this.isSnapshotCapableBattleSystem(runtime.battle)) {
        try {
          await runtime.battle.restoreRuntimeSnapshot(runtimeSnapshot)
          const snapshotActionSeq = Math.max(0, runtimeSnapshot.actionSeq)
          if (snapshotActionSeq > latestActionSeq) {
            logger.warn(
              {
                roomId,
                snapshotActionSeq,
                latestActionSeq,
                boundary: runtimeSnapshot.boundary,
              },
              'Runtime snapshot action seq exceeds action log seq, clamping replay baseline',
            )
          }
          replayStartSeq = Math.min(snapshotActionSeq, latestActionSeq)
        } catch (snapshotRestoreError) {
          replayStartSeq = 0
          logger.warn(
            { roomId, snapshotRestoreError },
            'Failed to restore runtime world snapshot, fallback to bootstrap replay',
          )
        }
      }

      const skipBattleLoop = this.shouldSkipBattleLoopForRecoveredSnapshot(
        runtimeSnapshot,
        replayStartSeq,
        latestActionSeq,
      )
      if (skipBattleLoop) {
        runtime.status = 'ended'
        logger.info(
          { roomId, replayStartSeq, latestActionSeq, boundary: runtimeSnapshot?.boundary },
          'Recovered runtime at terminal snapshot boundary, skipping battle loop restart',
        )
      } else {
        await this.startBattleAsync(roomId, runtime.data)
      }

      const previousCursor = await this.readBattleReplayCursor(roomId)
      if (previousCursor !== replayStartSeq) {
        logger.debug(
          { roomId, previousCursor, replayStartSeq },
          'Resetting replay cursor for runtime recovery baseline',
        )
      }
      await this.persistBattleReplayCursor(roomId, replayStartSeq)

      const actionLog = await this.readBattleActionLog(roomId, replayStartSeq)
      let replayCursor = replayStartSeq
      for (const entry of actionLog) {
        await runtime.submitAction(entry.selection)
        replayCursor = entry.seq
        await this.persistBattleReplayCursor(roomId, replayCursor)
      }

      logger.info(
        { roomId, replayedActionCount: actionLog.length, replayCursor },
        'Recovered local battle runtime from bootstrap payload and action log',
      )
      return true
    } catch (error) {
      logger.error({ roomId, error }, 'Failed to recover local battle runtime')
      try {
        await this.cleanupLocalRoom(roomId, {
          removeRuntimeArtifacts: false,
          publishCleanupEvent: false,
        })
      } catch (cleanupError) {
        logger.warn({ roomId, cleanupError }, 'Failed to cleanup partially recovered local runtime')
      }
      return false
    }
  }

  private shouldSkipBattleLoopForRecoveredSnapshot(
    snapshot: PersistedBattleRuntimeSnapshot | null,
    replayStartSeq: number,
    latestActionSeq: number,
  ): boolean {
    if (!snapshot?.boundary) return false
    if (replayStartSeq !== latestActionSeq) return false
    if (snapshot.boundary.triggerMessageType === BattleMessageType.BattleEnd) return true
    return snapshot.boundary.battleStatus === BattleStatus.Ended
  }

  /**
   * 处理玩家选择数据
   */
  private processPlayerSelection(playerId: string, rawData: unknown): PlayerSelection {
    try {
      const selection = parseWithErrors(PlayerSelectionSchema, rawData) as PlayerSelection

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
   * 本地处理准备状态
   */
  async handleLocalReady(roomId: string, playerId: string): Promise<{ status: string }> {
    const runtime = await this.getRuntimeOrRecover(roomId, 'handleLocalReady')
    if (!runtime) {
      throw new Error('ROOM_NOT_FOUND')
    }

    // 检查房间状态，如果已经是active或ended，不允许再ready
    if (runtime.status !== 'waiting') {
      logger.debug(
        { roomId, playerId, currentStatus: runtime.status },
        'Room is not in waiting status, ignoring ready request',
      )
      return { status: 'READY' }
    }

    // 检查玩家是否已经准备过了
    if (runtime.isReadyPlayer(playerId)) {
      logger.debug({ roomId, playerId }, 'Player already ready, ignoring duplicate ready request')
      return { status: 'READY' }
    }

    // 检查是否是场上玩家
    const playersInBattle = runtime.data.battlePlayerIds
    if (!runtime.isBattlePlayer(playerId as playerId)) {
      logger.debug({ roomId, playerId }, 'Spectator ready request ignored')
      return { status: 'READY' } // 直接返回，不影响战斗开始
    }

    // 标记玩家已准备
    runtime.markPlayerReady(playerId)
    logger.info(
      {
        roomId,
        playerId,
        readyCount: runtime.data.playersReady.size,
        requiredReadyCount: playersInBattle.length,
        totalPlayersInRoom: runtime.data.players.length,
      },
      'Player marked as ready',
    )

    // 检查是否所有场上玩家都已准备
    const allPlayersReady = runtime.areAllBattlePlayersReady()

    if (allPlayersReady && runtime.status === 'waiting') {
      // 原子性地更新状态，防止重复启动
      runtime.status = 'active'

      logger.info({ roomId }, 'All battle players ready, starting battle')

      // 异步启动战斗，不阻塞当前方法
      this.startBattleAsync(roomId, runtime.data).catch((error: unknown) => {
        logger.error({ error, roomId }, 'Error starting local battle')
        runtime.status = 'ended'
        this.cleanupLocalRoom(roomId)
      })
    }

    return { status: 'READY' }
  }

  /**
   * 异步启动战斗，不阻塞调用方法
   */
  private async startBattleAsync(roomId: string, localRoom: LocalBattleRoomData): Promise<void> {
    try {
      await startLocalBattleRuntime(logger, roomId, localRoom, async () => {
        const { resourceLoadingManager } = await import('../../../resourceLoadingManager')
        await resourceLoadingManager.waitForResourcesReady()
      })

      const runtime = this.runtimeHost.getInstance(roomId)
      if (runtime) {
        for (const battlePlayerId of localRoom.battlePlayerIds) {
          await runtime.startReconnectGraceTimer(
            battlePlayerId as playerId,
            this.DISCONNECT_GRACE_PERIOD / 1000,
          )
        }
      }
    } catch (error) {
      logger.error({ error, roomId }, 'Battle ended with error')

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
    const runtime = await this.getRuntimeOrRecover(roomId, 'handleLocalPlayerAbandon')
    if (!runtime) {
      throw new Error('BATTLE_NOT_FOUND')
    }

    // 获取房间状态用于清理映射
    const roomState = await this.stateManager.getRoomState(roomId)

    // 通过提交投降选择终止玩家战斗
    await runtime.submitSurrenderSelection(playerId as playerId)

    // 立即清理会话到房间的映射，防止重连到已放弃的战斗
    if (roomState) {
      await this.callbacks.cleanupSessionRoomMappings(roomState)
      logger.info({ roomId, playerId }, 'Session room mappings cleaned up after player abandon')
    }

    // 清理本地房间
    await this.cleanupLocalRoom(roomId)

    logger.info({ roomId, playerId }, 'Local player abandon processed')
    return { status: 'ABANDONED' }
  }

  /**
   * 发布私人战斗结束事件
   */
  private async publishPrivateBattleFinishedEvent(
    roomCode: string,
    battleRoomId: string,
    battleResult: { winner: string | null; reason: string },
  ): Promise<void> {
    try {
      const publisher = this.stateManager.redisManager.getPublisher()
      const channel = 'private_battle_finished'
      const message = {
        roomCode,
        battleRoomId,
        battleResult,
      }
      await publisher.publish(channel, JSON.stringify(message))
      logger.info({ roomCode, battleRoomId }, 'Published private battle finished event')
    } catch (error) {
      logger.error({ error, roomCode, battleRoomId }, 'Failed to publish private battle finished event')
    }
  }

  /**
   * 处理战斗结束
   */

  /**
   * 清理本地房间
   */
  async cleanupLocalRoom(roomId: string, options: CleanupLocalRoomOptions = {}): Promise<void> {
    const {
      removeRuntimeArtifacts = true,
      releaseOwnership = true,
      publishCleanupEvent = true,
    } = options

    try {
      const runtime = this.runtimeHost.getInstance(roomId)
      if (runtime) {
        if (removeRuntimeArtifacts) {
          await this.cleanupBattleStateSnapshots(roomId, runtime.data.players)
        }
        if (releaseOwnership) {
          await this.ownershipCoordinator.markDraining(roomId, this.instanceId)
        }
        await cleanupLocalBattleRuntime(runtime.data)

        // 从本地映射中移除
        this.runtimeHost.remove(roomId)
        if (releaseOwnership) {
          await this.ownershipCoordinator.release(roomId, this.instanceId)
        }
        // this.localSpectators.delete(roomId) // 清理观战者

        // 发布清理通知到所有实例
        if (publishCleanupEvent) {
          try {
            const publisher = this.stateManager.redisManager.getPublisher()
            const channel = REDIS_KEYS.BATTLE_CONTROL_CHANNEL
            const message: CleanupEventPayload = { event: BattleControlEventType.Cleanup, roomId }
            await publisher.publish(channel, JSON.stringify(message))
          } catch (error) {
            logger.error({ error, roomId }, 'Failed to publish spectator cleanup message')
          }
        }

        // 更新活跃战斗房间数统计
        if (this.performanceTracker) {
          this.performanceTracker.updateActiveBattleRooms(this.runtimeHost.size())
        }

        logger.info(
          { roomId, removeRuntimeArtifacts, releaseOwnership, publishCleanupEvent },
          'Local room cleaned up',
        )
      }
    } catch (error) {
      logger.error({ error, roomId }, 'Error cleaning up local room')
      if (this.performanceTracker) {
        this.performanceTracker.recordError('room_cleanup_error', 'clusterBattleService')
      }
    }
  }

  private async cleanupBattleStateSnapshots(roomId: string, battlePlayers: string[]): Promise<void> {
    try {
      const roomState = await this.stateManager.getRoomState(roomId)
      const playerIds = new Set<string>(battlePlayers)
      if (roomState) {
        for (const sessionId of roomState.sessions) {
          const playerId = roomState.sessionPlayers[sessionId]
          if (playerId) {
            playerIds.add(playerId)
          }
        }
        for (const spectator of roomState.spectators) {
          playerIds.add(spectator.playerId)
        }
      }

      if (playerIds.size === 0) {
        return
      }

      const client = this.stateManager.redisManager.getClient()
      await Promise.all(
        Array.from(playerIds).map(playerId => client.del(REDIS_KEYS.BATTLE_RUNTIME_PLAYER_SNAPSHOT(roomId, playerId))),
      )
      await client.del(REDIS_KEYS.BATTLE_RUNTIME_BOOTSTRAP(roomId))
      await client.del(REDIS_KEYS.BATTLE_RUNTIME_ACTION_LOG(roomId))
      await client.del(REDIS_KEYS.BATTLE_RUNTIME_ACTION_SEQ(roomId))
      await client.del(REDIS_KEYS.BATTLE_RUNTIME_REPLAY_CURSOR(roomId))
      await client.del(REDIS_KEYS.BATTLE_RUNTIME_WORLD_SNAPSHOT(roomId))
    } catch (error) {
      logger.warn({ roomId, error }, 'Failed to cleanup battle state snapshots')
    }
  }

  /**
   * 本地处理计时器启用检查
   */
  async handleLocalIsTimerEnabled(roomId: string, playerId: string): Promise<boolean> {
    const runtime = await this.getRuntimeOrRecover(roomId, 'handleLocalIsTimerEnabled')
    if (!runtime) {
      throw new Error('BATTLE_NOT_FOUND')
    }
    return runtime.isTimerEnabled()
  }

  /**
   * 本地处理玩家计时器状态获取
   */
  async handleLocalGetPlayerTimerState(
    roomId: string,
    playerId: string,
    data: { playerId?: string },
  ): Promise<PlayerTimerState | null> {
    const runtime = await this.getRuntimeOrRecover(roomId, 'handleLocalGetPlayerTimerState')
    if (!runtime) {
      throw new Error('BATTLE_NOT_FOUND')
    }

    const targetPlayerId = data?.playerId || playerId
    const timerState = (await runtime.getAllPlayerTimerStates()).find(state => state.playerId === targetPlayerId) ?? null

    return timerState
  }

  /**
   * 本地处理所有玩家计时器状态获取
   */
  async handleLocalGetAllPlayerTimerStates(roomId: string, playerId: string): Promise<PlayerTimerState[]> {
    const runtime = await this.getRuntimeOrRecover(roomId, 'handleLocalGetAllPlayerTimerStates')
    if (!runtime) {
      throw new Error('BATTLE_NOT_FOUND')
    }
    return runtime.getAllPlayerTimerStates()
  }

  /**
   * 本地处理计时器配置获取
   */
  async handleLocalGetTimerConfig(roomId: string, playerId: string): Promise<TimerConfig> {
    const runtime = await this.getRuntimeOrRecover(roomId, 'handleLocalGetTimerConfig')
    if (!runtime) {
      throw new Error('BATTLE_NOT_FOUND')
    }
    return runtime.getTimerConfig()
  }

  /**
   * 本地处理动画开始
   */
  async handleLocalStartAnimation(
    roomId: string,
    playerId: string,
    data: { source: string; expectedDuration: number; ownerId: playerId },
  ): Promise<string> {
    const runtime = await this.getRuntimeOrRecover(roomId, 'handleLocalStartAnimation')
    if (!runtime) {
      throw new Error('BATTLE_NOT_FOUND')
    }

    if (!data.source || !data.expectedDuration || !data.ownerId) {
      throw new Error('INVALID_ANIMATION_DATA')
    }

    const animationId = await runtime.startAnimation(data.source, data.expectedDuration, data.ownerId as playerId)

    return animationId
  }

  /**
   * 本地处理动画结束
   */
  async handleLocalEndAnimation(
    roomId: string,
    playerId: string,
    data: { animationId: string; actualDuration?: number },
  ): Promise<{ status: string }> {
    const runtime = await this.getRuntimeOrRecover(roomId, 'handleLocalEndAnimation')
    if (!runtime) {
      throw new Error('BATTLE_NOT_FOUND')
    }

    if (data.animationId) {
      await runtime.endAnimation(data.animationId, data.actualDuration)
    }

    return { status: 'SUCCESS' }
  }

  /**
   * 本地处理动画结束报告
   */
  async handleLocalReportAnimationEnd(
    roomId: string,
    playerId: string,
    data: { animationId: string; actualDuration?: number },
  ): Promise<{ status: string }> {
    const runtime = await this.getRuntimeOrRecover(roomId, 'handleLocalReportAnimationEnd')
    if (!runtime) {
      throw new Error('BATTLE_NOT_FOUND')
    }

    if (data.animationId) {
      await runtime.endAnimation(data.animationId, data.actualDuration)
    }

    return { status: 'SUCCESS' }
  }

  // === 新增：中途加入观战 ===

  /**
   * 允许玩家中途加入观战
   */
  async joinSpectateBattle(roomId: string, spectator: { playerId: string; sessionId: string }): Promise<boolean> {
    const runtime = this.runtimeHost.getInstance(roomId)
    if (!runtime || runtime.status !== 'active') {
      logger.warn({ roomId, spectatorId: spectator.playerId }, 'Cannot join spectate: room not found or not active')
      return false
    }

    const roomState = await this.stateManager.getRoomState(roomId)
    if (!roomState) {
      logger.error({ roomId }, 'Room state not found for spectate join')
      return false
    }

    // 1. 将观战者加入房间
    await this.callbacks.joinPlayerToRoom(spectator.playerId, roomId)

    // 2. 更新 RoomState，将观战者持久化
    if (!roomState.spectators.some(s => s.sessionId === spectator.sessionId)) {
      roomState.spectators.push(spectator)
      roomState.sessionPlayers[spectator.sessionId] = spectator.playerId
      // 正确更新 sessions 列表
      if (!roomState.sessions.includes(spectator.sessionId)) {
        roomState.sessions.push(spectator.sessionId)
      }

      // 在更新 roomState 之前先更新映射
      try {
        const client = this.stateManager.redisManager.getClient()
        await client.sadd(REDIS_KEYS.SESSION_ROOM_MAPPING(spectator.playerId, spectator.sessionId), roomId)
        logger.info(
          { roomId, spectatorId: spectator.playerId, sessionId: spectator.sessionId },
          'Spectator session-room mapping created',
        )
      } catch (error) {
        logger.error({ error, roomId, spectator }, 'Failed to create spectator session-room mapping')
      }

      // 最后更新 roomState
      await this.stateManager.setRoomState(roomState)
    }

    // 3. 发送一次性的战斗状态快照给新加入的观战者
    const battleState = await runtime.getState(spectator.playerId as playerId, true) // true 表示上帝视角
    await this.callbacks.sendToPlayerSession(spectator.playerId, spectator.sessionId, 'battleEvent', {
      type: BattleMessageType.BattleStart, // 伪装成 BattleStart，让客户端能正确初始化
      data: battleState,
    })

    // 4. 将观战者添加到本地观战者列表中
    const spectators = this.localSpectators.get(roomId) || new Set()
    spectators.add(spectator)
    this.localSpectators.set(roomId, spectators)

    logger.info({ roomId, spectatorId: spectator.playerId }, 'Spectator joined battle successfully')
    return true
  }

  /**
   * 从房间中移除观战者
   */
  async removeSpectatorFromRoom(roomId: string, sessionId: string): Promise<void> {
    const roomState = await this.stateManager.getRoomState(roomId)
    if (!roomState || !roomState.spectators) {
      logger.warn({ roomId, sessionId }, 'Cannot remove spectator: room or spectators not found')
      return
    }

    const spectatorIndex = roomState.spectators.findIndex(s => s.sessionId === sessionId)
    if (spectatorIndex === -1) {
      logger.warn({ roomId, sessionId }, 'Cannot remove spectator: spectator not found')
      return
    }

    const spectator = roomState.spectators[spectatorIndex]
    roomState.spectators.splice(spectatorIndex, 1)

    roomState.sessions = roomState.sessions.filter(s => s !== sessionId)
    delete roomState.sessionPlayers[sessionId]

    await this.stateManager.setRoomState(roomState)

    // 从本地观战者列表中移除
    const localSpectators = this.localSpectators.get(roomId)
    if (localSpectators) {
      for (const s of localSpectators) {
        if (s.sessionId === sessionId) {
          localSpectators.delete(s)
          break
        }
      }
    }

    logger.info({ roomId, spectatorId: spectator.playerId, sessionId }, 'Spectator removed from room')
  }

  /**
   * 强制终止战斗（处理断线等情况）
   */
  async forceTerminateBattle(roomState: RoomState, playerId: string, reason: 'disconnect' | 'abandon'): Promise<void> {
    try {
      logger.warn({ roomId: roomState.id, playerId, reason, instanceId: roomState.instanceId }, '强制终止战斗')

      // 如果战斗在当前实例，直接调用战斗逻辑
      if (roomState.instanceId === this.instanceId) {
        await this.handleLocalBattleTerminationInternal(roomState.id, playerId, reason)
      } else {
        // 通知正确的实例终止战斗
        await this.callbacks.forwardPlayerAction(roomState.instanceId, 'force-terminate-battle', playerId, {
          roomId: roomState.id,
          reason,
        })
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
          await this.callbacks.sendToPlayerSession(pid, sessionId, 'battleEvent', {
            type: 'BattleEnd',
            data: {
              winner: players.find(p => p !== playerId) || null,
              reason: reason === 'disconnect' ? 'disconnect' : 'surrender',
            },
          })
          await this.callbacks.sendToPlayerSession(pid, sessionId, 'roomClosed', { roomId: roomState.id })
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

      const runtime = this.runtimeHost.getInstance(roomId)
      if (runtime) {
        await runtime.submitSurrenderSelection(playerId as playerId)
        logger.info({ roomId, playerId, reason }, 'Local battle terminated via surrender selection')
      }

      // 立即清理会话到房间的映射，防止重连到已终止的战斗
      if (roomState) {
        await this.callbacks.cleanupSessionRoomMappings(roomState)
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
   * 清理资源
   */
  async cleanup(): Promise<void> {
    try {
      logger.info('开始清理 ClusterBattleService 资源')
      this.stopOwnershipLeaseRenewalLoop()

      // 清理所有本地房间
      const localRoomIds = this.runtimeHost.listRoomIds()
      await Promise.all(
        localRoomIds.map(roomId =>
          this.cleanupLocalRoom(roomId, {
            removeRuntimeArtifacts: false,
            publishCleanupEvent: false,
          })),
      )

      // 清理所有断线玩家信息
      this.clearAllDisconnectedPlayers()

      // 清理Timer系统
      this.timerEventBatcher.cleanup()

      // 清理战报服务
      if (this.battleReportService) {
        await this.battleReportService.cleanup()
      }

      logger.info('ClusterBattleService 资源清理完成')
    } catch (error) {
      logger.error({ error }, 'Error during ClusterBattleService cleanup')
    }
  }

  /**
   * 获取战斗状态（详细）
   */
  async handleLocalGetBattleState(roomId: string, playerId: string): Promise<BattleState> {
    const runtime = await this.getRuntimeOrRecover(roomId, 'handleLocalGetBattleState')
    if (!runtime) {
      throw new Error('BATTLE_NOT_FOUND')
    }
    return runtime.getState()
  }

  /**
   * 获取战斗历史
   */
  async handleLocalGetBattleHistory(roomId: string, _playerId: string): Promise<BattleState> {
    const runtime = await this.getRuntimeOrRecover(roomId, 'handleLocalGetBattleHistory')
    if (!runtime) {
      throw new Error('BATTLE_NOT_FOUND')
    }
    return runtime.getState()
  }

  /**
   * 获取战斗报告
   */
  async handleLocalGetBattleReport(roomId: string, _playerId: string): Promise<{ battleRecordId: string }> {
    const runtime = await this.getRuntimeOrRecover(roomId, 'handleLocalGetBattleReport')
    if (!runtime || !runtime.data.battleRecordId) {
      throw new Error('BATTLE_REPORT_NOT_FOUND')
    }

    if (this.battleReportService) {
      // 返回战斗记录ID，让客户端自行获取报告
      return { battleRecordId: runtime.data.battleRecordId }
    }

    throw new Error('BATTLE_REPORT_SERVICE_NOT_AVAILABLE')
  }

  // === 批量消息处理方法 ===

  /**
   * 批量发送消息到玩家会话
   */
  async addToBatch(playerId: string, sessionId: string, message: BattleMessage): Promise<void> {
    const sessionKey = `${playerId}:${sessionId}`
    const now = Date.now()

    let batch = this.messageBatches.get(sessionKey)
    if (!batch) {
      batch = { messages: [], timer: null, createdAt: now }
      this.messageBatches.set(sessionKey, batch)
    }

    // 检查批次是否过期，如果过期则先清理
    if (now - batch.createdAt > this.MAX_BATCH_AGE) {
      await this.flushBatch(sessionKey)
      // 创建新批次
      batch = { messages: [], timer: null, createdAt: now }
      this.messageBatches.set(sessionKey, batch)
    }

    // 清除之前的定时器
    if (batch.timer) {
      clearTimeout(batch.timer)
    }

    // 添加消息到批次
    batch.messages.push(message)

    // 检查是否需要立即发送
    const shouldSendImmediately =
      batch.messages.length >= this.BATCH_SIZE || this.IMMEDIATE_MESSAGE_TYPES.has(message.type)

    if (shouldSendImmediately) {
      await this.flushBatch(sessionKey)
    } else {
      // 设置定时器，在超时后发送
      batch.timer = setTimeout(() => {
        this.flushBatch(sessionKey).catch(error => {
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
    const messages = [...batch.messages] // 复制消息数组

    // 清理批次
    if (batch.timer) {
      clearTimeout(batch.timer)
    }
    this.messageBatches.delete(sessionKey)

    try {
      // 直接发送，不等待结果，不重试
      const sendPromise =
        messages.length === 1
          ? this.callbacks.sendToPlayerSession(playerId, sessionId, 'battleEvent', messages[0])
          : this.callbacks.sendToPlayerSession(playerId, sessionId, 'battleEventBatch', messages)

      // 不等待发送结果，避免阻塞
      sendPromise.catch(error => {
        logger.debug(
          { error, playerId, sessionId, messageCount: messages.length },
          'Failed to send batch messages (non-blocking)',
        )
      })
    } catch (error) {
      logger.debug(
        { error, playerId, sessionId, messageCount: messages.length },
        'Error creating send promise for batch',
      )
    }
  }

  /**
   * 清理所有批量消息
   */
  async cleanupAllBatches(): Promise<void> {
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
  async cleanupPlayerBatches(playerId: string, sessionId: string): Promise<void> {
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

  // === 新增：观战者消息批处理 ===

  async addToSpectatorBatch(roomId: string, message: BattleMessage): Promise<void> {
    // // 优化：如果房间中没有任何观战者，则不进行广播
    // const roomState = await this.stateManager.getRoomState(roomId)
    // if (!roomState || !roomState.spectators || roomState.spectators.length === 0) {
    //   return
    // }

    const now = Date.now()

    let batch = this.spectatorMessageBatches.get(roomId)
    if (!batch) {
      batch = { messages: [], timer: null, createdAt: now }
      this.spectatorMessageBatches.set(roomId, batch)
    }

    if (now - batch.createdAt > this.MAX_BATCH_AGE) {
      await this.flushSpectatorBatch(roomId)
      batch = { messages: [], timer: null, createdAt: now }
      this.spectatorMessageBatches.set(roomId, batch)
    }

    if (batch.timer) {
      clearTimeout(batch.timer)
    }

    batch.messages.push(message)

    const shouldSendImmediately =
      batch.messages.length >= this.BATCH_SIZE || this.IMMEDIATE_MESSAGE_TYPES.has(message.type)

    if (shouldSendImmediately) {
      await this.flushSpectatorBatch(roomId)
    } else {
      batch.timer = setTimeout(() => {
        this.flushSpectatorBatch(roomId).catch(error => {
          logger.error({ error, roomId }, 'Error flushing spectator batch on timeout')
        })
      }, this.BATCH_TIMEOUT)
    }
  }

  private async flushSpectatorBatch(roomId: string): Promise<void> {
    const batch = this.spectatorMessageBatches.get(roomId)
    if (!batch || batch.messages.length === 0) {
      return
    }

    const messages = [...batch.messages]

    if (batch.timer) {
      clearTimeout(batch.timer)
    }
    this.spectatorMessageBatches.delete(roomId)

    try {
      const publisher = this.stateManager.redisManager.getPublisher()
      const channel = `spectate:${roomId}`
      // 直接发布序列化后的消息数组
      await publisher.publish(channel, JSON.stringify(messages))
    } catch (error) {
      logger.error({ error, roomId }, 'Failed to publish spectator message batch to Redis')
    }
  }

  // === 重连相关方法 ===

  /**
   * 暂停战斗计时器（玩家掉线时）
   */
  async pauseBattleForDisconnect(roomId: string, playerId: string): Promise<void> {
    const runtime = await this.getRuntimeOrRecover(roomId, 'pauseBattleForDisconnect')
    if (!runtime) return
    if (!runtime.isBattlePlayer(playerId)) {
      logger.info({ roomId, playerId }, '观战者掉线，不暂停计时器')
      return
    }
    const started = await runtime.startReconnectGraceTimer(
      playerId as playerId,
      this.DISCONNECT_GRACE_PERIOD / 1000,
    )
    if (!started) {
      logger.warn({ roomId, playerId }, '玩家掉线：当前运行时不支持重连宽限计时器')
      return
    }
    logger.info(
      {
        roomId,
        playerId,
        gracePeriodMs: this.DISCONNECT_GRACE_PERIOD,
      },
      '玩家掉线：已启动 v2 重连宽限计时器',
    )
  }

  /**
   * 恢复战斗计时器（玩家重连时）
   */
  async resumeBattleAfterReconnect(roomId: string, playerId: string): Promise<void> {
    const runtime = await this.getRuntimeOrRecover(roomId, 'resumeBattleAfterReconnect')
    if (!runtime) return
    if (!runtime.isBattlePlayer(playerId)) return
    const cancelled = await runtime.cancelReconnectGraceTimer(playerId as playerId)
    if (!cancelled) {
      logger.debug({ roomId, playerId }, '玩家重连：当前运行时没有活跃重连宽限计时器')
      return
    }
    logger.info({ roomId, playerId }, '玩家重连：已取消 v2 重连宽限计时器')
  }

  /**
   * 通知对手玩家掉线
   */
  async notifyOpponentDisconnect(roomId: string, disconnectedPlayerId: string): Promise<void> {
    try {
      const roomState = await this.stateManager.getRoomState(roomId)
      if (!roomState) return

      // 找到对手并通知
      for (const sessionId of roomState.sessions) {
        const playerId = roomState.sessionPlayers[sessionId]
        if (playerId && playerId !== disconnectedPlayerId) {
          await this.callbacks.sendToPlayerSession(playerId, sessionId, 'opponentDisconnected', {
            disconnectedPlayerId,
            graceTimeRemaining: this.DISCONNECT_GRACE_PERIOD,
          })
        }
      }
    } catch (error) {
      logger.error({ error, roomId, disconnectedPlayerId }, 'Failed to notify opponent of disconnect')
    }
  }

  /**
   * 发送战斗状态给重连的玩家
   */
  async sendBattleStateOnReconnect(roomId: string, playerId: string, sessionId: string): Promise<void> {
    try {
      const runtime = await this.getRuntimeOrRecover(roomId, 'sendBattleStateOnReconnect')
      if (runtime) {
        // 重连时，让客户端重新获取完整的战斗状态
        // 不需要通过事件发送，客户端会主动调用 getState
        logger.info({ roomId, playerId, sessionId }, '玩家重连，准备发送战斗状态')

        // 可以发送一个重连成功的通知
        await this.callbacks.sendToPlayerSession(playerId, sessionId, 'reconnectSuccess', {
          roomId,
          message: '重连成功，战斗继续',
        })
      }
    } catch (error) {
      logger.error({ error, roomId, playerId, sessionId }, 'Failed to send battle state on reconnect')
    }
  }

  // === 新增：观战者消息转发 ===

  /**
   * 将从Redis收到的观战消息转发给本地观战者
   */
  async forwardSpectatorMessage(roomId: string, messages: BattleMessage | BattleMessage[]): Promise<void> {
    const localSpectators = this.localSpectators.get(roomId)
    if (!localSpectators || localSpectators.size === 0) {
      return
    }

    const messagesArray = Array.isArray(messages) ? messages : [messages]
    if (messagesArray.length === 0) {
      return
    }

    try {
      const event = messagesArray.length > 1 ? 'battleEventBatch' : 'battleEvent'
      const payload = messagesArray.length > 1 ? messagesArray : messagesArray[0]

      const promises = Array.from(localSpectators).map(spectator => {
        this.callbacks.sendToPlayerSession(spectator.playerId, spectator.sessionId, event, payload)
      })
      await Promise.all(promises)
    } catch (error) {
      logger.error({ error, roomId }, 'Failed to forward spectator message(s)')
    }
  }

  /**
   * 清理指定房间的本地观战者列表（由Redis广播调用）
   */
  cleanupSpectatorsForRoom(roomId: string): void {
    if (this.localSpectators.has(roomId)) {
      this.localSpectators.delete(roomId)
      logger.info(
        { roomId, instanceId: this.instanceId },
        'Cleaned up local spectators for room after BATTLE_CLEANUP event',
      )
    }
  }
}
