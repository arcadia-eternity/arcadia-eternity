import type { TransactionManager, TransactionOperation } from './transactionManager'
import type { ClusterStateManager } from './clusterStateManager'
import type { MatchmakingEntry, RoomState, PlayerConnection } from './types'
import { REDIS_KEYS } from './types'
import { LOCK_KEYS } from './distributedLock'
import pino from 'pino'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

/**
 * 分布式事务模板类
 * 提供常用的业务操作的事务模板
 */
export class TransactionTemplates {
  constructor(
    private transactionManager: TransactionManager,
    private _stateManager: ClusterStateManager,
  ) {}

  /**
   * 匹配成功事务：将两个玩家从匹配队列移除并创建房间
   */
  async executeMatchmakingSuccess(
    player1Entry: MatchmakingEntry,
    player2Entry: MatchmakingEntry,
    roomState: RoomState,
  ): Promise<boolean> {
    try {
      // 构建session键
      const session1Key = `${player1Entry.playerId}:${player1Entry.sessionId}`
      const session2Key = `${player2Entry.playerId}:${player2Entry.sessionId}`

      const operations: TransactionOperation[] = [
        // 从匹配队列中移除session1
        {
          type: 'srem',
          key: REDIS_KEYS.MATCHMAKING_QUEUE,
          value: session1Key,
        },
        {
          type: 'del',
          key: REDIS_KEYS.MATCHMAKING_PLAYER(session1Key),
        },
        // 从匹配队列中移除session2
        {
          type: 'srem',
          key: REDIS_KEYS.MATCHMAKING_QUEUE,
          value: session2Key,
        },
        {
          type: 'del',
          key: REDIS_KEYS.MATCHMAKING_PLAYER(session2Key),
        },
        // 创建房间
        {
          type: 'sadd',
          key: REDIS_KEYS.ROOMS,
          value: roomState.id,
        },
        {
          type: 'hset',
          key: REDIS_KEYS.ROOM(roomState.id),
          value: this.serializeRoomState(roomState),
        },
      ]

      const lockKeys = [LOCK_KEYS.MATCHMAKING, LOCK_KEYS.ROOM_CREATE(roomState.id)]

      const result = await this.transactionManager.executeTransaction(operations, { lockKeys })

      if (result.success) {
        logger.info(
          {
            roomId: roomState.id,
            player1: player1Entry.playerId,
            player2: player2Entry.playerId,
          },
          'Matchmaking success transaction completed',
        )
      }

      return result.success
    } catch (error) {
      logger.error({ error }, 'Failed to execute matchmaking success transaction')
      return false
    }
  }

  /**
   * 玩家连接事务：设置玩家连接状态
   */
  async executePlayerConnect(playerId: string, connection: PlayerConnection, sessionId: string): Promise<boolean> {
    try {
      if (!sessionId) {
        throw new Error('SessionId is required for player connection')
      }

      const sessionConnection = {
        playerId,
        sessionId,
        instanceId: connection.instanceId,
        socketId: connection.socketId,
        lastSeen: connection.lastSeen,
        status: connection.status,
        metadata: connection.metadata,
      }

      const operations: TransactionOperation[] = [
        {
          type: 'hset',
          key: REDIS_KEYS.PLAYER_SESSION_CONNECTION(playerId, sessionId),
          value: this.serializeSessionConnection(sessionConnection),
        },
        {
          type: 'sadd',
          key: REDIS_KEYS.PLAYER_SESSION_CONNECTIONS(playerId),
          value: sessionId,
        },
      ]

      const lockKeys = [LOCK_KEYS.SESSION_ACTION(playerId, sessionId)]

      const result = await this.transactionManager.executeTransaction(operations, { lockKeys })

      if (result.success) {
        logger.debug({ playerId, sessionId }, 'Player session connect transaction completed')
      }

      return result.success
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Failed to execute player session connect transaction')
      return false
    }
  }

