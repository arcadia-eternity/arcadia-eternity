import { Battle, setGlobalLogger, type Player } from '@arcadia-eternity/battle'
import {
  type BattleState,
  BattleMessageType,
  type playerId,
  type BattleMessage,
  type TimerEvent,
  type TimerSnapshot,
  type PlayerTimerState,
  type TimerConfig,
  TimerEventType,
} from '@arcadia-eternity/const'
import { SelectionParser } from '@arcadia-eternity/parser'
import type { PlayerSelectionSchemaType } from '@arcadia-eternity/schema'

import pino from 'pino'
import type { ClusterStateManager } from '../../../cluster/core/clusterStateManager'
import type { DistributedLockManager } from '../../../cluster/redis/distributedLock'
import type { PerformanceTracker } from '../../../cluster/monitoring/performanceTracker'
import type { SocketClusterAdapter } from '../../../cluster/communication/socketClusterAdapter'

import type { RoomState, MatchmakingEntry } from '../../../cluster/types'
import { BattleReportService, type BattleReportConfig } from '../../report/services/battleReportService'
import { TimerEventBatcher } from './timerEventBatcher'
import { ServerRuleIntegration, type BattleRuleManager } from '@arcadia-eternity/rules'
import type { BattleCallbacks, IBattleService } from './interfaces'
import { TYPES } from '../../../types'
import { injectable, inject, optional } from 'inversify'
import { PlayerParser } from '@arcadia-eternity/parser'
import { nanoid } from 'nanoid'
import { LOCK_KEYS } from '../../../cluster/redis/distributedLock'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  formatters: {
    level: label => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
})

type LocalRoomData = {
  id: string
  battle: Battle
  players: string[] // playerIds
  playersReady: Set<string>
  status: 'waiting' | 'active' | 'ended'
  lastActive: number
  battleRecordId?: string
  privateRoom?: boolean
}

type DisconnectedPlayerInfo = {
  playerId: string
  sessionId: string
  roomId: string
  disconnectTime: number
  graceTimer: ReturnType<typeof setTimeout>
}

@injectable()
export class ClusterBattleService implements IBattleService {
  private readonly DISCONNECT_GRACE_PERIOD = 60000 // 60秒掉线宽限期

  // 本地Battle实例管理
  private readonly localBattles = new Map<string, Battle>() // roomId -> Battle
  private readonly localRooms = new Map<string, LocalRoomData>() // roomId -> room data
  private readonly disconnectedPlayers = new Map<string, DisconnectedPlayerInfo>() // 掉线玩家管理

  // Timer事件批处理系统
  private readonly timerEventBatcher: TimerEventBatcher

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

  private battleReportService?: BattleReportService

  constructor(
    @inject(TYPES.ClusterStateManager) private readonly stateManager: ClusterStateManager,
    @inject(TYPES.DistributedLockManager) private readonly lockManager: DistributedLockManager,
    @inject(TYPES.SocketClusterAdapter) private readonly socketAdapter: SocketClusterAdapter,
    @inject(TYPES.BattleCallbacks) private readonly callbacks: BattleCallbacks,
    @inject(TYPES.InstanceId) private readonly instanceId: string,
    @inject(TYPES.PerformanceTracker) @optional() private readonly performanceTracker?: PerformanceTracker,
    @inject(TYPES.BattleReportConfig) @optional() private readonly _battleReportConfig?: BattleReportConfig,
  ) {
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
  }

