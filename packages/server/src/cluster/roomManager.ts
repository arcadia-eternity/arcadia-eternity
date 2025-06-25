import { nanoid } from 'nanoid'
import pino from 'pino'
import type { ClusterStateManager } from './clusterStateManager'
import type { DistributedLockManager } from './distributedLock'
import type { SocketClusterAdapter } from './socketClusterAdapter'
import { LOCK_KEYS } from './distributedLock'
import type { RoomState, PlayerConnection } from './types'
import { ClusterError, REDIS_KEYS } from './types'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

export interface RoomMigrationOptions {
  targetInstanceId?: string
  reason: 'load_balancing' | 'instance_failure' | 'manual'
  preserveState: boolean
}

export interface RoomCreationOptions {
  sessions: string[] // sessionIds
  sessionPlayers: Record<string, string> // sessionId -> playerId 映射
  instanceId?: string
  metadata?: Record<string, any>
  battleState?: any
}

export class RoomManager {
  private stateManager: ClusterStateManager
  private lockManager: DistributedLockManager
  private socketAdapter: SocketClusterAdapter
  private instanceId: string

  constructor(
    stateManager: ClusterStateManager,
    lockManager: DistributedLockManager,
    socketAdapter: SocketClusterAdapter,
    instanceId: string,
  ) {
    this.stateManager = stateManager
    this.lockManager = lockManager
    this.socketAdapter = socketAdapter
    this.instanceId = instanceId
  }

  /**
   * 创建新的战斗房间
   */
  async createRoom(options: RoomCreationOptions): Promise<string> {
    const roomId = nanoid()

    try {
      return await this.lockManager.withLock(LOCK_KEYS.ROOM_CREATE(roomId), async () => {
        // 验证会话对应的玩家连接状态
        for (const sessionId of options.sessions) {
          const playerId = options.sessionPlayers[sessionId]
          if (!playerId) {
            throw new ClusterError(`No playerId found for session ${sessionId}`, 'SESSION_PLAYER_MAPPING_ERROR')
          }

          const connection = await this.stateManager.getPlayerConnectionBySession(playerId, sessionId)
          if (!connection || connection.status !== 'connected') {
            throw new ClusterError(`Player ${playerId} (session ${sessionId}) is not connected`, 'PLAYER_NOT_CONNECTED')
          }
        }

        // 创建房间状态
        const roomState: RoomState = {
          id: roomId,
          status: 'waiting',
          sessions: options.sessions,
          sessionPlayers: options.sessionPlayers,
          instanceId: options.instanceId || this.instanceId,
          lastActive: Date.now(),
          battleState: options.battleState,
          metadata: {
            createdAt: Date.now(),
            ...options.metadata,
          },
        }

        // 保存到集群状态
        await this.stateManager.setRoomState(roomState)

        // 将玩家加入Socket.IO房间并设置映射
        for (const sessionId of options.sessions) {
          const playerId = options.sessionPlayers[sessionId]
          await this.socketAdapter.joinPlayerToRoom(playerId, roomId)
          await this.setSessionRoomMapping(sessionId, roomId)
        }

        logger.info(
          {
            roomId,
            sessions: options.sessions,
            sessionPlayers: options.sessionPlayers,
            instanceId: roomState.instanceId,
          },
          'Room created successfully',
        )
        return roomId
      })
    } catch (error) {
      logger.error({ error, roomId, options }, 'Failed to create room')
      throw new ClusterError('Failed to create room', 'ROOM_CREATION_ERROR', error)
    }
  }

  /**
   * 获取房间状态
   */
  async getRoomState(roomId: string): Promise<RoomState | null> {
    try {
      return await this.stateManager.getRoomState(roomId)
    } catch (error) {
      logger.error({ error, roomId }, 'Failed to get room state')
      return null
    }
  }

  /**
   * 更新房间状态
   */
  async updateRoomState(roomId: string, updates: Partial<RoomState>): Promise<boolean> {
    try {
      return await this.lockManager.withLock(LOCK_KEYS.ROOM_CREATE(roomId), async () => {
        const currentState = await this.stateManager.getRoomState(roomId)
        if (!currentState) {
          throw new ClusterError(`Room ${roomId} not found`, 'ROOM_NOT_FOUND')
        }

        const updatedState: RoomState = {
          ...currentState,
          ...updates,
          lastActive: Date.now(),
        }

        await this.stateManager.setRoomState(updatedState)
        logger.debug({ roomId, updates }, 'Room state updated')
        return true
      })
    } catch (error) {
      logger.error({ error, roomId, updates }, 'Failed to update room state')
      return false
    }
  }