  /**
   * 玩家断开连接事务：清理玩家相关状态
   */
  async executePlayerDisconnect(playerId: string, sessionId?: string): Promise<boolean> {
    try {
      const operations: TransactionOperation[] = []

      // 如果有sessionId，移除特定session的连接和匹配队列条目
      if (sessionId) {
        const sessionKey = `${playerId}:${sessionId}`
        operations.push(
          // 移除session连接
          {
            type: 'del',
            key: REDIS_KEYS.PLAYER_SESSION_CONNECTION(playerId, sessionId),
          },
          {
            type: 'srem',
            key: REDIS_KEYS.PLAYER_SESSION_CONNECTIONS(playerId),
            value: sessionId,
          },
          // 移除匹配队列条目
          {
            type: 'srem',
            key: REDIS_KEYS.MATCHMAKING_QUEUE,
            value: sessionKey,
          },
          {
            type: 'del',
            key: REDIS_KEYS.MATCHMAKING_PLAYER(sessionKey),
          },
        )
      }

      const lockKeys = sessionId
        ? [LOCK_KEYS.SESSION_ACTION(playerId, sessionId), LOCK_KEYS.MATCHMAKING]
        : [LOCK_KEYS.PLAYER_ACTION(playerId), LOCK_KEYS.MATCHMAKING]

      const result = await this.transactionManager.executeTransaction(operations, { lockKeys })

      if (result.success) {
        logger.debug({ playerId, sessionId }, 'Player session disconnect transaction completed')
      }

      return result.success
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Failed to execute player session disconnect transaction')
      return false
    }
  }

  /**
   * 房间销毁事务：清理房间相关状态
   */
  async executeRoomDestroy(roomId: string): Promise<boolean> {
    try {
      const operations: TransactionOperation[] = [
        {
          type: 'srem',
          key: REDIS_KEYS.ROOMS,
          value: roomId,
        },
        {
          type: 'del',
          key: REDIS_KEYS.ROOM(roomId),
        },
      ]

      const lockKeys = [LOCK_KEYS.ROOM_CREATE(roomId)]

      const result = await this.transactionManager.executeTransaction(operations, { lockKeys })

      if (result.success) {
        logger.debug({ roomId }, 'Room destroy transaction completed')
      }

      return result.success
    } catch (error) {
      logger.error({ error, roomId }, 'Failed to execute room destroy transaction')
      return false
    }
  }

  /**
   * 玩家加入房间事务
   */
  async executePlayerJoinRoom(playerId: string, roomId: string, updatedRoomState: RoomState): Promise<boolean> {
    try {
      const operations: TransactionOperation[] = [
        {
          type: 'hset',
          key: REDIS_KEYS.ROOM(roomId),
          value: this.serializeRoomState(updatedRoomState),
        },
      ]

      const lockKeys = [LOCK_KEYS.PLAYER_ACTION(playerId), LOCK_KEYS.ROOM_CREATE(roomId)]

      const result = await this.transactionManager.executeTransaction(operations, { lockKeys })

      if (result.success) {
        logger.debug({ playerId, roomId }, 'Player join room transaction completed')
      }

      return result.success
    } catch (error) {
      logger.error({ error, playerId, roomId }, 'Failed to execute player join room transaction')
      return false
    }
  }

  /**
   * 玩家离开房间事务
   */
  async executePlayerLeaveRoom(playerId: string, roomId: string, updatedRoomState?: RoomState): Promise<boolean> {
    try {
      const operations: TransactionOperation[] = []

      if (updatedRoomState) {
        // 更新房间状态
        operations.push({
          type: 'hset',
          key: REDIS_KEYS.ROOM(roomId),
          value: this.serializeRoomState(updatedRoomState),
        })
      } else {
        // 房间为空，删除房间
        operations.push(
          {
            type: 'srem',
            key: REDIS_KEYS.ROOMS,
            value: roomId,
          },
          {
            type: 'del',
            key: REDIS_KEYS.ROOM(roomId),
          },
        )
      }

      const lockKeys = [LOCK_KEYS.PLAYER_ACTION(playerId), LOCK_KEYS.ROOM_CREATE(roomId)]

      const result = await this.transactionManager.executeTransaction(operations, { lockKeys })

      if (result.success) {
        logger.debug({ playerId, roomId, roomDestroyed: !updatedRoomState }, 'Player leave room transaction completed')
      }

      return result.success
    } catch (error) {
      logger.error({ error, playerId, roomId }, 'Failed to execute player leave room transaction')
      return false
    }
  }