  /**
   * 创建本地Battle实例
   */
  async createLocalBattle(roomState: RoomState, player1Data: Player, player2Data: Player): Promise<Battle> {
    // 获取规则集信息
    const ruleSetId = roomState.metadata?.ruleSetId || 'casual_standard_ruleset'

    logger.info(
      {
        roomId: roomState.id,
        ruleSetId,
        player1: player1Data.name,
        player2: player2Data.name,
      },
      'Creating battle with rule set',
    )

    let battle: Battle
    let ruleManager: BattleRuleManager | null = null

    try {
      // 将Player实例的team转换为规则验证所需的Team格式
      const convertPlayerTeamToSchema = (player: Player) => {
        return player.team.map(pet => ({
          id: pet.id,
          name: pet.name,
          species: pet.species.id, // 转换Species对象为字符串ID
          level: pet.level,
          evs: pet.evs,
          ivs: pet.ivs,
          skills: pet.skills.map(skill => skill.id), // 转换Skill对象为字符串ID
          gender: pet.gender,
          nature: pet.nature,
          ability: pet.ability?.id || '', // 转换Mark对象为字符串ID
          emblem: pet.emblem?.id, // 转换Mark对象为字符串ID
          height: pet.height,
          weight: pet.weight,
        }))
      }

      // 使用规则系统验证战斗创建并应用规则
      const battleValidation = await ServerRuleIntegration.validateBattleCreation(
        convertPlayerTeamToSchema(player1Data),
        convertPlayerTeamToSchema(player2Data),
        [ruleSetId],
        {
          allowFaintSwitch: true,
          showHidden: false,
        },
      )

      // 检查验证结果
      if (!battleValidation.validation.isValid) {
        const errorMessage = `战斗验证失败: ${battleValidation.validation.errors.map(e => e.message).join(', ')}`
        logger.error(
          {
            roomId: roomState.id,
            ruleSetId,
            errors: battleValidation.validation.errors,
          },
          errorMessage,
        )
        throw new Error(errorMessage)
      }

      // 使用规则修改后的选项创建战斗
      battle = new Battle(player1Data, player2Data, battleValidation.battleOptions)
      ruleManager = battleValidation.ruleManager

      // 绑定规则管理器到战斗
      await ServerRuleIntegration.bindRulesToBattle(battle, ruleManager)

      logger.info(
        {
          roomId: roomState.id,
          ruleSetId,
          battleOptions: battleValidation.battleOptions,
        },
        'Battle created with rule system successfully',
      )
    } catch (error) {
      logger.warn(
        {
          roomId: roomState.id,
          ruleSetId,
          error: error instanceof Error ? error.message : error,
        },
        'Failed to use rule system, falling back to default battle creation',
      )

      // 如果规则系统失败，回退到默认创建方式
      battle = new Battle(player1Data, player2Data, {
        showHidden: false,
        timerConfig: {
          enabled: true,
          turnTimeLimit: 30,
          totalTimeLimit: 1500,
          animationPauseEnabled: true,
          maxAnimationDuration: 20000,
        },
        teamSelection: {
          enabled: false, // 默认不启用团队选择
        },
      })
    }

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
      privateRoom: roomState.metadata?.privateRoom,
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

        // 先创建本地Battle实例
        const session1 = player1Entry.sessionId || player1Entry.metadata?.sessionId || 'default'
        const session2 = player2Entry.sessionId || player2Entry.metadata?.sessionId || 'default'

        // 获取规则集信息，优先使用player1的规则集，如果不存在则使用player2的，最后默认为休闲规则集
        const ruleSetId = player1Entry.ruleSetId || player2Entry.ruleSetId || 'casual_standard_ruleset'

        // 检查是否是私人房间战斗
        const isPrivateRoom = player1Entry.metadata?.privateRoom || player2Entry.metadata?.privateRoom || false
        const roomCode = player1Entry.metadata?.roomCode || player2Entry.metadata?.roomCode

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
            ruleSetId, // 添加规则集信息
            privateRoom: isPrivateRoom,
            roomCode: roomCode,
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
        await this.callbacks.joinPlayerToRoom(player1Entry.playerId, roomId)
        await this.callbacks.joinPlayerToRoom(player2Entry.playerId, roomId)

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

  /**
   * 获取本地战斗实例
   */
  getLocalBattle(roomId: string): Battle | undefined {
    return this.localBattles.get(roomId)
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
  getLocalRoom(roomId: string): LocalRoomData | undefined {
    return this.localRooms.get(roomId)
  }

  /**
   * 获取所有本地房间
   */
  getAllLocalRooms(): Map<string, LocalRoomData> {
    return new Map(this.localRooms)
  }

  /**
   * 获取所有本地战斗
   */
  getAllLocalBattles(): Map<string, Battle> {
    return new Map(this.localBattles)
  }

  /**
   * 获取断线玩家信息
   */
  getDisconnectedPlayer(key: string): DisconnectedPlayerInfo | undefined {
    return this.disconnectedPlayers.get(key)
  }

  /**
   * 添加断线玩家信息
   */
  addDisconnectedPlayer(playerId: string, sessionId: string, roomId: string): void {
    const key = `${playerId}:${sessionId}`
    const info: DisconnectedPlayerInfo = {
      playerId,
      sessionId,
      roomId,
      disconnectTime: Date.now(),
      graceTimer: setTimeout(() => {
        this.removeDisconnectedPlayer(key)
      }, this.DISCONNECT_GRACE_PERIOD),
    }
    this.disconnectedPlayers.set(key, info)
  }

  /**
   * 移除断线玩家信息
   */
  removeDisconnectedPlayer(key: string): void {
    const info = this.disconnectedPlayers.get(key)
    if (info?.graceTimer) {
      clearTimeout(info.graceTimer)
    }
    this.disconnectedPlayers.delete(key)
  }

  /**
   * 清理所有断线玩家信息
   */
  clearAllDisconnectedPlayers(): void {
    for (const [key, info] of this.disconnectedPlayers.entries()) {
      if (info.graceTimer) {
        clearTimeout(info.graceTimer)
      }
    }
    this.disconnectedPlayers.clear()
  }

  /**
   * 获取Timer事件批处理器
   */
  getTimerEventBatcher(): TimerEventBatcher {
    return this.timerEventBatcher
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
      this.startBattleAsync(roomId, localRoom).catch((error: unknown) => {
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
        const { resourceLoadingManager } = await import('../../../resourceLoadingManager')
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

      // If it's a private room, publish an event
      if (localRoom.privateRoom && roomState && roomState.metadata?.roomCode) {
        await this.publishPrivateBattleFinishedEvent(roomState.metadata.roomCode, roomId, battleEndData)
      }

      // 立即清理会话到房间的映射，防止重连到已结束的战斗
      if (roomState) {
        await this.callbacks.cleanupSessionRoomMappings(roomState)
        logger.info({ roomId }, 'Session room mappings cleaned up immediately after battle end')
      }

      // 通知所有玩家房间关闭（基于session）
      if (roomState) {
        for (const sessionId of roomState.sessions) {
          const playerId = roomState.sessionPlayers[sessionId]
          if (playerId) {
            await this.callbacks.sendToPlayerSession(playerId, sessionId, 'roomClosed', { roomId })
          }
        }
      }

      // 延迟清理其他资源，给客户端一些时间处理战斗结束事件
      setTimeout(async () => {
        await this.cleanupLocalRoom(roomId)

        // 从集群中移除房间状态
        await this.stateManager.removeRoomState(roomId)

        logger.info({ roomId, winner: battleEndData.winner, reason: battleEndData.reason }, 'Battle cleanup completed')
      }, 5000) // 5秒延迟
    } catch (error) {
      logger.error({ error, roomId }, 'Error handling battle end')
    }
  }

  /**
   * 清理本地房间
   */
  async cleanupLocalRoom(roomId: string): Promise<void> {
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
        this.performanceTracker.recordError('room_cleanup_error', 'clusterBattleService')
      }
    }
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
  async handleLocalGetPlayerTimerState(
    roomId: string,
    playerId: string,
    data: { playerId?: string },
  ): Promise<PlayerTimerState | null> {
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
  async handleLocalGetAllPlayerTimerStates(roomId: string, playerId: string): Promise<PlayerTimerState[]> {
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
  async handleLocalGetTimerConfig(roomId: string, playerId: string): Promise<TimerConfig> {
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
  async handleLocalStartAnimation(
    roomId: string,
    playerId: string,
    data: { source: string; expectedDuration: number; ownerId: playerId },
  ): Promise<string> {
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
  async handleLocalEndAnimation(
    roomId: string,
    playerId: string,
    data: { animationId: string; actualDuration?: number },
  ): Promise<{ status: string }> {
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
   * 本地处理动画结束报告
   */
  async handleLocalReportAnimationEnd(
    roomId: string,
    playerId: string,
    data: { animationId: string; actualDuration?: number },
  ): Promise<{ status: string }> {
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

      const battle = this.getLocalBattle(roomId)
      if (battle) {
        // 调用战斗的放弃方法，这会触发战斗结束逻辑
        battle.abandonPlayer(playerId as playerId)
        logger.info({ roomId, playerId, reason }, 'Local battle terminated via abandonPlayer')
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

      // 清理所有本地房间
      const localRoomIds = Array.from(this.localRooms.keys())
      await Promise.all(localRoomIds.map(roomId => this.cleanupLocalRoom(roomId)))

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
    const battle = this.localBattles.get(roomId)
    if (!battle) {
      throw new Error('BATTLE_NOT_FOUND')
    }
    // 使用现有的 getState 方法
    return battle.getState()
  }

  /**
   * 获取战斗历史
   */
  async handleLocalGetBattleHistory(roomId: string, _playerId: string): Promise<BattleState> {
    const battle = this.localBattles.get(roomId)
    if (!battle) {
      throw new Error('BATTLE_NOT_FOUND')
    }
    // 返回战斗的状态作为历史
    return battle.getState()
  }

  /**
   * 获取战斗报告
   */
  async handleLocalGetBattleReport(roomId: string, _playerId: string): Promise<{ battleRecordId: string }> {
    const localRoom = this.localRooms.get(roomId)
    if (!localRoom || !localRoom.battleRecordId) {
      throw new Error('BATTLE_REPORT_NOT_FOUND')
    }

    if (this.battleReportService) {
      // 返回战斗记录ID，让客户端自行获取报告
      return { battleRecordId: localRoom.battleRecordId }
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

  // === 重连相关方法 ===

  /**
   * 暂停战斗计时器（玩家掉线时）
   */
  async pauseBattleForDisconnect(roomId: string, playerId: string): Promise<void> {
    const battle = this.localBattles.get(roomId)
    if (battle) {
      // 暂停该玩家的计时器
      battle.timerManager.pauseTimers([playerId as playerId], 'system')
      logger.info({ roomId, playerId }, '玩家掉线，暂停计时器')
    }
  }

  /**
   * 恢复战斗计时器（玩家重连时）
   */
  async resumeBattleAfterReconnect(roomId: string, playerId: string): Promise<void> {
    const battle = this.localBattles.get(roomId)
    if (battle) {
      // 恢复该玩家的计时器
      battle.timerManager.resumeTimers([playerId as playerId])
      logger.info({ roomId, playerId }, '玩家重连，恢复计时器')
    }
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
      const battle = this.localBattles.get(roomId)
      if (battle) {
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
}