  /**
   * 销毁房间
   */
  async destroyRoom(roomId: string, reason?: string): Promise<boolean> {
    try {
      return await this.lockManager.withLock(LOCK_KEYS.ROOM_CREATE(roomId), async () => {
        const roomState = await this.stateManager.getRoomState(roomId)
        if (!roomState) {
          logger.debug({ roomId }, 'Room not found, already destroyed')
          return true
        }

        // 将所有玩家从Socket.IO房间中移除并清理映射
        for (const sessionId of roomState.sessions) {
          const playerId = roomState.sessionPlayers[sessionId]
          if (playerId) {
            await this.socketAdapter.removePlayerFromRoom(playerId, roomId)
          }
          await this.removeSessionRoomMapping(sessionId)
        }

        // 从集群状态中删除房间
        await this.stateManager.removeRoomState(roomId)

        logger.info(
          { roomId, reason, sessions: roomState.sessions, sessionPlayers: roomState.sessionPlayers },
          'Room destroyed successfully',
        )
        return true
      })
    } catch (error) {
      logger.error({ error, roomId, reason }, 'Failed to destroy room')
      return false
    }
  }

  /**
   * 将会话添加到房间
   */
  async addSessionToRoom(roomId: string, sessionId: string, playerId: string): Promise<boolean> {
    try {
      return await this.lockManager.withLock(LOCK_KEYS.ROOM_CREATE(roomId), async () => {
        const roomState = await this.stateManager.getRoomState(roomId)
        if (!roomState) {
          throw new ClusterError(`Room ${roomId} not found`, 'ROOM_NOT_FOUND')
        }

        // 检查会话是否已在房间中
        if (roomState.sessions.includes(sessionId)) {
          logger.debug({ roomId, sessionId, playerId }, 'Session already in room')
          return true
        }

        // 验证玩家连接状态
        const connection = await this.stateManager.getPlayerConnectionBySession(playerId, sessionId)
        if (!connection || connection.status !== 'connected') {
          throw new ClusterError(`Player ${playerId} (session ${sessionId}) is not connected`, 'PLAYER_NOT_CONNECTED')
        }

        // 更新房间状态
        const updatedState: RoomState = {
          ...roomState,
          sessions: [...roomState.sessions, sessionId],
          sessionPlayers: {
            ...roomState.sessionPlayers,
            [sessionId]: playerId,
          },
          lastActive: Date.now(),
        }

        await this.stateManager.setRoomState(updatedState)

        // 将玩家加入Socket.IO房间
        await this.socketAdapter.joinPlayerToRoom(playerId, roomId)

        // 更新会话到房间的映射
        await this.setSessionRoomMapping(sessionId, roomId)

        logger.info({ roomId, sessionId, playerId }, 'Session added to room successfully')
        return true
      })
    } catch (error) {
      logger.error({ error, roomId, sessionId, playerId }, 'Failed to add session to room')
      return false
    }
  }

  /**
   * 从房间中移除会话
   */
  async removeSessionFromRoom(roomId: string, sessionId: string): Promise<boolean> {
    try {
      return await this.lockManager.withLock(LOCK_KEYS.ROOM_CREATE(roomId), async () => {
        const roomState = await this.stateManager.getRoomState(roomId)
        if (!roomState) {
          logger.debug({ roomId, sessionId }, 'Room not found, session removal skipped')
          return true
        }

        // 检查会话是否在房间中
        if (!roomState.sessions.includes(sessionId)) {
          logger.debug({ roomId, sessionId }, 'Session not in room')
          return true
        }

        const playerId = roomState.sessionPlayers[sessionId]

        // 更新房间状态
        const updatedSessions = roomState.sessions.filter(id => id !== sessionId)
        const updatedSessionPlayers = { ...roomState.sessionPlayers }
        delete updatedSessionPlayers[sessionId]

        if (updatedSessions.length === 0) {
          // 房间为空，销毁房间
          await this.destroyRoom(roomId, 'empty_room')
        } else {
          // 更新房间状态
          const updatedState: RoomState = {
            ...roomState,
            sessions: updatedSessions,
            sessionPlayers: updatedSessionPlayers,
            lastActive: Date.now(),
          }

          await this.stateManager.setRoomState(updatedState)
        }

        // 将玩家从Socket.IO房间中移除
        if (playerId) {
          await this.socketAdapter.removePlayerFromRoom(playerId, roomId)
        }

        // 移除会话到房间的映射
        await this.removeSessionRoomMapping(sessionId)

        logger.info(
          { roomId, sessionId, playerId, remainingSessions: updatedSessions.length },
          'Session removed from room successfully',
        )
        return true
      })
    } catch (error) {
      logger.error({ error, roomId, sessionId }, 'Failed to remove session from room')
      return false
    }
  }

