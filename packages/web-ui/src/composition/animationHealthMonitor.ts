import { AnimationState, type AnimationStateMachine } from './animationStateMachine'
import type { AnimationGsapManager } from './animationGsapManager'
import type { BattleStoreLike } from './animationTypes'

const CHECK_INTERVAL_MS = 3000
const MAX_STUCK_COUNT = 3
const ANIMATION_TIMEOUT_RATIO = 3

export class AnimationHealthMonitor {
  private checkTimer: ReturnType<typeof setInterval> | null = null
  private stuckCount = 0

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
    if (this.store.isReplayMode) return
    if (this.store.isBattleEnd) return
    if (this.store.battleState?.status === 'Ended') return
    if (
      this.store.battleState?.currentPhase !== 'SELECTION_PHASE' &&
      this.store.battleState?.currentPhase !== 'SWITCH_PHASE'
    )
      return
    if (this.store.availableActions.length > 0) {
      this.stuckCount = 0
      return
    }
    if (this.store.waitingForResponse) return

    this.stuckCount++
    const elapsed = this.stuckCount * (CHECK_INTERVAL_MS / 1000)

    if (this.stuckCount >= 2) {
      console.warn(`[AnimationHealthMonitor] availableActions empty for ${elapsed}s → attempting recovery`)
      try {
        const actions = await this.store.fetchAvailableSelection()
        if (Array.isArray(actions)) {
          this.store.availableActions = actions
        }
        if (actions.length > 0) {
          this.stuckCount = 0
          this.stateMachine.transition(AnimationState.IDLE, 'health-check-recovered-actions')
          return
        }
      } catch {
        console.warn('[AnimationHealthMonitor] recovery fetch failed')
      }
    }

    if (this.stuckCount >= MAX_STUCK_COUNT) {
      console.error(`[AnimationHealthMonitor] availableActions stuck empty for ${elapsed}s → marking STUCK`)
      this.stateMachine.markStuck('no-available-actions')
    }
  }

  forceRecovery(): void {
    this.gsapManager.killAll()
    this.stateMachine.forceRecover()
    this.stuckCount = 0
  }

  stop(): void {
    if (this.checkTimer !== null) {
      clearInterval(this.checkTimer)
      this.checkTimer = null
    }
    this.stuckCount = 0
  }
}
