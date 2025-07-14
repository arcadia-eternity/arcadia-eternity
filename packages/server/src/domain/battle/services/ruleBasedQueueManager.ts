import pino from 'pino'
import type { RedisClientManager } from '../../../cluster/redis/redisClient'
import type { MatchmakingEntry } from '../../../cluster/types'
import { REDIS_KEYS } from '../../../cluster/types'
import { TTLHelper } from '../../../cluster/config/ttlConfig'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

/**
 * 基于规则的队列管理器
 * 为不同的游戏模式和规则集维护独立的匹配队列
 */
export class RuleBasedQueueManager {
  constructor(private redisManager: RedisClientManager) {}

  /**
   * 获取队列键名
   * @param ruleSetId 规则集ID
   * @returns 队列键名
   */
  private getQueueKey(ruleSetId: string = 'standard'): string {
    return `${REDIS_KEYS.MATCHMAKING_QUEUE}:${ruleSetId}`
  }

  /**
   * 获取玩家数据键名
   * @param sessionKey 会话键
   * @param ruleSetId 规则集ID
   * @returns 玩家数据键名
   */
  private getPlayerKey(sessionKey: string, ruleSetId: string = 'standard'): string {
    return `${REDIS_KEYS.MATCHMAKING_PLAYER(sessionKey)}:${ruleSetId}`
  }

  /**
   * 添加玩家到特定规则的队列
   * @param entry 匹配条目
   */
  async addToRuleBasedQueue(entry: MatchmakingEntry): Promise<void> {
    const client = this.redisManager.getClient()

    try {
      if (!entry.sessionId) {
        throw new Error('SessionId is required for rule-based matchmaking')
      }

      const ruleSetId = entry.ruleSetId || 'standard'

      // 获取TTL配置
      const queueEntryTTL = TTLHelper.getTTLForDataType('matchmaking')
      const queueIndexTTL = TTLHelper.getTTLForDataType('matchmaking', 'index')

      const sessionKey = `${entry.playerId}:${entry.sessionId}`
      const queueKey = this.getQueueKey(ruleSetId)
      const playerKey = this.getPlayerKey(sessionKey, ruleSetId)

      // 使用pipeline批量执行操作
      const pipeline = client.pipeline()

      // 添加到特定规则的队列
      pipeline.sadd(queueKey, sessionKey)
      if (queueIndexTTL > 0) {
        pipeline.pexpire(queueKey, queueIndexTTL)
      }

      // 将规则集添加到活跃规则集索引
      const activeRuleSetsKey = `${REDIS_KEYS.MATCHMAKING_QUEUE}:active_rulesets`
      pipeline.sadd(activeRuleSetsKey, ruleSetId)
      if (queueIndexTTL > 0) {
        pipeline.pexpire(activeRuleSetsKey, queueIndexTTL)
      }

      // 存储玩家数据
      pipeline.hset(playerKey, this.serializeMatchmakingEntry(entry))
      if (queueEntryTTL > 0) {
        pipeline.pexpire(playerKey, queueEntryTTL)
      }

      // 存储队列映射信息（用于快速查找玩家所在的队列）
      const queueMappingKey = `${REDIS_KEYS.MATCHMAKING_PLAYER(sessionKey)}:queue_mapping`
      pipeline.hset(queueMappingKey, {
        ruleSetId,
        queueKey,
      })
      if (queueEntryTTL > 0) {
        pipeline.pexpire(queueMappingKey, queueEntryTTL)
      }

      await pipeline.exec()

      // 验证队列是否创建成功
      const queueSize = await client.scard(queueKey)
      logger.info(
        {
          playerId: entry.playerId,
          sessionId: entry.sessionId,
          ruleSetId,
          queueKey,
          queueSize,
        },
        'Player added to rule-based queue',
      )
    } catch (error) {
      logger.error(
        {
          error,
          playerId: entry.playerId,
          sessionId: entry.sessionId,
          ruleSetId: entry.ruleSetId,
        },
        'Failed to add player to rule-based queue',
      )
      throw error
    }
  }

