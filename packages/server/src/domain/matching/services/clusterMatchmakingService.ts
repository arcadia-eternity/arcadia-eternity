import { injectable, inject, optional } from 'inversify'
import { PlayerParser } from '@arcadia-eternity/parser'
import type { AckResponse, ErrorResponse } from '@arcadia-eternity/protocol'
import { PlayerSchema } from '@arcadia-eternity/schema'
import pino from 'pino'
import { ZodError } from 'zod'
import type { Socket } from 'socket.io'
import type { ClusterStateManager } from '../../../cluster/core/clusterStateManager'
import type { SocketClusterAdapter } from '../../../cluster/communication/socketClusterAdapter'
import type { DistributedLockManager } from '../../../cluster/redis/distributedLock'
import { LOCK_KEYS } from '../../../cluster/redis/distributedLock'
import type { PerformanceTracker } from '../../../cluster/monitoring/performanceTracker'
import type { MatchmakingEntry, ServiceInstance } from '../../../cluster/types'
import { BattleRpcClient } from '../../../cluster/communication/rpc/battleRpcClient'
import type { ServiceDiscoveryManager } from '../../../cluster/discovery/serviceDiscovery'
import type {
  IResourceLoadingManager,
  MatchmakingCallbacks,
  IMatchmakingService,
} from '../../battle/services/interfaces'
import type { SessionStateManager } from '../../session/sessionStateManager'
import { TYPES } from '../../../types'
import { MatchingStrategyFactory } from '../strategies/MatchingStrategyFactory'
import { MatchingConfigManager } from './MatchingConfigManager'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  formatters: {
    level: label => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
})

@injectable()
export class ClusterMatchmakingService implements IMatchmakingService {
  private rpcClient: BattleRpcClient
  private matchingConfigManager: MatchingConfigManager
  private periodicMatchingTimer: NodeJS.Timeout | null = null
  private periodicMatchingEnabled = true
  private periodicMatchingInterval = 15000 // 15秒

  constructor(
    @inject(TYPES.ClusterStateManager) private readonly stateManager: ClusterStateManager,
    @inject(TYPES.SocketClusterAdapter) private readonly socketAdapter: SocketClusterAdapter,
    @inject(TYPES.DistributedLockManager) private readonly lockManager: DistributedLockManager,
    @inject(TYPES.MatchmakingCallbacks) private readonly callbacks: MatchmakingCallbacks,
    @inject(TYPES.ResourceLoadingManager) private readonly resourceLoadingManager: IResourceLoadingManager,
    @inject(TYPES.InstanceId) private readonly instanceId: string,
    @inject(TYPES.SessionStateManager) private readonly sessionStateManager: SessionStateManager,
    @inject(TYPES.PerformanceTracker) @optional() private readonly performanceTracker?: PerformanceTracker,
    @inject(TYPES.ServiceDiscoveryManager) @optional() private readonly serviceDiscovery?: ServiceDiscoveryManager,
  ) {
    this.rpcClient = new BattleRpcClient()
    this.matchingConfigManager = MatchingConfigManager.getInstance()
    this.startPeriodicMatching()
  }

