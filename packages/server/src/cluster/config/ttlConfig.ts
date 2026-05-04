/**
 * TTL (Time To Live) 配置管理器
 * 统一管理所有 Redis 数据的过期时间配置，减少手动清理的需求
 */

export interface TTLConfig {
  // 服务实例相关 TTL
  serviceInstance: {
    heartbeatTTL: number // 服务实例心跳 TTL，应该是心跳间隔的 2-3 倍
    instanceDataTTL: number // 实例详细信息 TTL
  }

  // 玩家连接相关 TTL
  playerConnection: {
    sessionConnectionTTL: number // 会话连接 TTL
    activePlayerIndexTTL: number // 活跃玩家索引 TTL
  }

  // 会话管理相关 TTL
  session: {
    sessionDataTTL: number // 会话数据 TTL
    sessionIndexTTL: number // 会话索引 TTL
  }

  // 房间状态相关 TTL
  room: {
    waitingRoomTTL: number // 等待中的房间 TTL
    activeRoomTTL: number // 活跃房间 TTL
    endedRoomTTL: number // 已结束房间 TTL
    roomIndexTTL: number // 房间索引 TTL
  }

  // 匹配队列相关 TTL
  matchmaking: {
    queueEntryTTL: number // 队列条目 TTL
    queueIndexTTL: number // 队列索引 TTL
  }

  // 认证相关 TTL
  auth: {
    blacklistTTL: number // 黑名单条目 TTL（通常从 JWT 过期时间计算）
  }

  // 分布式锁相关 TTL
  lock: {
    defaultLockTTL: number // 默认锁 TTL
    matchmakingLockTTL: number // 匹配锁 TTL
    roomActionLockTTL: number // 房间操作锁 TTL
    playerActionLockTTL: number // 玩家操作锁 TTL
  }

  // 战报相关 TTL
  battleReport: {
    activeBattleTTL: number // 活跃战斗 TTL
    completedBattleTTL: number // 已完成战斗 TTL
  }

  // 断线重连相关 TTL
  disconnect: {
    gracePeriodTTL: number // 断线宽限期 TTL
    reconnectWindowTTL: number // 重连窗口 TTL
  }
}

/**
 * 获取 TTL 配置
 */
export function getTTLConfig(): TTLConfig {
  const isProduction = process.env.NODE_ENV === 'production'

  // 基础时间单位（毫秒）
  const MINUTE = 60 * 1000
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR

  return {
    serviceInstance: {
      // 心跳间隔的 3 倍，确保实例数据在心跳停止后自动过期
      heartbeatTTL: parseInt(process.env.SERVICE_INSTANCE_HEARTBEAT_TTL || (isProduction ? '15' : '6')) * MINUTE,
      // 实例详细信息稍长一些，用于故障恢复
      instanceDataTTL: parseInt(process.env.SERVICE_INSTANCE_DATA_TTL || (isProduction ? '20' : '10')) * MINUTE,
    },

    playerConnection: {
      // 会话连接 TTL，玩家断线后自动清理
      sessionConnectionTTL: parseInt(process.env.PLAYER_SESSION_CONNECTION_TTL || '30') * MINUTE,
      // 活跃玩家索引 TTL，定期重建
      activePlayerIndexTTL: parseInt(process.env.ACTIVE_PLAYER_INDEX_TTL || '60') * MINUTE,
    },

    session: {
      // 会话数据 TTL，默认 24 小时
      sessionDataTTL: parseInt(process.env.SESSION_DATA_TTL || '24') * HOUR,
      // 会话索引 TTL，稍长一些用于清理
      sessionIndexTTL: parseInt(process.env.SESSION_INDEX_TTL || '25') * HOUR,
    },

    room: {
      // 等待中的房间 TTL，较短
      waitingRoomTTL: parseInt(process.env.WAITING_ROOM_TTL || '30') * MINUTE,
      // 活跃房间 TTL，较长
      activeRoomTTL: parseInt(process.env.ACTIVE_ROOM_TTL || '4') * HOUR,
      // 已结束房间 TTL，用于查看结果
      endedRoomTTL: parseInt(process.env.ENDED_ROOM_TTL || '2') * HOUR,
      // 房间索引 TTL
      roomIndexTTL: parseInt(process.env.ROOM_INDEX_TTL || '6') * HOUR,
    },

    matchmaking: {
      // 队列条目 TTL，避免玩家长时间等待
      queueEntryTTL: parseInt(process.env.MATCHMAKING_QUEUE_ENTRY_TTL || '30') * MINUTE,
      // 队列索引 TTL
      queueIndexTTL: parseInt(process.env.MATCHMAKING_QUEUE_INDEX_TTL || '60') * MINUTE,
    },

    auth: {
      // 黑名单 TTL，通常与 JWT 过期时间一致
      blacklistTTL: parseInt(process.env.AUTH_BLACKLIST_TTL || '24') * HOUR,
    },

    lock: {
      // 默认锁 TTL
      defaultLockTTL: parseInt(process.env.DEFAULT_LOCK_TTL || '30') * 1000, // 30秒
      // 匹配锁 TTL，匹配过程较长
      matchmakingLockTTL: parseInt(process.env.MATCHMAKING_LOCK_TTL || '60') * 1000, // 60秒
      // 房间操作锁 TTL
      roomActionLockTTL: parseInt(process.env.ROOM_ACTION_LOCK_TTL || '30') * 1000, // 30秒
      // 玩家操作锁 TTL
      playerActionLockTTL: parseInt(process.env.PLAYER_ACTION_LOCK_TTL || '10') * 1000, // 10秒
    },

    battleReport: {
      // 活跃战斗 TTL，战斗进行中
      activeBattleTTL: parseInt(process.env.ACTIVE_BATTLE_TTL || '2') * HOUR,
      // 已完成战斗 TTL，用于查看历史
      completedBattleTTL: parseInt(process.env.COMPLETED_BATTLE_TTL || '7') * DAY,
    },

    disconnect: {
      // 断线宽限期 TTL，玩家断线后的重连窗口
      gracePeriodTTL: parseInt(process.env.DISCONNECT_GRACE_PERIOD_TTL || '60') * 1000, // 生产环境2分钟，开发环境1分钟
      // 重连窗口 TTL，用于跨实例重连支持
      reconnectWindowTTL: parseInt(process.env.RECONNECT_WINDOW_TTL || '60') * 1000, // 生产环境5分钟，开发环境3分钟
    },
  }
}