  /**
   * 从规则队列中移除玩家
   * @param playerId 玩家ID
   * @param sessionId 会话ID
   */
  async removeFromRuleBasedQueue(playerId: string, sessionId?: string): Promise<void> {
    const client = this.redisManager.getClient()

    try {
      if (sessionId) {
        // 移除特定session
        const sessionKey = `${playerId}:${sessionId}`

        // 获取队列映射信息
        const queueMappingKey = `${REDIS_KEYS.MATCHMAKING_PLAYER(sessionKey)}:queue_mapping`
        const queueMapping = await client.hgetall(queueMappingKey)

        if (queueMapping && queueMapping.queueKey) {
          const ruleSetId = queueMapping.ruleSetId || 'standard'
          const queueKey = queueMapping.queueKey
          const playerKey = this.getPlayerKey(sessionKey, ruleSetId)

          // 从特定队列中移除
          await client.srem(queueKey, sessionKey)
          await client.del(playerKey)
          await client.del(queueMappingKey)

          // 检查队列是否为空，如果为空则从活跃索引中移除
          const remainingQueueSize = await client.scard(queueKey)
          if (remainingQueueSize === 0) {
            const activeRuleSetsKey = `${REDIS_KEYS.MATCHMAKING_QUEUE}:active_rulesets`
            await client.srem(activeRuleSetsKey, ruleSetId)
            logger.debug({ ruleSetId }, 'Removed empty rule set from active index')
          }

          logger.debug(
            { playerId, sessionId, ruleSetId, queueKey, remainingQueueSize },
            'Session removed from rule-based queue',
          )
        }
      } else {
        // 移除该playerId的所有session（向后兼容）
        const allSessionKeys = await client.smembers(REDIS_KEYS.MATCHMAKING_QUEUE)
        const playerSessionKeys = allSessionKeys.filter(key => key.startsWith(`${playerId}:`))

        for (const sessionKey of playerSessionKeys) {
          // 获取并清理每个session的队列映射
          const queueMappingKey = `${REDIS_KEYS.MATCHMAKING_PLAYER(sessionKey)}:queue_mapping`
          const queueMapping = await client.hgetall(queueMappingKey)

          if (queueMapping && queueMapping.queueKey) {
            const ruleSetId = queueMapping.ruleSetId || 'standard'
            const queueKey = queueMapping.queueKey
            const playerKey = this.getPlayerKey(sessionKey, ruleSetId)

            await client.srem(queueKey, sessionKey)
            await client.del(playerKey)
            await client.del(queueMappingKey)
          }
        }

        logger.debug(
          { playerId, removedSessions: playerSessionKeys.length },
          'All player sessions removed from rule-based queues',
        )
      }
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Failed to remove from rule-based queue')
      throw error
    }
  }

  /**
   * 获取所有活跃的规则集ID
   * @returns 活跃的规则集ID列表
   */
  async getActiveRuleSetIds(): Promise<string[]> {
    const client = this.redisManager.getClient()

    try {
      // 从活跃规则集索引获取所有规则集
      const activeRuleSetsKey = `${REDIS_KEYS.MATCHMAKING_QUEUE}:active_rulesets`
      const indexedRuleSetIds = await client.smembers(activeRuleSetsKey)

      logger.debug(
        {
          activeRuleSetsKey,
          indexedRuleSetIds,
          indexedCount: indexedRuleSetIds.length,
        },
        'Retrieved rule sets from active index',
      )

      // 检查每个索引中的规则集的队列是否真的有玩家
      const activeRuleSetIds: string[] = []
      for (const ruleSetId of indexedRuleSetIds) {
        const queueKey = this.getQueueKey(ruleSetId)
        const queueSize = await client.scard(queueKey)

        logger.debug(
          {
            ruleSetId,
            queueKey,
            queueSize,
          },
          'Checking queue size for indexed rule set',
        )

        if (queueSize > 0) {
          activeRuleSetIds.push(ruleSetId)
        } else {
          // 如果队列为空，从索引中移除这个规则集
          await client.srem(activeRuleSetsKey, ruleSetId)
          logger.debug({ ruleSetId }, 'Removed empty rule set from active index')
        }
      }

      logger.info(
        {
          indexedRuleSets: indexedRuleSetIds.length,
          activeRuleSets: activeRuleSetIds.length,
          activeRuleSetIds,
        },
        'Active rule sets found (using active index)',
      )

      return activeRuleSetIds
    } catch (error) {
      logger.error({ error }, 'Failed to get active rule set IDs')
      return []
    }
  }