  /**
   * 批量清理过期数据事务
   */
  async executeCleanupExpiredData(expiredKeys: string[]): Promise<boolean> {
    try {
      if (expiredKeys.length === 0) {
        return true
      }

      const operations: TransactionOperation[] = expiredKeys.map(key => ({
        type: 'del',
        key,
      }))

      const result = await this.transactionManager.executeTransaction(operations, {
        timeout: 60000, // 1分钟超时
      })

      if (result.success) {
        logger.info({ cleanedKeys: expiredKeys.length }, 'Cleanup expired data transaction completed')
      }

      return result.success
    } catch (error) {
      logger.error({ error, keyCount: expiredKeys.length }, 'Failed to execute cleanup transaction')
      return false
    }
  }

  /**
   * 实例注册事务
   */
  async executeInstanceRegistration(instanceId: string, instanceData: any): Promise<boolean> {
    try {
      const operations: TransactionOperation[] = [
        {
          type: 'sadd',
          key: REDIS_KEYS.SERVICE_INSTANCES,
          value: instanceId,
        },
        {
          type: 'hset',
          key: REDIS_KEYS.SERVICE_INSTANCE(instanceId),
          value: instanceData,
        },
      ]

      const lockKeys = [LOCK_KEYS.SERVICE_REGISTRY]

      const result = await this.transactionManager.executeTransaction(operations, { lockKeys })

      if (result.success) {
        logger.debug({ instanceId }, 'Instance registration transaction completed')
      }

      return result.success
    } catch (error) {
      logger.error({ error, instanceId }, 'Failed to execute instance registration transaction')
      return false
    }
  }

  /**
   * 实例注销事务
   */
  async executeInstanceUnregistration(instanceId: string): Promise<boolean> {
    try {
      const operations: TransactionOperation[] = [
        {
          type: 'srem',
          key: REDIS_KEYS.SERVICE_INSTANCES,
          value: instanceId,
        },
        {
          type: 'del',
          key: REDIS_KEYS.SERVICE_INSTANCE(instanceId),
        },
      ]

      const lockKeys = [LOCK_KEYS.SERVICE_REGISTRY]

      const result = await this.transactionManager.executeTransaction(operations, { lockKeys })

      if (result.success) {
        logger.debug({ instanceId }, 'Instance unregistration transaction completed')
      }

      return result.success
    } catch (error) {
      logger.error({ error, instanceId }, 'Failed to execute instance unregistration transaction')
      return false
    }
  }

  // 序列化辅助方法
  private serializeRoomState(room: RoomState): Record<string, string> {
    return {
      id: room.id,
      status: room.status,
      sessions: JSON.stringify(room.sessions),
      sessionPlayers: JSON.stringify(room.sessionPlayers || {}),
      instanceId: room.instanceId,
      lastActive: room.lastActive.toString(),
      battleState: JSON.stringify(room.battleState || null),
      metadata: JSON.stringify(room.metadata || {}),
    }
  }

  private serializeSessionConnection(connection: any): Record<string, string> {
    return {
      playerId: connection.playerId,
      sessionId: connection.sessionId,
      instanceId: connection.instanceId,
      socketId: connection.socketId,
      lastSeen: connection.lastSeen.toString(),
      status: connection.status,
      metadata: JSON.stringify(connection.metadata || {}),
    }
  }
}

/**
 * 事务重试装饰器
 */
export function withRetry<T extends any[], R>(retryCount: number = 3, retryDelay: number = 1000) {
  return function (_target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value

    descriptor.value = async function (...args: T): Promise<R> {
      let lastError: Error | null = null

      for (let attempt = 1; attempt <= retryCount; attempt++) {
        try {
          return await originalMethod.apply(this, args)
        } catch (error) {
          lastError = error as Error
          logger.warn(
            {
              method: propertyKey,
              attempt,
              maxAttempts: retryCount,
              error: error instanceof Error ? error.message : error,
            },
            'Transaction attempt failed, retrying...',
          )

          if (attempt < retryCount) {
            await new Promise(resolve => setTimeout(resolve, retryDelay * attempt))
          }
        }
      }

      logger.error(
        {
          method: propertyKey,
          attempts: retryCount,
          error: lastError?.message,
        },
        'All transaction attempts failed',
      )
      throw lastError
    }

    return descriptor
  }
}
