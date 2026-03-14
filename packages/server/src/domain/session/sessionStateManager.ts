import pino from 'pino'
import { injectable, inject } from 'inversify'
import type { ClusterStateManager } from '../../cluster/core/clusterStateManager'
import { REDIS_KEYS } from '../../cluster/types'
import { TYPES } from '../../types'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

/**
 * Session 状态类型
 */
export type SessionState = 'idle' | 'matchmaking' | 'private_room' | 'battle'

/**
 * Session 状态信息
 */
export interface SessionStateInfo {
  playerId: string
  sessionId: string
  state: SessionState
  context?: {
    roomCode?: string
    queueId?: string
    battleRoomId?: string
  }
  updatedAt: number
}

/**
 * Session 状态管理器
 * 确保一个 session 不能同时在匹配队列和私人房间中
 */
@injectable()
export class SessionStateManager {
  private readonly SESSION_STATE_TTL = 24 * 60 * 60 * 1000 // 24小时

  constructor(@inject(TYPES.ClusterStateManager) private stateManager: ClusterStateManager) {}

  /**
   * 获取 session 当前状态
   */
  async getSessionState(playerId: string, sessionId: string): Promise<SessionStateInfo | null> {
    try {
      const client = this.stateManager.redisManager.getClient()
      const key = this.getSessionStateKey(playerId, sessionId)
      const data = await client.get(key)

      if (!data) {
        return null
      }

      return JSON.parse(data) as SessionStateInfo
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Failed to get session state')
      return null
    }
  }

  /**
   * 设置 session 状态
   */
  async setSessionState(
    playerId: string,
    sessionId: string,
    state: SessionState,
    context?: SessionStateInfo['context'],
  ): Promise<void> {
    try {
      const client = this.stateManager.redisManager.getClient()
      const key = this.getSessionStateKey(playerId, sessionId)

      const stateInfo: SessionStateInfo = {
        playerId,
        sessionId,
        state,
        context,
        updatedAt: Date.now(),
      }

      await client.setex(key, Math.floor(this.SESSION_STATE_TTL / 1000), JSON.stringify(stateInfo))

      logger.debug({ playerId, sessionId, state, context }, 'Session state updated')
    } catch (error) {
      logger.error({ error, playerId, sessionId, state }, 'Failed to set session state')
      throw error
    }
  }

  /**
   * 清除 session 状态
   */
  async clearSessionState(playerId: string, sessionId: string): Promise<void> {
    try {
      const client = this.stateManager.redisManager.getClient()
      const key = this.getSessionStateKey(playerId, sessionId)
      await client.del(key)

      logger.debug({ playerId, sessionId }, 'Session state cleared')
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Failed to clear session state')
    }
  }

  /**
   * 检查 session 是否可以进入匹配队列
   */
  async canEnterMatchmaking(playerId: string, sessionId: string): Promise<{ allowed: boolean; reason?: string }> {
    const currentState = await this.getSessionState(playerId, sessionId)

    if (!currentState || currentState.state === 'idle') {
      return { allowed: true }
    }

    switch (currentState.state) {
      case 'matchmaking': {
        const inQueue = await this.ensureMatchmakingStateConsistency(playerId, sessionId, currentState)
        if (!inQueue) {
          return { allowed: true }
        }
        return { allowed: false, reason: '已在匹配队列中' }
      }
      case 'private_room':
        return { allowed: false, reason: '当前在私人房间中，请先离开房间' }
      case 'battle': {
        const hasActiveBattle = await this.ensureBattleStateConsistency(playerId, sessionId, currentState)
        if (!hasActiveBattle) {
          return { allowed: true }
        }
        return { allowed: false, reason: '当前在战斗中' }
      }
      default:
        return { allowed: true }
    }
  }

  private async ensureMatchmakingStateConsistency(
    playerId: string,
    sessionId: string,
    currentState: SessionStateInfo,
  ): Promise<boolean> {
    let inQueue = false
    try {
      inQueue = await this.isSessionInMatchmakingQueue(playerId, sessionId)
    } catch (error) {
      logger.error(
        { error, playerId, sessionId },
        'Failed to verify matchmaking state consistency, keep matchmaking lock as fallback',
      )
      return true
    }

    if (inQueue) {
      return true
    }

    await this.setSessionState(playerId, sessionId, 'idle')
    logger.warn(
      { playerId, sessionId, previousState: currentState.state },
      'Detected stale matchmaking session state, auto-healed to idle',
    )
    return false
  }