  /**
   * 迁移房间到另一个实例
   */
  async migrateRoom(roomId: string, options: RoomMigrationOptions): Promise<boolean> {
    try {
      return await this.lockManager.withLock(LOCK_KEYS.ROOM_CREATE(roomId), async () => {
        const roomState = await this.stateManager.getRoomState(roomId)
        if (!roomState) {
          throw new ClusterError(`Room ${roomId} not found`, 'ROOM_NOT_FOUND')
        }

        // 如果没有指定目标实例，选择最佳实例
        let targetInstanceId = options.targetInstanceId
        if (!targetInstanceId) {
          // 这里可以集成服务发现来选择最佳实例
          // 暂时使用简单的逻辑
          const instances = await this.stateManager.getInstances()
          const healthyInstances = instances.filter(i => i.status === 'healthy' && i.id !== this.instanceId)

          if (healthyInstances.length === 0) {
            throw new ClusterError('No healthy instances available for migration', 'NO_HEALTHY_INSTANCES')
          }

          // 选择负载最低的实例
          targetInstanceId = healthyInstances.reduce((best, current) => (current.load < best.load ? current : best)).id
        }

        logger.info(
          {
            roomId,
            fromInstance: roomState.instanceId,
            toInstance: targetInstanceId,
            reason: options.reason,
          },
          'Starting room migration',
        )

        // 更新房间状态中的实例ID
        const migratedState: RoomState = {
          ...roomState,
          instanceId: targetInstanceId,
          lastActive: Date.now(),
          metadata: {
            ...roomState.metadata,
            migrationHistory: [
              ...(roomState.metadata?.migrationHistory || []),
              {
                fromInstance: roomState.instanceId,
                toInstance: targetInstanceId,
                reason: options.reason,
                timestamp: Date.now(),
              },
            ],
          },
        }

        // 如果不保留状态，清除战斗状态
        if (!options.preserveState) {
          migratedState.battleState = undefined
        }

        await this.stateManager.setRoomState(migratedState)

        // 通知所有玩家房间已迁移（如果需要的话）
        // 这里可以发送特殊的迁移事件给客户端

        logger.info({ roomId, targetInstanceId, reason: options.reason }, 'Room migration completed successfully')
        return true
      })
    } catch (error) {
      logger.error({ error, roomId, options }, 'Failed to migrate room')
      return false
    }
  }

  /**
   * 获取会话所在的房间
   */
  async getSessionRoom(sessionId: string): Promise<RoomState | null> {
    try {
      // 首先尝试从会话到房间的映射中查找
      const sessionRoomId = await this.getSessionRoomMapping(sessionId)
      if (sessionRoomId) {
        const roomState = await this.stateManager.getRoomState(sessionRoomId)
        if (roomState && roomState.sessions.includes(sessionId)) {
          return roomState
        } else {
          // 映射不一致，清理无效映射
          await this.removeSessionRoomMapping(sessionId)
        }
      }

      // 如果映射不存在或无效，遍历所有房间查找
      const allRooms = await this.getAllRooms()
      for (const room of allRooms) {
        if (room.sessions.includes(sessionId)) {
          // 重建映射
          await this.setSessionRoomMapping(sessionId, room.id)
          return room
        }
      }

      return null
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to get session room')
      return null
    }
  }

  /**
   * 根据playerId获取房间（通过遍历所有房间查找）
   */
  async getPlayerRoom(playerId: string): Promise<RoomState | null> {
    try {
      // 遍历所有房间查找
      const allRooms = await this.getAllRooms()
      for (const room of allRooms) {
        // 检查房间中是否有会话对应该playerId
        for (const sessionId of room.sessions) {
          if (room.sessionPlayers[sessionId] === playerId) {
            return room
          }
        }
      }

      return null
    } catch (error) {
      logger.error({ error, playerId }, 'Failed to get player room')
      return null
    }
  }

