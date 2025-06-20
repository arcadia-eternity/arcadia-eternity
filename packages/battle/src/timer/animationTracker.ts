import { type TimerConfig, type AnimationInfo, type playerId } from '@arcadia-eternity/const'
import mitt, { type Emitter } from 'mitt'
import { nanoid } from 'nanoid'
import { createChildLogger } from '../logger'

type AnimationTrackerEvents = {
  animationStart: any
  animationEnd: any
  animationForceEnd: any
}

/**
 * 动画追踪器
 * 追踪当前播放的动画，管理动画时间窗口，防止客户端作弊
 */
export class AnimationTracker {
  private readonly logger = createChildLogger('AnimationTracker')
  private activeAnimations: Map<string, AnimationInfo> = new Map()
  private animationTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private animationOwners: Map<string, playerId> = new Map() // 存储动画所有者
  private normallyEndedAnimations: Set<string> = new Set() // 跟踪已正常结束的动画
  private emitter: Emitter<AnimationTrackerEvents> = mitt<AnimationTrackerEvents>()
  private timeoutCallback?: (animationId: string, ownerId: playerId) => void

  constructor(private readonly config: TimerConfig) {}

  /**
   * 设置超时回调函数
   */
  public setTimeoutCallback(callback: (animationId: string, ownerId: playerId) => void): void {
    this.timeoutCallback = callback
  }

  /**
   * 开始追踪动画
   */
  public startAnimation(
    source: string,
    expectedDuration: number,
    customId: string | undefined,
    ownerId: playerId,
  ): string {
    const animationId = customId || nanoid()

    // 验证动画时长不超过最大限制
    const safeDuration = Math.min(expectedDuration, this.config.maxAnimationDuration)

    const animationInfo: AnimationInfo = {
      id: animationId,
      startTime: Date.now(),
      expectedDuration: safeDuration,
      source,
    }

    this.activeAnimations.set(animationId, animationInfo)

    // 存储动画所有者
    this.animationOwners.set(animationId, ownerId)

    // 设置安全超时，防止动画永远不结束
    const timeout = setTimeout(() => {
      this.forceEndAnimation(animationId, 'timeout')
    }, safeDuration + 1000) // 给1秒的缓冲时间

    this.animationTimeouts.set(animationId, timeout)

    // 发送动画开始事件
    this.emitter.emit('animationStart', {
      animationId,
      duration: safeDuration,
      source,
    })

    return animationId
  }

  /**
   * 结束动画追踪
   */
  public endAnimation(animationId: string, actualDuration?: number): boolean {
    const animation = this.activeAnimations.get(animationId)
    if (!animation) {
      // 动画可能已经被超时机制清理，这是正常情况，不需要警告
      this.logger.debug(`Animation ${animationId} not found (may have been cleaned up by timeout)`)
      return false
    }

    // 记录这个动画已经正常结束
    this.normallyEndedAnimations.add(animationId)
    this.logger.debug(`Animation ${animationId} marked as normally ended`)

    // 计算实际时长
    const calculatedDuration = actualDuration || Date.now() - animation.startTime
    animation.actualDuration = calculatedDuration

    // 验证动画时长是否合理
    const isValidDuration = this.validateAnimationDuration(animation)
    if (!isValidDuration) {
      this.logger.debug(
        `Animation ${animationId} has invalid duration: ${calculatedDuration}ms (expected: ${animation.expectedDuration}ms)`,
      )
    }

    // 清理
    this.cleanupAnimation(animationId)

    // 发送动画结束事件
    this.emitter.emit('animationEnd', {
      animationId,
      actualDuration: calculatedDuration,
      valid: isValidDuration,
    })

    return isValidDuration
  }