/**
 * TTL 辅助函数
 */
export class TTLHelper {
  private static config: TTLConfig = getTTLConfig()

  /**
   * 刷新配置（用于运行时更新）
   */
  static refreshConfig(): void {
    this.config = getTTLConfig()
  }

  /**
   * 获取配置
   */
  static getConfig(): TTLConfig {
    return this.config
  }

  /**
   * 为 Redis 键设置 TTL
   */
  static async setKeyTTL(client: any, key: string, ttlMs: number): Promise<void> {
    if (ttlMs > 0) {
      await client.pexpire(key, ttlMs)
    }
  }

  /**
   * 批量设置 TTL
   */
  static async setBatchTTL(client: any, keyTTLPairs: Array<{ key: string; ttl: number }>): Promise<void> {
    if (keyTTLPairs.length === 0) return

    const pipeline = client.pipeline()
    for (const { key, ttl } of keyTTLPairs) {
      if (ttl > 0) {
        pipeline.pexpire(key, ttl)
      }
    }
    await pipeline.exec()
  }

  /**
   * 根据数据类型获取相应的 TTL
   */
  static getTTLForDataType(dataType: string, subType?: string): number {
    const config = this.getConfig()

    switch (dataType) {
      case 'serviceInstance':
        return subType === 'heartbeat' ? config.serviceInstance.heartbeatTTL : config.serviceInstance.instanceDataTTL

      case 'playerConnection':
        return subType === 'index'
          ? config.playerConnection.activePlayerIndexTTL
          : config.playerConnection.sessionConnectionTTL

      case 'session':
        return subType === 'index' ? config.session.sessionIndexTTL : config.session.sessionDataTTL

      case 'room':
        switch (subType) {
          case 'waiting':
            return config.room.waitingRoomTTL
          case 'active':
            return config.room.activeRoomTTL
          case 'ended':
            return config.room.endedRoomTTL
          case 'index':
            return config.room.roomIndexTTL
          default:
            return config.room.activeRoomTTL
        }

      case 'matchmaking':
        return subType === 'index' ? config.matchmaking.queueIndexTTL : config.matchmaking.queueEntryTTL

      case 'auth':
        return config.auth.blacklistTTL

      case 'lock':
        switch (subType) {
          case 'matchmaking':
            return config.lock.matchmakingLockTTL
          case 'room':
            return config.lock.roomActionLockTTL
          case 'player':
            return config.lock.playerActionLockTTL
          default:
            return config.lock.defaultLockTTL
        }

      case 'battleReport':
        return subType === 'completed' ? config.battleReport.completedBattleTTL : config.battleReport.activeBattleTTL

      case 'disconnect':
        return subType === 'window' ? config.disconnect.reconnectWindowTTL : config.disconnect.gracePeriodTTL

      default:
        return config.lock.defaultLockTTL // 默认使用锁的 TTL
    }
  }

  /**
   * 计算基于状态的动态 TTL
   */
  static getDynamicTTL(dataType: string, status: string, baseTime?: number): number {
    const config = this.getConfig()
    const now = Date.now()

    switch (dataType) {
      case 'room':
        switch (status) {
          case 'waiting':
            return config.room.waitingRoomTTL
          case 'active':
            // 活跃房间根据已运行时间调整 TTL
            const runTime = baseTime ? now - baseTime : 0
            const remainingTTL = Math.max(config.room.activeRoomTTL - runTime, 30 * 60 * 1000) // 最少30分钟
            return remainingTTL
          case 'ended':
            return config.room.endedRoomTTL
          default:
            return config.room.activeRoomTTL
        }

      case 'battle':
        switch (status) {
          case 'active':
            return config.battleReport.activeBattleTTL
          case 'completed':
          case 'ended':
            return config.battleReport.completedBattleTTL
          default:
            return config.battleReport.activeBattleTTL
        }

      default:
        return this.getTTLForDataType(dataType)
    }
  }
}
