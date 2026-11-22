import { AnimationState, type AnimationStateMachine } from './animationStateMachine'
import type { AnimationGsapManager } from './animationGsapManager'
import type { BattleStoreLike } from './animationTypes'

const CHECK_INTERVAL_MS = 3000
const ANIMATION_TIMEOUT_RATIO = 3

export class AnimationHealthMonitor {
  private checkTimer: ReturnType<typeof setInterval> | null = null
  private emptyOnLastCheck = false
  private fetchingActions = false

  constructor(
    private stateMachine: AnimationStateMachine,
    private store: BattleStoreLike,
    private gsapManager: AnimationGsapManager,
  ) {}

  start(): void {
    if (this.checkTimer !== null) return
    this.checkTimer = setInterval(() => {
      this.runHealthCheck().catch(err => {
        console.warn('[AnimationHealthMonitor] health check error:', err)
      })
    }, CHECK_INTERVAL_MS)
  }

  private async runHealthCheck(): Promise<void> {
    await this.checkAnimationStuck()
    await this.checkAvailableActions()
  }

  private async checkAnimationStuck(): Promise<void> {
    const state = this.stateMachine.state
    if (state !== AnimationState.PLAYING && state !== AnimationState.PREPARING) return

    const ctx = this.stateMachine.snapshot()
    const elapsed = performance.now() - ctx.startTime
    if (elapsed <= 0) return

    // Check if the animated pet has died — force recovery after expected duration passes
    if (elapsed > ctx.expectedDuration && this.isAnimatedPetDead(ctx)) {
      console.warn(
        `[AnimationHealthMonitor] animated pet ${ctx.currentPetId} is dead after ${elapsed.toFixed(0)}ms → forcing recovery`,
      )
      this.forceRecovery()
      return
    }

    const maxDuration = Math.max(ctx.expectedDuration * ANIMATION_TIMEOUT_RATIO, 30000)

    if (elapsed > maxDuration) {
      console.warn(
        `[AnimationHealthMonitor] animation stuck in ${ctx.state} for ${elapsed.toFixed(0)}ms → forcing recovery`,
      )
      this.forceRecovery()
      return
    }

    if (ctx.isSpriteAnimation) return

    const nearTimeout = elapsed > maxDuration * 0.8
    const noActiveTweens = !this.gsapManager.isAnyActive()
    if (nearTimeout && noActiveTweens) {
      console.warn('[AnimationHealthMonitor] no active GSAP tweens near timeout → forcing recovery')
      this.forceRecovery()
    }
  }

  private isAnimatedPetDead(ctx: { currentPetId: string | null }): boolean {
    const petId = ctx.currentPetId
    if (!petId) return false

    const players = this.store.battleState?.players
    if (!players) return false

    for (const player of players) {
      const team = player.team
      if (!team) continue
      for (const pet of team) {
        if (pet.id === petId) {
          return (pet.currentHp ?? 1) <= 0
        }
      }
    }
    return false
  }

  private async checkAvailableActions(): Promise<void> {
    const canRefresh = () =>
      this.stateMachine.canAcceptNewTask &&
      !this.store.isReplayMode &&
      !this.store.isBattleEnd &&
      !this.store.waitingForResponse &&
      this.store.battleState?.status !== 'Ended' &&
      (this.store.battleState?.currentPhase === 'SELECTION_PHASE' ||
        this.store.battleState?.currentPhase === 'SWITCH_PHASE') &&
      this.store.availableActions.length === 0
    if (!canRefresh()) {
      this.emptyOnLastCheck = false
      return
    }
    if (this.fetchingActions) return
    if (!this.emptyOnLastCheck) {
      this.emptyOnLastCheck = true
      return
    }

    // An empty list is legitimate while the opponent chooses a replacement.
    // Refresh it without preventing the queue from processing the next prompt.
    this.emptyOnLastCheck = false
    this.fetchingActions = true
    const timer = this.checkTimer
    const sequenceId = this.store.lastProcessedSequenceId
    const snapshot = this.store.battleState
    const current = () =>
      timer !== null &&
      timer === this.checkTimer &&
      sequenceId === this.store.lastProcessedSequenceId &&
      snapshot === this.store.battleState &&
      canRefresh()
    try {
      const actions = await this.store.fetchAvailableSelection(current)
      if (current() && actions.length) this.store.availableActions = actions
    } finally {
      if (timer === this.checkTimer) this.fetchingActions = false
    }
  }

  forceRecovery(): void {
    this.gsapManager.killAll()
    this.stateMachine.forceRecover()
    this.emptyOnLastCheck = false
  }

  stop(): void {
    if (this.checkTimer !== null) {
      clearInterval(this.checkTimer)
      this.checkTimer = null
    }
    this.emptyOnLastCheck = false
    this.fetchingActions = false
  }
}