  private async isSessionInMatchmakingQueue(playerId: string, sessionId: string): Promise<boolean> {
    const client = this.stateManager.redisManager.getClient()
    const sessionKey = `${playerId}:${sessionId}`
    const queueMappingKey = `${REDIS_KEYS.MATCHMAKING_PLAYER(sessionKey)}:queue_mapping`
    const queueMapping = await client.hgetall(queueMappingKey)

    const hasQueueMapping = queueMapping && typeof queueMapping === 'object' && Object.keys(queueMapping).length > 0
    if (hasQueueMapping && queueMapping.queueKey) {
      const inMappedQueue = await this.isSessionMemberOfQueue(client, queueMapping.queueKey, sessionKey)
      if (inMappedQueue) {
        return true
      }

      const mappedRuleSetId = queueMapping.ruleSetId || 'standard'
      const playerEntryKey = `${REDIS_KEYS.MATCHMAKING_PLAYER(sessionKey)}:${mappedRuleSetId}`
      await Promise.all([
        client.srem(queueMapping.queueKey, sessionKey),
        client.del(playerEntryKey),
        client.del(queueMappingKey),
      ])
      return false
    }

    const activeRuleSetsKey = `${REDIS_KEYS.MATCHMAKING_QUEUE}:active_rulesets`
    const activeRuleSetIds = await client.smembers(activeRuleSetsKey)
    for (const ruleSetId of activeRuleSetIds) {
      const queueKey = `${REDIS_KEYS.MATCHMAKING_QUEUE}:${ruleSetId}`
      const exists = await this.isSessionMemberOfQueue(client, queueKey, sessionKey)
      if (!exists) {
        continue
      }

      await client.hset(queueMappingKey, {
        ruleSetId,
        queueKey,
      })
      return true
    }

    return false
  }

  private async isSessionMemberOfQueue(
    client: {
      sismember?: (key: string, member: string) => Promise<number>
      smembers: (key: string) => Promise<string[]>
    },
    queueKey: string,
    sessionKey: string,
  ): Promise<boolean> {
    if (typeof client.sismember === 'function') {
      const result = await client.sismember(queueKey, sessionKey)
      return result === 1
    }

    const members = await client.smembers(queueKey)
    return members.includes(sessionKey)
  }

  /**
   * 检查 session 是否可以进入私人房间
   */
  async canEnterPrivateRoom(playerId: string, sessionId: string): Promise<{ allowed: boolean; reason?: string }> {
    const currentState = await this.getSessionState(playerId, sessionId)

    if (!currentState || currentState.state === 'idle') {
      return { allowed: true }
    }

    switch (currentState.state) {
      case 'matchmaking':
        return { allowed: false, reason: '当前在匹配队列中，请先取消匹配' }
      case 'private_room':
        return { allowed: false, reason: '已在私人房间中' }
      case 'battle': {
        const hasActiveBattle = await this.ensureBattleStateConsistency(playerId, sessionId, currentState)
        if (!hasActiveBattle) {
          return { allowed: true }
        }
        return { allowed: false, reason: '当前在战斗中' }
      }
      default:
        return { allowed: true }
    }
  }

  private async ensureBattleStateConsistency(
    playerId: string,
    sessionId: string,
    currentState: SessionStateInfo,
  ): Promise<boolean> {
    let inActiveBattle = false
    try {
      inActiveBattle = await this.isSessionInActiveBattle(playerId, sessionId, currentState.context?.battleRoomId)
    } catch (error) {
      logger.error(
        { error, playerId, sessionId, battleRoomId: currentState.context?.battleRoomId },
        'Failed to verify battle state consistency, keep battle lock as fallback',
      )
      return true
    }
    if (inActiveBattle) {
      return true
    }

    await this.setSessionState(playerId, sessionId, 'idle')
    logger.warn(
      { playerId, sessionId, previousState: currentState.state, battleRoomId: currentState.context?.battleRoomId },
      'Detected stale battle session state, auto-healed to idle',
    )
    return false
  }

  private async isSessionInActiveBattle(
    playerId: string,
    sessionId: string,
    hintedRoomId?: string,
  ): Promise<boolean> {
    const client = this.stateManager.redisManager.getClient()
    const sessionRoomKey = REDIS_KEYS.SESSION_ROOM_MAPPING(playerId, sessionId)
    const mappedRoomIds = await client.smembers(sessionRoomKey)
    const roomIds = new Set(mappedRoomIds)
    if (hintedRoomId) {
      roomIds.add(hintedRoomId)
    }

    if (roomIds.size === 0) {
      return false
    }

    const staleRoomIds: string[] = []
    for (const roomId of roomIds) {
      const roomState = await this.stateManager.getRoomState(roomId)
      if (!roomState) {
        staleRoomIds.push(roomId)
        continue
      }

      const isBattlePlayer =
        roomState.status === 'active' &&
        roomState.sessions.includes(sessionId) &&
        roomState.sessionPlayers[sessionId] === playerId &&
        !roomState.spectators.some(s => s.playerId === playerId && s.sessionId === sessionId)

      if (isBattlePlayer) {
        const leaseActive = await this.hasActiveOwnershipLease(client, roomId)
        if (!leaseActive) {
          const ownerInstance = await this.stateManager.getInstance(roomState.instanceId)
          const ownerHealthy = ownerInstance?.status === 'healthy'
          if (!ownerHealthy) {
            staleRoomIds.push(roomId)
            continue
          }
        }

        if (staleRoomIds.length > 0) {
          await Promise.all(staleRoomIds.map(staleRoomId => client.srem(sessionRoomKey, staleRoomId)))
        }
        return true
      }

      staleRoomIds.push(roomId)
    }

    if (staleRoomIds.length > 0) {
      await Promise.all(staleRoomIds.map(roomId => client.srem(sessionRoomKey, roomId)))
    }

    return false
  }