  /**
   * 获取特定规则的队列
   * @param ruleSetId 规则集ID
   * @returns 匹配条目列表
   */
  async getRuleBasedQueue(ruleSetId: string = 'standard'): Promise<MatchmakingEntry[]> {
    const client = this.redisManager.getClient()

    try {
      const queueKey = this.getQueueKey(ruleSetId)
      const sessionKeys = await client.smembers(queueKey)

      if (sessionKeys.length === 0) {
        return []
      }

      // 批量获取玩家数据
      const pipeline = client.pipeline()
      for (const sessionKey of sessionKeys) {
        const playerKey = this.getPlayerKey(sessionKey, ruleSetId)
        pipeline.hgetall(playerKey)
      }

      const results = await pipeline.exec()
      const entries: MatchmakingEntry[] = []

      if (results) {
        for (let i = 0; i < results.length; i++) {
          const [err, entryData] = results[i]
          if (!err && entryData && Object.keys(entryData).length > 0) {
            entries.push(this.deserializeMatchmakingEntry(entryData as Record<string, string>))
          }
        }
      }

      return entries.sort((a, b) => a.joinTime - b.joinTime)
    } catch (error) {
      logger.error({ error, ruleSetId }, 'Failed to get rule-based queue')
      return []
    }
  }

  /**
   * 获取所有活跃的队列信息
   * @returns 队列信息列表
   */
  async getAllActiveQueues(): Promise<
    Array<{
      ruleSetId: string
      queueKey: string
      playerCount: number
    }>
  > {
    const client = this.redisManager.getClient()

    try {
      // 获取所有匹配队列相关的键
      const queueKeys = await client.keys(`${REDIS_KEYS.MATCHMAKING_QUEUE}:*`)
      const queues: Array<{
        ruleSetId: string
        queueKey: string
        playerCount: number
      }> = []

      for (const queueKey of queueKeys) {
        const playerCount = await client.scard(queueKey)
        if (playerCount > 0) {
          // 解析队列键获取规则集
          const ruleSetId = queueKey.replace(`${REDIS_KEYS.MATCHMAKING_QUEUE}:`, '')

          queues.push({
            ruleSetId,
            queueKey,
            playerCount,
          })
        }
      }

      return queues
    } catch (error) {
      logger.error({ error }, 'Failed to get all active queues')
      return []
    }
  }

  /**
   * 序列化匹配条目
   */
  serializeMatchmakingEntry(entry: MatchmakingEntry): Record<string, string> {
    return {
      playerId: entry.playerId,
      sessionId: entry.sessionId || '',
      joinTime: entry.joinTime.toString(),
      playerData: JSON.stringify(entry.playerData),
      preferences: JSON.stringify(entry.preferences || {}),
      ruleSetId: entry.ruleSetId || 'standard',
      metadata: JSON.stringify(entry.metadata || {}),
    }
  }

  /**
   * 反序列化匹配条目
   */
  deserializeMatchmakingEntry(data: Record<string, string>): MatchmakingEntry {
    return {
      playerId: data.playerId,
      sessionId: data.sessionId || undefined,
      joinTime: parseInt(data.joinTime),
      playerData: JSON.parse(data.playerData),
      preferences: data.preferences ? JSON.parse(data.preferences) : undefined,
      ruleSetId: data.ruleSetId || 'standard',
      metadata: data.metadata ? JSON.parse(data.metadata) : undefined,
    }
  }
}
