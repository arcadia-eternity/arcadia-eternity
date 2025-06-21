import { type playerId, type TimerSnapshot, type TimerCacheItem, TIMER_CONSTANTS } from '@arcadia-eternity/const'
import pino from 'pino'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  formatters: {
    level: label => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
})

const createChildLogger = (name: string) => logger.child({ component: name })

/**
 * Timer状态缓存管理器
 * 智能缓存Timer快照，减少跨实例通信和频繁查询
 */
export class TimerStateCache {
  private readonly logger = createChildLogger('TimerStateCache')

  // 玩家Timer快照缓存
  private readonly playerSnapshotCache = new Map<playerId, TimerCacheItem>()

  // 房间级别的Timer快照缓存
  private readonly roomSnapshotCache = new Map<
    string,
    {
      snapshots: TimerSnapshot[]
      cachedAt: number
      ttl: number
    }
  >()

  // Timer启用状态缓存
  private readonly timerEnabledCache = new Map<
    string,
    {
      enabled: boolean
      timestamp: number
    }
  >()

  // 清理定时器
  private cleanupTimer?: ReturnType<typeof setInterval>

  constructor() {
    // 每分钟清理一次过期缓存
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredCache()
    }, 60000)
  }

  /**
   * 缓存玩家Timer快照
   */
  public cachePlayerSnapshot(playerId: playerId, snapshot: TimerSnapshot, ttl?: number): void {
    const cacheItem: TimerCacheItem = {
      snapshot,
      cachedAt: Date.now(),
      ttl: ttl || TIMER_CONSTANTS.TIMER_CACHE_TTL,
    }

    this.playerSnapshotCache.set(playerId, cacheItem)
    this.logger.debug(`Cached timer snapshot for player ${playerId}`)
  }

  /**
   * 获取玩家Timer快照
   */
  public getPlayerSnapshot(playerId: playerId): TimerSnapshot | null {
    const cacheItem = this.playerSnapshotCache.get(playerId)
    if (!cacheItem) {
      return null
    }

    const now = Date.now()
    if (now - cacheItem.cachedAt > cacheItem.ttl) {
      // 缓存过期，删除并返回null
      this.playerSnapshotCache.delete(playerId)
      this.logger.debug(`Timer snapshot cache expired for player ${playerId}`)
      return null
    }

    return cacheItem.snapshot
  }

  /**
   * 缓存房间Timer快照
   */
  public cacheRoomSnapshots(roomId: string, snapshots: TimerSnapshot[], ttl?: number): void {
    const cacheItem = {
      snapshots,
      cachedAt: Date.now(),
      ttl: ttl || TIMER_CONSTANTS.TIMER_CACHE_TTL,
    }

    this.roomSnapshotCache.set(roomId, cacheItem)
    this.logger.debug(`Cached timer snapshots for room ${roomId}, count: ${snapshots.length}`)
  }

  /**
   * 获取房间Timer快照
   */
  public getRoomSnapshots(roomId: string): TimerSnapshot[] | null {
    const cacheItem = this.roomSnapshotCache.get(roomId)
    if (!cacheItem) {
      return null
    }

    const now = Date.now()
    if (now - cacheItem.cachedAt > cacheItem.ttl) {
      // 缓存过期，删除并返回null
      this.roomSnapshotCache.delete(roomId)
      this.logger.debug(`Timer snapshots cache expired for room ${roomId}`)
      return null
    }

    return cacheItem.snapshots
  }

  /**
   * 缓存Timer启用状态
   */
  public cacheTimerEnabled(key: string, enabled: boolean, ttl?: number): void {
    this.timerEnabledCache.set(key, {
      enabled,
      timestamp: Date.now(),
    })
    this.logger.debug(`Cached timer enabled status: ${key} = ${enabled}`)
  }

  /**
   * 获取Timer启用状态
   */
  public getTimerEnabled(key: string): boolean | null {
    const cached = this.timerEnabledCache.get(key)
    if (!cached) {
      return null
    }

    const now = Date.now()
    if (now - cached.timestamp > TIMER_CONSTANTS.TIMER_CACHE_TTL) {
      // 缓存过期
      this.timerEnabledCache.delete(key)
      this.logger.debug(`Timer enabled cache expired for key: ${key}`)
      return null
    }

    return cached.enabled
  }

  /**
   * 使玩家缓存失效
   */
  public invalidatePlayer(playerId: playerId): void {
    this.playerSnapshotCache.delete(playerId)
    this.logger.debug(`Invalidated timer cache for player ${playerId}`)
  }

  /**
   * 使房间缓存失效
   */
  public invalidateRoom(roomId: string): void {
    this.roomSnapshotCache.delete(roomId)
    this.logger.debug(`Invalidated timer cache for room ${roomId}`)
  }

  /**
   * 清理过期缓存
   */
  private cleanupExpiredCache(): void {
    const now = Date.now()
    let cleanedCount = 0

    // 清理玩家快照缓存
    for (const [playerId, cacheItem] of this.playerSnapshotCache.entries()) {
      if (now - cacheItem.cachedAt > cacheItem.ttl) {
        this.playerSnapshotCache.delete(playerId)
        cleanedCount++
      }
    }

    // 清理房间快照缓存
    for (const [roomId, cacheItem] of this.roomSnapshotCache.entries()) {
      if (now - cacheItem.cachedAt > cacheItem.ttl) {
        this.roomSnapshotCache.delete(roomId)
        cleanedCount++
      }
    }

    // 清理Timer启用状态缓存
    for (const [key, cached] of this.timerEnabledCache.entries()) {
      if (now - cached.timestamp > TIMER_CONSTANTS.TIMER_CACHE_TTL * 2) {
        this.timerEnabledCache.delete(key)
        cleanedCount++
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`Cleaned up ${cleanedCount} expired timer cache entries`)
    }
  }

  /**
   * 获取缓存统计信息
   */
  public getCacheStats(): {
    playerSnapshots: number
    roomSnapshots: number
    timerEnabled: number
  } {
    return {
      playerSnapshots: this.playerSnapshotCache.size,
      roomSnapshots: this.roomSnapshotCache.size,
      timerEnabled: this.timerEnabledCache.size,
    }
  }

  /**
   * 清理所有缓存
   */
  public cleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = undefined
    }

    this.playerSnapshotCache.clear()
    this.roomSnapshotCache.clear()
    this.timerEnabledCache.clear()

    this.logger.info('Timer state cache cleaned up')
  }
}
