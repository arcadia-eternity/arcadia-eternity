/**
 * AnimationStateMachine — 动画状态机的核心实现
 *
 * 职责：
 * - 管理动画生命周期状态（IDLE → PREPARING → PLAYING → COMPLETING → IDLE）
 * - 支持异常状态（PAUSED / CATCHING_UP / RECOVERING / STUCK）
 * - 提供快照/恢复机制用于断线重连
 * - 提供状态变更监听器用于健康检查和 UI 联动
 * - 跟踪 Transform（变身）事件上下文
 */

import { reactive, readonly, type DeepReadonly } from 'vue'
import type { BattleMessageType } from '@arcadia-eternity/const'

// ── 动画状态枚举 ─────────────────────────────────────────────

export enum AnimationState {
  /** 空闲：等待下一条消息 */
  IDLE = 'idle',
  /** 准备中：加载资源 / 等待 PetSprite ready */
  PREPARING = 'preparing',
  /** 播放中：GSAP 动画 / SWF 动画正在执行 */
  PLAYING = 'playing',
  /** 收尾中：清理临时 DOM、应用 stateDelta */
  COMPLETING = 'completing',
  /** 暂停：Socket 断连触发 */
  PAUSED = 'paused',
  /** 追赶中：消息积压，跳过动画仅应用状态 */
  CATCHING_UP = 'catching_up',
  /** 恢复中：重连后同步状态 */
  RECOVERING = 'recovering',
  /** 卡死：健康检查发现异常，需要人工/自动恢复 */
  STUCK = 'stuck',
}

// ── 动画上下文 ───────────────────────────────────────────────

export interface AnimationContext {
  /** 当前状态 */
  state: AnimationState
  /** 当前正在处理的消息类型 */
  currentMessageType: BattleMessageType | null
  /** 动画所在的侧（左/右） */
  currentSide: 'left' | 'right' | null
  /** 当前技能 ID（如果有） */
  currentSkillId: string | null
  /** 当前精灵 ID（受影响的精灵） */
  currentPetId: string | null
  /** 开始动画时的消息序号 */
  sequenceId: number
  /** 动画开始时间戳（performance.now） */
  startTime: number
  /** 预期的动画时长（ms），用于超时计算 */
  expectedDuration: number
  /** 动画序列中是否检测到变身（Transform） */
  hasTransform: boolean
  /** 是否为基于 SWF 精灵的动画（非 GSAP），健康检查需区别对待 */
  isSpriteAnimation: boolean
  /** 活跃的 GSAP tween ID 列表 */
  activeTweenIds: string[]
  /** 动画创建的临时 DOM 节点数量 */
  tempDomCount: number
  /** 动画被取消/中断的原因 */
  cancelReason: string | null
}

function createDefaultContext(): AnimationContext {
  return {
    state: AnimationState.IDLE,
    currentMessageType: null,
    currentSide: null,
    currentSkillId: null,
    currentPetId: null,
    sequenceId: -1,
    startTime: 0,
    expectedDuration: 0,
    hasTransform: false,
    isSpriteAnimation: false,
    activeTweenIds: [],
    tempDomCount: 0,
    cancelReason: null,
  }
}

// ── 过渡日志条目 ────────────────────────────────────────────

export interface TransitionLogEntry {
  from: AnimationState
  to: AnimationState
  time: number
  reason: string
}

// ── 状态变更监听器 ──────────────────────────────────────────

export type StateListener = (from: AnimationState, to: AnimationState, ctx: DeepReadonly<AnimationContext>) => void

// ── 最大过渡日志条数 ────────────────────────────────────────

const MAX_TRANSITION_LOG = 200

// ── 核心类 ──────────────────────────────────────────────────

export class AnimationStateMachine {
  private _context = reactive(createDefaultContext())
  private _listeners = new Set<StateListener>()
  private _transitionLog: TransitionLogEntry[] = []