  /**
   * 处理加入匹配队列
   */
  async handleJoinMatchmaking(
    socket: Socket,
    rawData: unknown,
    ack?: AckResponse<{ status: 'QUEUED' }>,
  ): Promise<void> {
    try {
      const playerId = socket.data?.playerId
      const sessionId = socket.data?.sessionId

      if (!playerId || !sessionId) {
        ack?.({ status: 'ERROR', code: 'AUTHENTICATION_REQUIRED', details: '需要认证' })
        return
      }

      // 检查 session 状态，确保不与私人房间冲突
      const stateCheck = await this.sessionStateManager.canEnterMatchmaking(playerId, sessionId)
      if (!stateCheck.allowed) {
        logger.warn(
          { playerId, sessionId, reason: stateCheck.reason },
          'Session cannot enter matchmaking due to state conflict',
        )
        ack?.({ status: 'ERROR', code: 'STATE_CONFLICT', details: stateCheck.reason })
        return
      }

      // 首先检查游戏资源是否已加载完成
      try {
        if (!this.resourceLoadingManager.isReady()) {
          const progress = this.resourceLoadingManager.getProgress()
          logger.warn(
            {
              socketId: socket.id,
              playerId: socket.data.playerId,
              resourceStatus: progress.status,
              resourceError: progress.error,
            },
            '玩家尝试加入匹配队列但游戏资源尚未加载完成',
          )

          if (ack) {
            ack({
              status: 'ERROR',
              code: 'RESOURCES_NOT_READY',
              details: `游戏资源正在加载中，请稍后再试。状态: ${progress.status}, 游戏数据: ${progress.gameDataLoaded ? '已加载' : '未加载'}, 脚本: ${progress.scriptsLoaded ? '已加载' : '未加载'}, 验证: ${progress.validationCompleted ? '已完成' : '未完成'}`,
            })
          }
          return
        }

        logger.debug(
          {
            socketId: socket.id,
            playerId: socket.data.playerId,
          },
          '游戏资源已准备就绪，允许加入匹配队列',
        )
      } catch (error) {
        logger.error(
          {
            error,
            socketId: socket.id,
            playerId: socket.data.playerId,
          },
          '检查游戏资源状态时发生错误',
        )

        if (ack) {
          ack({
            status: 'ERROR',
            code: 'RESOURCE_CHECK_FAILED',
            details: '无法检查游戏资源状态，请稍后再试',
          })
        }
        return
      }

      // 解析数据格式，支持旧格式和新格式
      let rawPlayerData: unknown
      let ruleSetId: string = 'standard'

      // 类型守卫：检查是否为新格式
      const isNewFormat = (data: unknown): data is { playerSchema: unknown; ruleSetId?: string } => {
        return data !== null && typeof data === 'object' && 'playerSchema' in data
      }

      if (isNewFormat(rawData)) {
        // 新格式：包含规则集信息
        rawPlayerData = rawData.playerSchema
        ruleSetId = rawData.ruleSetId || 'standard'
      } else {
        // 旧格式：直接是 PlayerSchemaType
        rawPlayerData = rawData
      }

      // 验证原始数据格式
      const validatedRawData = this.validateRawPlayerData(rawPlayerData)

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

      // 验证队伍是否符合规则集要求
      try {
        const { ServerRuleIntegration } = await import('@arcadia-eternity/rules')
        // 将Pet[]转换为PetSchemaType[]格式用于验证
        const teamForValidation = playerData.team.map(pet => ({
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
        const teamValidation = await ServerRuleIntegration.validateTeamWithRuleSet(teamForValidation, ruleSetId)

        if (!teamValidation.isValid) {
          const errorMessage = teamValidation.errors[0]?.message || '队伍不符合规则要求'
          logger.warn(
            {
              socketId: socket.id,
              playerId,
              ruleSetId,
              validationErrors: teamValidation.errors,
            },
            '队伍验证失败，拒绝加入匹配',
          )
          throw new Error(`TEAM_VALIDATION_FAILED: ${errorMessage}`)
        }

        logger.info(
          {
            socketId: socket.id,
            playerId,
            ruleSetId,
            teamSize: playerData.team.length,
          },
          '队伍验证通过',
        )
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('TEAM_VALIDATION_FAILED:')) {
          throw error
        }
        logger.error({ error, playerId, ruleSetId }, '队伍验证过程中发生错误')
        throw new Error('TEAM_VALIDATION_ERROR')
      }

      // 使用队列专用锁确保队列操作的原子性
      await this.lockManager.withLock(LOCK_KEYS.MATCHMAKING_QUEUE, async () => {
        // 添加到集群匹配队列 - 存储原始验证过的数据而不是解析后的实例
        const entry: MatchmakingEntry = {
          playerId,
          joinTime: Date.now(),
          playerData: validatedRawData, // 存储原始数据而不是Player实例
          sessionId: socket.data.sessionId,
          ruleSetId,
          metadata: {
            sessionId: socket.data.sessionId,
            ruleSetId,
          },
        }

        // 使用基于规则的队列管理
        await this.stateManager.addToMatchmakingQueue(entry)

        // 设置 session 状态为匹配中
        await this.sessionStateManager.setSessionState(playerId, sessionId, 'matchmaking', {
          queueId: ruleSetId,
        })

        // 更新匹配队列大小统计
        if (this.performanceTracker) {
          const queueSize = await this.stateManager.getMatchmakingQueueSize()
          this.performanceTracker.updateMatchmakingQueueSize(queueSize)
        }

        // 玩家加入队列后广播服务器状态更新
        this.callbacks.broadcastServerStateUpdate?.()

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
          inputData: rawData,
        },
        '加入匹配队列失败',
      )
      this.handleValidationError(error, socket, ack)
    }
  }

  /**
   * 处理取消匹配
   */
  async handleCancelMatchmaking(socket: Socket, ack?: AckResponse<{ status: 'CANCELED' }>): Promise<void> {
    try {
      const playerId = socket.data.playerId
      const sessionId = socket.data.sessionId

      if (!playerId || !sessionId) {
        ack?.({ status: 'ERROR', code: 'PLAYER_ID_MISSING', details: 'Player ID or session ID is required' })
        return
      }

      // 从匹配队列中移除
      await this.stateManager.removeFromMatchmakingQueue(playerId, sessionId)

      // 清除 session 状态
      await this.sessionStateManager.clearSessionState(playerId, sessionId)

      // 更新匹配队列大小统计
      if (this.performanceTracker) {
        const queueSize = await this.stateManager.getMatchmakingQueueSize()
        this.performanceTracker.updateMatchmakingQueueSize(queueSize)
      }

      // 玩家取消匹配后广播服务器状态更新
      this.callbacks.broadcastServerStateUpdate?.()

      logger.info({ socketId: socket.id, playerId, sessionId }, '玩家取消匹配')
      ack?.({ status: 'SUCCESS', data: { status: 'CANCELED' } })
    } catch (error) {
      logger.error({ error, socketId: socket.id }, 'Error cancelling matchmaking')
      ack?.({ status: 'ERROR', code: 'CANCEL_ERROR', details: 'Failed to cancel matchmaking' })
    }
  }

  /**
   * 处理集群匹配加入事件
   */
  async handleClusterMatchmakingJoin(entry: MatchmakingEntry): Promise<void> {
    const startTime = Date.now()
    logger.info({ playerId: entry.playerId, sessionId: entry.sessionId }, 'Received cluster matchmaking join event')

    // 添加小延迟，避免同时加入的玩家产生锁竞争
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000))

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
   * 尝试集群匹配
   */
  async attemptClusterMatchmaking(): Promise<void> {
    // 使用全局匹配锁确保只有一个实例在同一时间进行匹配
    return await this.lockManager.withLock(
      LOCK_KEYS.MATCHMAKING,
      async () => {
        try {
          // 获取所有活跃的规则集
          const activeRuleSetIds = await this.stateManager.getActiveRuleSetIds()

          logger.info(
            {
              activeRuleSetIds,
              ruleSetCount: activeRuleSetIds.length,
            },
            'Attempting rule-based cluster matchmaking',
          )

          if (activeRuleSetIds.length === 0) {
            logger.info('No active rule sets found for matching')
            return
          }

          // 为每个规则集尝试匹配
          for (const ruleSetId of activeRuleSetIds) {
            const success = await this.attemptMatchmakingForRuleSet(ruleSetId)
            if (success) {
              // 如果成功匹配了一对玩家，就停止继续匹配
              // 这样可以避免一次处理太多匹配，保持系统响应性
              break
            }
          }
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
      { ttl: 60000, retryCount: 10, retryDelay: 500 }, // 更长的TTL，更多重试，更长延迟
    )
  }

  /**
   * 为特定规则集尝试匹配
   */
  private async attemptMatchmakingForRuleSet(ruleSetId: string): Promise<boolean> {
    try {
      const queue = await this.stateManager.getRuleBasedQueue(ruleSetId)

      logger.info(
        {
          ruleSetId,
          queueLength: queue.length,
          queue: queue.map(e => ({
            playerId: e.playerId,
            sessionId: e.sessionId,
            joinTime: e.joinTime,
            ruleSetId: e.ruleSetId,
          })),
        },
        'Attempting matchmaking for rule set',
      )

      if (queue.length < 2) {
        logger.debug({ ruleSetId }, 'Not enough players in rule set queue for matching')
        return false
      }

      logger.info({ ruleSetId, queueLength: queue.length }, 'Found sufficient players for matching, proceeding')

      // 获取规则集的匹配配置
      const matchingConfig = this.matchingConfigManager.getMatchingConfig(ruleSetId)
      const strategy = MatchingStrategyFactory.getStrategy(matchingConfig)

      logger.debug(
        {
          ruleSetId,
          strategy: strategy.name,
          config: matchingConfig,
        },
        'Using matching strategy for rule set',
      )

      // 使用匹配策略寻找最佳匹配
      const matchResult = await strategy.findMatch(queue, matchingConfig)

      if (!matchResult) {
        logger.debug(
          {
            ruleSetId,
            strategy: strategy.name,
            queueLength: queue.length,
          },
          'No suitable match found using matching strategy',
        )
        return false
      }

      const { player1, player2, quality } = matchResult

      logger.info(
        {
          ruleSetId,
          strategy: strategy.name,
          matchQuality: {
            score: quality.score,
            eloDifference: quality.eloDifference,
            waitTimeDifference: quality.waitTimeDifference,
            acceptable: quality.acceptable,
          },
          player1: {
            playerId: player1.playerId,
            sessionId: player1.sessionId,
            ruleSetId: player1.ruleSetId,
          },
          player2: {
            playerId: player2.playerId,
            sessionId: player2.sessionId,
            ruleSetId: player2.ruleSetId,
          },
        },
        'Found suitable match using matching strategy',
      )

      const player1Entry = player1
      const player2Entry = player2

      logger.info(
        {
          ruleSetId,
          player1: {
            playerId: player1Entry.playerId,
            sessionId: player1Entry.sessionId,
            ruleSetId: player1Entry.ruleSetId,
          },
          player2: {
            playerId: player2Entry.playerId,
            sessionId: player2Entry.sessionId,
            ruleSetId: player2Entry.ruleSetId,
          },
        },
        'Found suitable match pair for rule set, proceeding with match creation',
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
        // 再次检查session是否仍在基于规则的队列中
        const currentQueue = await this.stateManager.getRuleBasedQueue(ruleSetId)
        const p1Still = currentQueue.find(
          e => e.playerId === player1Entry!.playerId && e.sessionId === player1Entry!.sessionId,
        )
        const p2Still = currentQueue.find(
          e => e.playerId === player2Entry!.playerId && e.sessionId === player2Entry!.sessionId,
        )

        if (!p1Still || !p2Still) {
          logger.debug(
            {
              ruleSetId,
              player1Still: !!p1Still,
              player2Still: !!p2Still,
            },
            'One or both players no longer in rule-based queue, skipping match',
          )
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
                connection: p1Connection ? { status: p1Connection.status, instanceId: p1Connection.instanceId } : null,
              },
              player2: {
                playerId: player2Entry.playerId,
                sessionId: player2Entry.sessionId,
                connection: p2Connection ? { status: p2Connection.status, instanceId: p2Connection.instanceId } : null,
              },
            },
            'Player sessions not connected, skipping match',
          )

          // 立即清理没有连接的匹配队列条目
          const cleanupPromises: Promise<void>[] = []
          if (!p1Connection || p1Connection.status !== 'connected') {
            cleanupPromises.push(
              this.stateManager.removeFromMatchmakingQueue(player1Entry.playerId, player1Entry.sessionId),
            )
          }
          if (!p2Connection || p2Connection.status !== 'connected') {
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

        // 创建战斗房间 - 使用智能负载均衡选择最佳实例
        logger.info(
          {
            player1: { id: player1Entry.playerId, sessionId: player1Entry.sessionId },
            player2: { id: player2Entry.playerId, sessionId: player2Entry.sessionId },
          },
          'About to create cluster battle room with load balancing',
        )

        const roomId = await this.createBattleWithLoadBalancing(player1Entry, player2Entry)

        if (roomId) {
          logger.info(
            {
              roomId,
              player1: { id: player1Entry.playerId, sessionId: player1Entry.sessionId },
              player2: { id: player2Entry.playerId, sessionId: player2Entry.sessionId },
            },
            'Battle room created successfully, removing players from queue',
          )

          // 从队列中移除匹配的玩家
          await Promise.all([
            this.stateManager.removeFromMatchmakingQueue(player1Entry.playerId, player1Entry.sessionId),
            this.stateManager.removeFromMatchmakingQueue(player2Entry.playerId, player2Entry.sessionId),
          ])

          // 更新匹配队列大小统计
          if (this.performanceTracker) {
            const queueSize = await this.stateManager.getMatchmakingQueueSize()
            this.performanceTracker.updateMatchmakingQueueSize(queueSize)
          }

          // 匹配成功创建房间后广播服务器状态更新
          this.callbacks.broadcastServerStateUpdate?.()

          // 通知匹配成功
          await this.notifyMatchSuccess(player1Entry, player2Entry, roomId)
        } else {
          logger.error(
            {
              player1: { id: player1Entry.playerId, sessionId: player1Entry.sessionId },
              player2: { id: player2Entry.playerId, sessionId: player2Entry.sessionId },
            },
            'Failed to create battle room',
          )
        }
      })

      return true // 成功处理了一次匹配尝试
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
          ruleSetId,
        },
        'Error in rule set matchmaking',
      )
      return false // 匹配失败
    }
  }

  private validateRawPlayerData(rawData: unknown): ReturnType<typeof PlayerSchema.parse> {
    try {
      return PlayerSchema.parse(rawData)
    } catch (error) {
      if (error instanceof ZodError) {
        logger.warn({ error: error.issues, rawData }, 'Raw player data validation failed')
        throw new Error(`Invalid player data: ${error.issues.map((e: any) => e.message).join(', ')}`)
      }
      throw new Error('Failed to validate raw player data')
    }
  }

  private validatePlayerData(rawData: unknown): ReturnType<typeof PlayerParser.parse> {
    try {
      return PlayerParser.parse(rawData)
    } catch (error) {
      if (error instanceof ZodError) {
        logger.warn({ error: error.issues, rawData }, 'Player data validation failed')
        throw new Error(`Invalid player data: ${error.issues.map((e: any) => e.message).join(', ')}`)
      }
      throw new Error('Failed to validate player data')
    }
  }

  /**
   * 使用负载均衡创建战斗房间
   */
  private async createBattleWithLoadBalancing(
    player1Entry: MatchmakingEntry,
    player2Entry: MatchmakingEntry,
  ): Promise<string | null> {
    try {
      // 如果没有配置服务发现，回退到本地创建
      if (!this.serviceDiscovery) {
        logger.warn('Service discovery not configured, falling back to local battle creation')
        return await this.createClusterBattleRoom(player1Entry, player2Entry)
      }

      // 获取最佳实例来创建战斗
      const optimalInstance = await this.serviceDiscovery.getOptimalInstance()

      if (!optimalInstance) {
        logger.warn('No optimal instance found, falling back to local battle creation')
        return await this.createClusterBattleRoom(player1Entry, player2Entry)
      }

      // 如果最佳实例就是当前实例，直接在本地创建
      if (optimalInstance.id === this.instanceId) {
        logger.info(
          {
            instanceId: this.instanceId,
            performance: optimalInstance.performance,
          },
          'Current instance selected as optimal, creating battle locally',
        )

        // 记录本地战斗创建
        this.performanceTracker?.recordBattleCreationMethod('local')

        return await this.createClusterBattleRoom(player1Entry, player2Entry)
      }

      // 使用RPC在最佳实例上创建战斗
      logger.info(
        {
          optimalInstanceId: optimalInstance.id,
          currentInstanceId: this.instanceId,
          performance: optimalInstance.performance,
        },
        'Delegating battle creation to optimal instance via RPC',
      )

      return await this.createBattleOnRemoteInstance(optimalInstance, player1Entry, player2Entry)
    } catch (error) {
      logger.error(
        {
          error,
          player1Id: player1Entry.playerId,
          player2Id: player2Entry.playerId,
        },
        'Error in load-balanced battle creation, falling back to local creation',
      )

      // 出错时回退到本地创建
      return await this.createClusterBattleRoom(player1Entry, player2Entry)
    }
  }

  /**
   * 在远程实例上创建战斗
   */
  private async createBattleOnRemoteInstance(
    targetInstance: ServiceInstance,
    player1Entry: MatchmakingEntry,
    player2Entry: MatchmakingEntry,
  ): Promise<string | null> {
    try {
      // 获取目标实例的RPC客户端
      const rpcClient = await this.rpcClient.getClientByInstanceId(targetInstance.id)

      if (!rpcClient) {
        logger.warn(
          { targetInstanceId: targetInstance.id },
          'Failed to get RPC client for target instance, falling back to local creation',
        )
        return await this.createClusterBattleRoom(player1Entry, player2Entry)
      }

      // 通过RPC调用远程实例创建战斗
      const response = await new Promise<{ success: boolean; error?: string; roomId?: string }>((resolve, reject) => {
        ;(rpcClient as any).createBattle(
          {
            player1_entry: {
              player_id: player1Entry.playerId,
              session_id: player1Entry.sessionId || '',
              player_data: JSON.stringify(player1Entry.playerData),
              rule_set_id: player1Entry.ruleSetId || 'casual_standard_ruleset',
              join_time: player1Entry.joinTime,
            },
            player2_entry: {
              player_id: player2Entry.playerId,
              session_id: player2Entry.sessionId || '',
              player_data: JSON.stringify(player2Entry.playerData),
              rule_set_id: player2Entry.ruleSetId || 'casual_standard_ruleset',
              join_time: player2Entry.joinTime,
            },
          },
          (error: any, response: any) => {
            if (error) {
              reject(error)
            } else {
              resolve({
                success: response.success,
                error: response.error,
                roomId: response.room_id,
              })
            }
          },
        )
      })

      if (response.success && response.roomId) {
        logger.info(
          {
            roomId: response.roomId,
            targetInstanceId: targetInstance.id,
            player1Id: player1Entry.playerId,
            player2Id: player2Entry.playerId,
          },
          'Battle created successfully on remote instance',
        )

        // 记录远程RPC战斗创建
        this.performanceTracker?.recordBattleCreationMethod('remote_rpc')

        return response.roomId
      } else {
        logger.warn(
          {
            targetInstanceId: targetInstance.id,
            error: response.error,
          },
          'Remote battle creation failed, falling back to local creation',
        )

        // 记录回退到本地创建
        this.performanceTracker?.recordBattleCreationMethod('fallback')

        return await this.createClusterBattleRoom(player1Entry, player2Entry)
      }
    } catch (error) {
      logger.error(
        {
          error,
          targetInstanceId: targetInstance.id,
          player1Id: player1Entry.playerId,
          player2Id: player2Entry.playerId,
        },
        'Error creating battle on remote instance, falling back to local creation',
      )

      // 记录回退到本地创建
      this.performanceTracker?.recordBattleCreationMethod('fallback')

      return await this.createClusterBattleRoom(player1Entry, player2Entry)
    }
  }

  /**
   * 创建集群战斗房间
   */
  async createClusterBattleRoom(
    player1Entry: MatchmakingEntry,
    player2Entry: MatchmakingEntry,
  ): Promise<string | null> {
    // 委托给回调处理
    return await this.callbacks.createClusterBattleRoom(player1Entry, player2Entry)
  }

  /**
   * 通知匹配成功
   */
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

      // 获取玩家名称
      const player1Name = await this.callbacks.getPlayerName(player1Id)
      const player2Name = await this.callbacks.getPlayerName(player2Id)

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
      const result1 = await this.callbacks.sendToPlayerSession(player1Id, session1Id, 'matchSuccess', player1Message)
      const result2 = await this.callbacks.sendToPlayerSession(player2Id, session2Id, 'matchSuccess', player2Message)

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
            const isReachable = await this.callbacks.verifyInstanceReachability(instance)
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
        { ttl: 30000, retryCount: 3, retryDelay: 1000 },
      )
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
          instanceId: this.instanceId,
        },
        'Error in matchmaking leader election, assuming not leader',
      )
      return false
    }
  }

  /**
   * 清理孤立的匹配队列条目（没有对应连接的条目）
   */
  async cleanupOrphanedMatchmakingEntries(): Promise<void> {
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

  private handleValidationError(error: unknown, _socket: Socket, ack?: any) {
    const response: ErrorResponse = {
      status: 'ERROR',
      code: 'VALIDATION_ERROR',
      details: error instanceof Error ? error.message : 'Invalid data format',
    }
    ack?.(response)
  }

  // === 定时匹配功能 ===

  /**
   * 启动定时匹配
   */
  private startPeriodicMatching(): void {
    if (!this.periodicMatchingEnabled) {
      logger.info('Periodic matching is disabled')
      return
    }

    logger.info({ interval: this.periodicMatchingInterval }, 'Starting periodic matching timer')

    this.periodicMatchingTimer = setInterval(() => {
      this.performPeriodicMatching().catch(error => {
        logger.error({ error }, 'Error in periodic matching')
      })
    }, this.periodicMatchingInterval)
  }

  /**
   * 停止定时匹配
   */
  private stopPeriodicMatching(): void {
    if (this.periodicMatchingTimer) {
      clearInterval(this.periodicMatchingTimer)
      this.periodicMatchingTimer = null
      logger.info('Stopped periodic matching timer')
    }
  }

  /**
   * 执行定时匹配检查
   */
  private async performPeriodicMatching(): Promise<void> {
    try {
      // 只有匹配领导者才执行定时匹配
      const isLeader = await this.isMatchmakingLeader()
      if (!isLeader) {
        logger.debug('Not the matchmaking leader, skipping periodic matching')
        return
      }

      // 获取所有活跃的规则集
      const activeRuleSetIds = await this.stateManager.getActiveRuleSetIds()
      if (activeRuleSetIds.length === 0) {
        logger.debug('No active rule sets found for periodic matching')
        return
      }

      logger.debug({ activeRuleSetIds, ruleSetCount: activeRuleSetIds.length }, 'Performing periodic matching check')

      // 检查每个规则集是否需要定时匹配
      for (const ruleSetId of activeRuleSetIds) {
        await this.checkRuleSetForPeriodicMatching(ruleSetId)
      }
    } catch (error) {
      logger.error({ error }, 'Error in periodic matching execution')
    }
  }

  /**
   * 检查特定规则集是否需要定时匹配
   */
  private async checkRuleSetForPeriodicMatching(ruleSetId: string): Promise<void> {
    try {
      // 获取规则集队列
      const queue = await this.stateManager.getRuleBasedQueue(ruleSetId)

      if (queue.length < 2) {
        logger.debug({ ruleSetId, queueSize: queue.length }, 'Queue size insufficient for matching')
        return
      }

      // 获取匹配配置
      const matchingConfig = this.matchingConfigManager.getMatchingConfig(ruleSetId)

      // 检查是否需要定时匹配
      const needsMatching = this.shouldTriggerPeriodicMatching(queue, matchingConfig)

      if (!needsMatching) {
        logger.debug({ ruleSetId, strategy: matchingConfig.strategy }, 'Rule set does not need periodic matching')
        return
      }

      const oldestWaitTime = this.getOldestWaitTime(queue)
      logger.info(
        {
          ruleSetId,
          queueSize: queue.length,
          strategy: matchingConfig.strategy,
          oldestWaitTime,
        },
        'Triggering periodic matching for rule set',
      )

      // 触发匹配
      await this.attemptMatchmakingForRuleSet(ruleSetId)
    } catch (error) {
      logger.error({ error, ruleSetId }, 'Error checking rule set for periodic matching')
    }
  }

  /**
   * 判断是否应该触发定时匹配
   */
  private shouldTriggerPeriodicMatching(queue: any[], matchingConfig: any): boolean {
    // FIFO策略：有2个以上玩家就可以匹配
    if (matchingConfig.strategy === 'fifo') {
      return queue.length >= 2
    }

    // ELO策略：检查等待时间，支持时间扩展机制
    if (matchingConfig.strategy === 'elo') {
      const oldestWaitTime = this.getOldestWaitTime(queue)

      // 如果最老的玩家等待时间超过30秒，就触发定时匹配
      // 这样可以让ELO范围扩展机制生效
      return oldestWaitTime >= 30
    }

    return false
  }

  /**
   * 获取队列中最老玩家的等待时间 (秒)
   */
  private getOldestWaitTime(queue: any[]): number {
    if (queue.length === 0) return 0

    const now = Date.now()
    const oldestJoinTime = Math.min(...queue.map(entry => entry.joinTime))
    return Math.floor((now - oldestJoinTime) / 1000)
  }

  /**
   * 设置定时匹配配置
   */
  setPeriodicMatchingConfig(config: { enabled?: boolean; interval?: number }): void {
    const oldEnabled = this.periodicMatchingEnabled
    const oldInterval = this.periodicMatchingInterval

    if (config.enabled !== undefined) {
      this.periodicMatchingEnabled = config.enabled
    }
    if (config.interval !== undefined) {
      this.periodicMatchingInterval = config.interval
    }

    logger.info(
      {
        oldConfig: { enabled: oldEnabled, interval: oldInterval },
        newConfig: { enabled: this.periodicMatchingEnabled, interval: this.periodicMatchingInterval },
      },
      'Updated periodic matching configuration',
    )

    // 重启定时器如果配置改变
    if (oldEnabled !== this.periodicMatchingEnabled || oldInterval !== this.periodicMatchingInterval) {
      this.stopPeriodicMatching()
      if (this.periodicMatchingEnabled) {
        this.startPeriodicMatching()
      }
    }
  }

  /**
   * 获取定时匹配状态
   */
  getPeriodicMatchingStatus(): {
    enabled: boolean
    interval: number
    isRunning: boolean
  } {
    return {
      enabled: this.periodicMatchingEnabled,
      interval: this.periodicMatchingInterval,
      isRunning: this.periodicMatchingTimer !== null,
    }
  }
}
