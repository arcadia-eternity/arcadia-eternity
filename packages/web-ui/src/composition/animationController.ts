import { Category, type BattleMessageType } from '@arcadia-eternity/const'
import type { Delta } from 'jsondiffpatch'
import { Subject } from 'rxjs'
import { AnimationStateMachine, AnimationState } from './animationStateMachine'
import { AnimationTimeoutManager, type TimeoutConfig, type PetSpriteRef, type TimeoutResult } from './animationTimeout'
import { AnimationGsapManager } from './animationGsapManager'
import { AnimationHealthMonitor } from './animationHealthMonitor'
import type { BattleStoreLike } from './animationTypes'

export type ReconnectEvent = {
  lastSequenceId: number
  latestSequenceId: number
  backlog: number
}

export class AnimationController {
  readonly stateMachine: AnimationStateMachine
  readonly timeoutManager: AnimationTimeoutManager
  readonly gsapManager: AnimationGsapManager
  readonly healthMonitor: AnimationHealthMonitor

  private onReconnectListeners = new Set<(event: ReconnectEvent) => void>()
  private store: BattleStoreLike

  constructor(store: BattleStoreLike) {
    this.store = store
    this.stateMachine = new AnimationStateMachine()
    this.timeoutManager = new AnimationTimeoutManager()
    this.gsapManager = new AnimationGsapManager()
    this.healthMonitor = new AnimationHealthMonitor(this.stateMachine, store, this.gsapManager)
    this.gsapManager.attach(this.stateMachine)
  }

  start(): void {
    this.healthMonitor.start()
  }

  destroy(): void {
    this.healthMonitor.stop()
    this.timeoutManager.cancel()
    this.gsapManager.killAll()
    this.stateMachine.destroy()
    this.onReconnectListeners.clear()
  }

  beginAnimation(opts: {
    messageType: BattleMessageType
    side: 'left' | 'right'
    skillId?: string
    petId?: string
    sequenceId: number
    expectedDuration: number
  }): void {
    this.stateMachine.beginTask(opts)
    this.stateMachine.transition(AnimationState.PREPARING, `task-${opts.messageType}`)
  }

  onAnimationPlaying(): void {
    this.stateMachine.transition(AnimationState.PLAYING, 'animation-started')
  }

  onAnimationComplete(): void {
    this.stateMachine.transition(AnimationState.COMPLETING, 'animation-finished')
  }

  onAnimationCleanupDone(): void {
    if (this.stateMachine.state === AnimationState.COMPLETING) {
      this.stateMachine.transition(AnimationState.IDLE, 'cleanup-complete')
    }
  }

  async waitForHit(source: PetSpriteRef | null, category: Category): Promise<TimeoutResult> {
    const config = this.buildTimeoutConfig(category, false)
    this.stateMachine.transition(AnimationState.PLAYING, 'waiting-for-hit')
    return this.timeoutManager.waitForCondition(source, this.stateMachine, {
      ...config,
      baseTimeout: Math.min(config.baseTimeout / 3, 3000),
    })
  }

  async waitForAnimationComplete(source: PetSpriteRef | null, category: Category): Promise<TimeoutResult> {
    const hasTransform = this.stateMachine.snapshot().hasTransform
    const config = this.buildTimeoutConfig(category, hasTransform)
    return this.timeoutManager.waitForCondition(source, this.stateMachine, config)
  }

  onDisconnect(): void {
    this.stateMachine.onDisconnect()
    this.gsapManager.killAll()
    this.timeoutManager.cancel()
  }

  async onReconnect(store: BattleStoreLike): Promise<void> {
    this.stateMachine.onReconnect()

    store.animateQueue.complete()
    ;(store as unknown as Record<string, unknown>).animateQueue = new Subject()

    let latestSequenceId = store.lastProcessedSequenceId
    try {
      if (store.battleInterface) {
        const latestState = await store.battleInterface.getState(store.playerId, false)
        if (latestState && 'status' in latestState) {
          const s = store as unknown as Record<string, unknown>
          s.battleState = latestState
          s.lastProcessedSequenceId = latestState.sequenceId ?? store.lastProcessedSequenceId
          latestSequenceId = s.lastProcessedSequenceId as number
        }
      }
    } catch (err) {
      console.warn('[AnimationController] reconnect state fetch failed:', err)
    }

    const snapshotSeq = this.stateMachine.snapshot().sequenceId
    const backlog = latestSequenceId - snapshotSeq

    const event: ReconnectEvent = {
      lastSequenceId: snapshotSeq,
      latestSequenceId,
      backlog,
    }

    for (const listener of this.onReconnectListeners) {
      try {
        listener(event)
      } catch (err) {
        console.error('[AnimationController] reconnect listener error:', err)
      }
    }

    if (backlog > 5) {
      this.stateMachine.onBacklog(backlog)
    } else {
      this.stateMachine.onRecoveryComplete()
    }
  }

  /** Register for reconnection events. Caller must rewire RxJS subscriptions (animateQueue) in the handler. Returns unsubscribe function. */
  registerReconnectListener(listener: (event: ReconnectEvent) => void): () => void {
    this.onReconnectListeners.add(listener)
    return () => {
      this.onReconnectListeners.delete(listener)
    }
  }

  markBacklogCleared(): void {
    this.stateMachine.onCatchupComplete()
  }

  checkDeltaForTransform(delta: Delta, activePetId: string): boolean {
    if (!delta || typeof delta !== 'object') return false

    const players = (delta as Record<string, unknown>).players
    if (!players || typeof players !== 'object') return false

    if (Array.isArray(players)) {
      return false
    }

    const playerEntries = Object.entries(players as Record<string, unknown>)
    for (const [, playerData] of playerEntries) {
      if (!playerData || typeof playerData !== 'object') continue
      const team = (playerData as Record<string, unknown>).team
      if (!team || typeof team !== 'object') continue

      const teamEntries = Object.entries(team as Record<string, unknown>)
      for (const [, petData] of teamEntries) {
        if (!petData || typeof petData !== 'object') continue
        const petId = (petData as Record<string, unknown>).id
        const speciesID = (petData as Record<string, unknown>).speciesID

        if (Array.isArray(speciesID) && speciesID.length === 2 && speciesID[0] !== speciesID[1]) {
          if (typeof petId === 'string' && petId === activePetId) {
            this.stateMachine.markTransform(activePetId)
            return true
          }
        }

        if (typeof speciesID === 'string' && typeof petId === 'string' && petId === activePetId) {
          const petInState = this.findPetInState(petId)
          if (petInState && petInState !== speciesID) {
            this.stateMachine.markTransform(activePetId)
            return true
          }
        }
      }
    }

    return false
  }

  private findPetInState(petId: string): string | null {
    const players = (this.store.battleState as Record<string, unknown>)?.players
    if (!players || !Array.isArray(players)) return null
    for (const player of players) {
      const team = (player as Record<string, unknown>)?.team
      if (!team || !Array.isArray(team)) continue
      for (const pet of team) {
        const p = pet as Record<string, unknown>
        if (p.id === petId) return (p.speciesID as string) ?? null
      }
    }
    return null
  }

  private buildTimeoutConfig(category: Category, hasTransform: boolean): TimeoutConfig {
    return AnimationTimeoutManager.configForCategory(category, hasTransform)
  }
}