  /**
   * 强制结束动画
   */
  public forceEndAnimation(animationId: string, reason: string): void {
    const animation = this.activeAnimations.get(animationId)
    if (!animation) {
      this.logger.debug(`Animation ${animationId} already cleaned up, skipping force end`)
      return
    }

    // 检查动画是否已经正常结束
    if (this.normallyEndedAnimations.has(animationId)) {
      this.logger.debug(`Animation ${animationId} was already normally ended, skipping force end (reason: ${reason})`)
      // 仍然需要清理，因为正常结束可能没有清理超时器
      this.cleanupAnimation(animationId)
      return
    }

    // 在清理之前获取动画所有者信息
    const animationOwner = this.animationOwners.get(animationId)

    // 计算实际时长
    animation.actualDuration = Date.now() - animation.startTime

    if (reason === 'timeout') {
      this.logger.debug(
        `Animation ${animationId} timed out after ${animation.actualDuration}ms, expected: ${animation.expectedDuration}ms (max: ${this.config.maxAnimationDuration}ms)`,
      )
    } else {
      this.logger.warn(`Force ending animation ${animationId}, reason: ${reason}`)
    }

    // 如果是超时且有回调函数，直接调用回调
    if (reason === 'timeout' && this.timeoutCallback && animationOwner) {
      this.logger.debug(`calling timeout callback for ${animationId}, owner: ${animationOwner}`)
      this.timeoutCallback(animationId, animationOwner)
    }

    this.cleanupAnimation(animationId)

    this.logger.debug(`emitting animationForceEnd event for ${animationId}, owner: ${animationOwner}`)

    this.emitter.emit('animationForceEnd', {
      animationId,
      reason,
      actualDuration: animation.actualDuration,
      ownerId: animationOwner, // 包含动画所有者信息
    })
  }

  /**
   * 获取当前活跃的动画
   */
  public getActiveAnimations(): AnimationInfo[] {
    return Array.from(this.activeAnimations.values())
  }

  /**
   * 检查是否有活跃的动画
   */
  public hasActiveAnimations(): boolean {
    return this.activeAnimations.size > 0
  }

  /**
   * 获取特定动画信息
   */
  public getAnimation(animationId: string): AnimationInfo | undefined {
    return this.activeAnimations.get(animationId)
  }

  /**
   * 获取动画的所有者
   */
  public getAnimationOwner(animationId: string): playerId | undefined {
    return this.animationOwners.get(animationId)
  }

  /**
   * 清理所有动画
   */
  public clearAllAnimations(): void {
    const animationIds = Array.from(this.activeAnimations.keys())
    animationIds.forEach(id => this.forceEndAnimation(id, 'cleanup'))
    // 清理所有正常结束记录
    this.normallyEndedAnimations.clear()
  }

  /**
   * 验证动画时长是否合理
   */
  private validateAnimationDuration(animation: AnimationInfo): boolean {
    if (!animation.actualDuration) return false

    // 检查是否超过最大允许时长
    if (animation.actualDuration > this.config.maxAnimationDuration) {
      return false
    }

    // 检查是否过短（小于100ms可能是异常）
    if (animation.actualDuration < 100) {
      return false
    }

    // 对于动画时长验证，我们采用更宽松的策略
    // 只要在合理范围内（不超过最大时长，不过短）就认为有效
    // 不再严格要求与预期时长匹配，因为实际动画时长可能因为各种因素而变化
    return true
  }

  /**
   * 清理单个动画
   */
  private cleanupAnimation(animationId: string): void {
    this.activeAnimations.delete(animationId)
    this.animationOwners.delete(animationId)
    this.normallyEndedAnimations.delete(animationId) // 清理正常结束记录

    const timeout = this.animationTimeouts.get(animationId)
    if (timeout) {
      clearTimeout(timeout)
      this.animationTimeouts.delete(animationId)
    }
  }

  /**
   * 获取统计信息
   */
  public getStats(): {
    activeCount: number
    totalTracked: number
    averageDuration: number
  } {
    const activeCount = this.activeAnimations.size
    // 这里可以添加更多统计信息的逻辑
    return {
      activeCount,
      totalTracked: 0, // 需要添加总计数器
      averageDuration: 0, // 需要添加平均时长计算
    }
  }

  /**
   * 事件监听方法
   */
  public on<K extends keyof AnimationTrackerEvents>(
    type: K,
    handler: (event: AnimationTrackerEvents[K]) => void,
  ): void {
    this.emitter.on(type, handler)
  }

  public off<K extends keyof AnimationTrackerEvents>(
    type: K,
    handler: (event: AnimationTrackerEvents[K]) => void,
  ): void {
    this.emitter.off(type, handler)
  }

  /**
   * 清理资源
   */
  public cleanup(): void {
    this.clearAllAnimations()
    this.emitter.all.clear()
  }
}