  private async hasActiveOwnershipLease(client: { get(key: string): Promise<string | null> }, roomId: string): Promise<boolean> {
    const ownershipRaw = await client.get(REDIS_KEYS.BATTLE_RUNTIME_OWNERSHIP(roomId))
    if (!ownershipRaw) {
      return false
    }

    try {
      const ownership = JSON.parse(ownershipRaw) as {
        leaseExpireAt?: number
        status?: 'idle' | 'active' | 'draining' | 'released'
      }
      const leaseActive =
        typeof ownership.leaseExpireAt === 'number' &&
        ownership.leaseExpireAt > Date.now() &&
        (ownership.status === 'active' || ownership.status === 'draining')
      return leaseActive
    } catch (error) {
      logger.warn({ error, roomId }, 'Failed to parse ownership record while checking session battle consistency')
      return false
    }
  }

  /**
   * 检查 session 是否可以开始战斗
   */
  async canEnterBattle(playerId: string, sessionId: string): Promise<{ allowed: boolean; reason?: string }> {
    const currentState = await this.getSessionState(playerId, sessionId)

    if (!currentState) {
      return { allowed: false, reason: 'Session 状态未知' }
    }

    if (currentState.state === 'matchmaking' || currentState.state === 'private_room') {
      return { allowed: true }
    }

    return { allowed: false, reason: `当前状态 ${currentState.state} 不允许开始战斗` }
  }

  /**
   * 获取玩家所有 session 的状态
   */
  async getPlayerAllSessionStates(playerId: string): Promise<SessionStateInfo[]> {
    try {
      const client = this.stateManager.redisManager.getClient()
      const pattern = `session_state:${playerId}:*`
      const keys = await client.keys(pattern)

      if (keys.length === 0) {
        return []
      }

      const states: SessionStateInfo[] = []
      for (const key of keys) {
        const data = await client.get(key)
        if (data) {
          states.push(JSON.parse(data))
        }
      }

      return states
    } catch (error) {
      logger.error({ error, playerId }, 'Failed to get player session states')
      return []
    }
  }

  /**
   * 清理玩家所有 session 状态
   */
  async clearPlayerAllSessionStates(playerId: string): Promise<void> {
    try {
      const client = this.stateManager.redisManager.getClient()
      const pattern = `session_state:${playerId}:*`
      const keys = await client.keys(pattern)

      if (keys.length > 0) {
        await client.del(...keys)
        logger.debug({ playerId, clearedCount: keys.length }, 'Cleared all player session states')
      }
    } catch (error) {
      logger.error({ error, playerId }, 'Failed to clear player session states')
    }
  }

  /**
   * 生成 session 状态的 Redis 键
   */
  private getSessionStateKey(playerId: string, sessionId: string): string {
    return `session_state:${playerId}:${sessionId}`
  }

  /**
   * 批量更新 session 状态（用于战斗开始时）
   */
  async batchUpdateSessionStates(
    sessions: Array<{ playerId: string; sessionId: string }>,
    state: SessionState,
    context?: SessionStateInfo['context'],
  ): Promise<void> {
    try {
      const client = this.stateManager.redisManager.getClient()
      const pipeline = client.pipeline()

      for (const { playerId, sessionId } of sessions) {
        const key = this.getSessionStateKey(playerId, sessionId)
        const stateInfo: SessionStateInfo = {
          playerId,
          sessionId,
          state,
          context,
          updatedAt: Date.now(),
        }

        pipeline.setex(key, Math.floor(this.SESSION_STATE_TTL / 1000), JSON.stringify(stateInfo))
      }

      await pipeline.exec()

      logger.debug({ sessionCount: sessions.length, state, context }, 'Batch updated session states')
    } catch (error) {
      logger.error({ error, sessionCount: sessions.length, state }, 'Failed to batch update session states')
      throw error
    }
  }
}