  /**
   * 根据playerId获取所有房间
   */
  async getPlayerRooms(playerId: string): Promise<RoomState[]> {
    try {
      const rooms: RoomState[] = []
      const allRooms = await this.getAllRooms()

      for (const room of allRooms) {
        // 检查房间中是否有会话对应该playerId
        const isPlayerInRoom = room.sessions.some(sessionId => room.sessionPlayers[sessionId] === playerId)
        if (isPlayerInRoom) {
          rooms.push(room)
        }
      }

      return rooms
    } catch (error) {
      logger.error({ error, playerId }, 'Failed to get player rooms')
      return []
    }
  }

  /**
   * 获取实例的所有房间
   */
  async getInstanceRooms(instanceId?: string): Promise<RoomState[]> {
    try {
      const targetInstanceId = instanceId || this.instanceId
      const allRooms = await this.getAllRooms()

      return allRooms.filter(room => room.instanceId === targetInstanceId)
    } catch (error) {
      logger.error({ error, instanceId }, 'Failed to get instance rooms')
      return []
    }
  }

  /**
   * 清理过期的房间
   * 注意：大部分房间清理现在通过 TTL 自动处理，这里只处理少量异常情况
   */
  async cleanupExpiredRooms(maxAge: number = 30 * 60 * 1000): Promise<number> {
    try {
      let cleanedCount = 0
      const now = Date.now()
      const allRooms = await this.getAllRooms()

      // 只检查少量房间，避免大量操作
      const roomsToCheck = allRooms.slice(0, Math.min(20, allRooms.length))

      for (const room of roomsToCheck) {
        const age = now - room.lastActive

        // 检查房间是否过期（只处理明显异常的情况）
        if (age > maxAge * 3) {
          // 提高阈值，只处理严重过期的房间
          // 对于已结束的房间，可以更快清理
          const shouldCleanup =
            room.status === 'ended' ||
            (room.status === 'waiting' && age > maxAge * 2) ||
            (room.status === 'active' && age > maxAge * 4) // 活跃房间给更长时间

          if (shouldCleanup) {
            const success = await this.destroyRoom(room.id, 'expired')
            if (success) {
              cleanedCount++
              logger.debug({ roomId: room.id, age, status: room.status }, 'Expired room cleaned up')
            }
          }
        }
      }

      logger.info({ cleanedCount, totalRooms: allRooms.length }, 'Room cleanup completed')
      return cleanedCount
    } catch (error) {
      logger.error({ error }, 'Failed to cleanup expired rooms')
      return 0
    }
  }

  /**
   * 获取房间统计信息
   */
  async getRoomStats(): Promise<{
    total: number
    byStatus: Record<string, number>
    byInstance: Record<string, number>
    averageSessionsPerRoom: number
  }> {
    try {
      const allRooms = await this.getAllRooms()
      const byStatus: Record<string, number> = {}
      const byInstance: Record<string, number> = {}
      let totalPlayers = 0

      for (const room of allRooms) {
        // 按状态统计
        byStatus[room.status] = (byStatus[room.status] || 0) + 1

        // 按实例统计
        byInstance[room.instanceId] = (byInstance[room.instanceId] || 0) + 1

        // 统计会话总数
        totalPlayers += room.sessions.length
      }

      const averageSessionsPerRoom = allRooms.length > 0 ? totalPlayers / allRooms.length : 0

      return {
        total: allRooms.length,
        byStatus,
        byInstance,
        averageSessionsPerRoom,
      }
    } catch (error) {
      logger.error({ error }, 'Failed to get room stats')
      return {
        total: 0,
        byStatus: {},
        byInstance: {},
        averageSessionsPerRoom: 0,
      }
    }
  }

  // === 私有辅助方法 ===

  /**
   * 获取所有房间
   */
  private async getAllRooms(): Promise<RoomState[]> {
    try {
      const client = this.stateManager['redisManager'].getClient()
      const roomIds = await client.smembers(REDIS_KEYS.ROOMS)
      const rooms: RoomState[] = []

      for (const roomId of roomIds) {
        const room = await this.stateManager.getRoomState(roomId)
        if (room) {
          rooms.push(room)
        }
      }

      return rooms
    } catch (error) {
      logger.error({ error }, 'Failed to get all rooms')
      return []
    }
  }