  // ── 只读暴露（防止外部直接修改） ────────────────────────────
  readonly context = readonly(this._context) as DeepReadonly<AnimationContext>

  /** 获取当前状态（同步，无需 await） */
  get state(): AnimationState {
    return this._context.state
  }

  /** 获取过渡日志（调试用） */
  get transitionLog(): readonly TransitionLogEntry[] {
    return this._transitionLog
  }

  // ── 状态转换（核心方法） ──────────────────────────────────

  /**
   * 执行状态转换。幂等：如果目标状态与当前相同，跳过。
   * @param to 目标状态
   * @param reason 转换原因（用于日志和调试）
   */
  transition(to: AnimationState, reason: string): void {
    if (this._context.state === to) return

    const from = this._context.state
    const entry: TransitionLogEntry = { from, to, time: Date.now(), reason }

    this._transitionLog.push(entry)
    if (this._transitionLog.length > MAX_TRANSITION_LOG) {
      this._transitionLog = this._transitionLog.slice(-MAX_TRANSITION_LOG)
    }

    this._context.state = to

    // 通知所有监听器
    const ctx = this.snapshot()
    for (const listener of this._listeners) {
      try {
        listener(from, to, ctx)
      } catch (err) {
        console.error('[AnimationStateMachine] listener error:', err)
      }
    }
  }

  // ── 上下文更新 ───────────────────────────────────────────

  /** 开始一个新动画任务 */
  beginTask(opts: {
    messageType: BattleMessageType
    side: 'left' | 'right'
    skillId?: string
    petId?: string
    sequenceId: number
    expectedDuration: number
  }): void {
    this._context.currentMessageType = opts.messageType
    this._context.currentSide = opts.side
    this._context.currentSkillId = opts.skillId ?? null
    this._context.currentPetId = opts.petId ?? null
    this._context.sequenceId = opts.sequenceId
    this._context.startTime = performance.now()
    this._context.expectedDuration = opts.expectedDuration
    this._context.hasTransform = false
    this._context.isSpriteAnimation = opts.messageType === 'SKILL_USE'
    this._context.activeTweenIds = []
    this._context.tempDomCount = 0
    this._context.cancelReason = null
  }

  /** 注册 GSAP tween ID */
  registerTween(id: string): void {
    if (!this._context.activeTweenIds.includes(id)) {
      this._context.activeTweenIds.push(id)
    }
  }

  /** 注销 GSAP tween ID */
  unregisterTween(id: string): void {
    const idx = this._context.activeTweenIds.indexOf(id)
    if (idx >= 0) this._context.activeTweenIds.splice(idx, 1)
  }

  /** 增加临时 DOM 计数 */
  incrementTempDom(): void {
    this._context.tempDomCount++
  }

  /** 减少临时 DOM 计数 */
  decrementTempDom(): void {
    if (this._context.tempDomCount > 0) this._context.tempDomCount--
  }

  /** 标记动画序列中存在变身 */
  markTransform(petId: string): void {
    this._context.hasTransform = true
    this._context.currentPetId = petId
  }

  // ── 生命周期快捷方法 ──────────────────────────────────────

  /** 断线时调用 → PAUSED */
  onDisconnect(): void {
    this._context.cancelReason = 'socket-disconnected'
    this.transition(AnimationState.PAUSED, 'socket-disconnected')
  }

  /** 开始重连 → RECOVERING */
  onReconnect(): void {
    this.transition(AnimationState.RECOVERING, 'socket-reconnected')
  }

  /** 恢复完成 → IDLE */
  onRecoveryComplete(): void {
    this.transition(AnimationState.IDLE, 'recovery-complete')
  }

  /** 检测到消息积压 → CATCHING_UP */
  onBacklog(backlogSize: number): void {
    if (
      this._context.state === AnimationState.PLAYING ||
      this._context.state === AnimationState.PREPARING ||
      this._context.state === AnimationState.RECOVERING
    ) {
      this._context.cancelReason = `backlog-${backlogSize}`
      this.transition(AnimationState.CATCHING_UP, `backlog-${backlogSize}`)
    }
  }

