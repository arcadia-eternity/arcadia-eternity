import pino from 'pino'
import { injectable, inject } from 'inversify'
import type { ClusterStateManager } from '../../cluster/core/clusterStateManager'
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
      case 'matchmaking':
        return { allowed: false, reason: '已在匹配队列中' }
      case 'private_room':
        return { allowed: false, reason: '当前在私人房间中，请先离开房间' }
      case 'battle':
        return { allowed: false, reason: '当前在战斗中' }
      default:
        return { allowed: true }
    }
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
      case 'battle':
        return { allowed: false, reason: '当前在战斗中' }
      default:
        return { allowed: true }
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