  /**
   * 设置会话到房间的映射
   */
  private async setSessionRoomMapping(sessionId: string, roomId: string): Promise<void> {
    try {
      const client = this.stateManager['redisManager'].getClient()
      await client.set(`session:room:${sessionId}`, roomId, 'EX', 3600) // 1小时过期
    } catch (error) {
      logger.error({ error, sessionId, roomId }, 'Failed to set session room mapping')
    }
  }

  /**
   * 获取会话到房间的映射
   */
  private async getSessionRoomMapping(sessionId: string): Promise<string | null> {
    try {
      const client = this.stateManager['redisManager'].getClient()
      return await client.get(`session:room:${sessionId}`)
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to get session room mapping')
      return null
    }
  }

  /**
   * 移除会话到房间的映射
   */
  private async removeSessionRoomMapping(sessionId: string): Promise<void> {
    try {
      const client = this.stateManager['redisManager'].getClient()
      await client.del(`session:room:${sessionId}`)
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to remove session room mapping')
    }
  }

  // === 额外的实用方法 ===

  /**
   * 根据状态获取房间列表
   */
  async getRoomsByStatus(status: RoomState['status']): Promise<RoomState[]> {
    try {
      const allRooms = await this.getAllRooms()
      return allRooms.filter(room => room.status === status)
    } catch (error) {
      logger.error({ error, status }, 'Failed to get rooms by status')
      return []
    }
  }

  /**
   * 获取会话数量在指定范围内的房间
   */
  async getRoomsBySessionCount(minSessions: number, maxSessions: number): Promise<RoomState[]> {
    try {
      const allRooms = await this.getAllRooms()
      return allRooms.filter(room => room.sessions.length >= minSessions && room.sessions.length <= maxSessions)
    } catch (error) {
      logger.error({ error, minSessions, maxSessions }, 'Failed to get rooms by session count')
      return []
    }
  }

  /**
   * 批量更新房间状态
   */
  async batchUpdateRoomStatus(roomIds: string[], status: RoomState['status']): Promise<number> {
    let successCount = 0

    for (const roomId of roomIds) {
      try {
        const success = await this.updateRoomState(roomId, { status })
        if (success) {
          successCount++
        }
      } catch (error) {
        logger.error({ error, roomId, status }, 'Failed to update room status in batch')
      }
    }

    logger.info({ successCount, totalRooms: roomIds.length, status }, 'Batch room status update completed')
    return successCount
  }

  /**
   * 检查房间是否存在且有效
   */
  async isRoomValid(roomId: string): Promise<boolean> {
    try {
      const roomState = await this.stateManager.getRoomState(roomId)
      return roomState !== null && roomState.status !== 'ended'
    } catch (error) {
      logger.error({ error, roomId }, 'Failed to check room validity')
      return false
    }
  }

  /**
   * 获取房间的会话连接状态
   */
  async getRoomSessionConnections(roomId: string): Promise<Record<string, PlayerConnection | null>> {
    try {
      const roomState = await this.stateManager.getRoomState(roomId)
      if (!roomState) {
        return {}
      }

      const connections: Record<string, PlayerConnection | null> = {}

      for (const sessionId of roomState.sessions) {
        const playerId = roomState.sessionPlayers[sessionId]
        if (playerId) {
          connections[sessionId] = await this.stateManager.getPlayerConnectionBySession(playerId, sessionId)
        }
      }

      return connections
    } catch (error) {
      logger.error({ error, roomId }, 'Failed to get room session connections')
      return {}
    }
  }

  /**
   * 强制迁移所有房间到指定实例
   */
  async forceRoomMigration(fromInstanceId: string, toInstanceId: string): Promise<number> {
    try {
      const roomsToMigrate = await this.getInstanceRooms(fromInstanceId)
      let migratedCount = 0

      for (const room of roomsToMigrate) {
        try {
          const success = await this.migrateRoom(room.id, {
            targetInstanceId: toInstanceId,
            reason: 'manual',
            preserveState: true,
          })

          if (success) {
            migratedCount++
          }
        } catch (error) {
          logger.error({ error, roomId: room.id }, 'Failed to migrate room during force migration')
        }
      }

      logger.info(
        { fromInstanceId, toInstanceId, migratedCount, totalRooms: roomsToMigrate.length },
        'Force room migration completed',
      )

      return migratedCount
    } catch (error) {
      logger.error({ error, fromInstanceId, toInstanceId }, 'Failed to perform force room migration')
      return 0
    }
  }
}