  /** 追赶完成 → IDLE */
  onCatchupComplete(): void {
    if (this._context.state === AnimationState.CATCHING_UP) {
      this.transition(AnimationState.IDLE, 'catchup-complete')
    }
  }

  /** 标记卡死 → STUCK */
  markStuck(reason: string): void {
    this._context.cancelReason = reason
    this.transition(AnimationState.STUCK, reason)
  }

  /** 强制恢复到 IDLE（健康检查触发） */
  forceRecover(): void {
    this.transition(AnimationState.RECOVERING, 'force-recovery')
    // 立即转到 IDLE
    this._context.cancelReason = 'force-recovered'
    this.transition(AnimationState.IDLE, 'force-recovery-complete')
  }

  // ── 状态查询 ──────────────────────────────────────────────

  /** 是否正在执行动画（PREPARING/PLAYING/COMPLETING） */
  get isAnimating(): boolean {
    return [AnimationState.PREPARING, AnimationState.PLAYING, AnimationState.COMPLETING].includes(this._context.state)
  }

  /** 是否处于恢复流程（PAUSED/RECOVERING/CATCHING_UP/STUCK） */
  get isRecovering(): boolean {
    return [
      AnimationState.PAUSED,
      AnimationState.RECOVERING,
      AnimationState.CATCHING_UP,
      AnimationState.STUCK,
    ].includes(this._context.state)
  }

  /** 是否可以接受新动画任务 */
  get canAcceptNewTask(): boolean {
    return this._context.state === AnimationState.IDLE && !this.isRecovering
  }

  /** 是否应该跳过动画（快进模式） */
  get shouldSkipAnimation(): boolean {
    return this._context.state === AnimationState.CATCHING_UP || this._context.state === AnimationState.RECOVERING
  }

  // ── 快照与恢复 ────────────────────────────────────────────

  /** 创建当前上下文的深度快照 */
  snapshot(): AnimationContext {
    return {
      state: this._context.state,
      currentMessageType: this._context.currentMessageType,
      currentSide: this._context.currentSide,
      currentSkillId: this._context.currentSkillId,
      currentPetId: this._context.currentPetId,
      sequenceId: this._context.sequenceId,
      startTime: this._context.startTime,
      expectedDuration: this._context.expectedDuration,
      hasTransform: this._context.hasTransform,
      isSpriteAnimation: this._context.isSpriteAnimation,
      activeTweenIds: [...this._context.activeTweenIds],
      tempDomCount: this._context.tempDomCount,
      cancelReason: this._context.cancelReason,
    }
  }

  // ── 监听器管理 ────────────────────────────────────────────

  /** 注册状态变更监听器。返回取消注册函数 */
  onStateChange(listener: StateListener): () => void {
    this._listeners.add(listener)
    return () => {
      this._listeners.delete(listener)
    }
  }

  /** 获取最后的 N 条过渡日志（调试用） */
  getRecentTransitions(n = 10): readonly TransitionLogEntry[] {
    return this._transitionLog.slice(-n)
  }

  // ── 重置 ──────────────────────────────────────────────────

  /** 完全重置状态机 */
  reset(): void {
    this._context.state = AnimationState.IDLE
    this._context.currentMessageType = null
    this._context.currentSide = null
    this._context.currentSkillId = null
    this._context.currentPetId = null
    this._context.sequenceId = -1
    this._context.startTime = 0
    this._context.expectedDuration = 0
    this._context.hasTransform = false
    this._context.isSpriteAnimation = false
    this._context.activeTweenIds = []
    this._context.tempDomCount = 0
    this._context.cancelReason = null
  }

  /** 销毁（清理监听器） */
  destroy(): void {
    this._listeners.clear()
    this._transitionLog = []
    this.reset()
  }
}
