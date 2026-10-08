import { Category, type BattleMessageType } from '@arcadia-eternity/const'
import type { Delta } from 'jsondiffpatch'
import { waitForAnimationOperation } from './animationTask'
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

export interface AnimationTask {
  readonly id: number
  readonly signal: AbortSignal
}

export class AnimationController {
  readonly stateMachine: AnimationStateMachine
  readonly timeoutManager: AnimationTimeoutManager
  readonly gsapManager: AnimationGsapManager
  readonly healthMonitor: AnimationHealthMonitor

  private onReconnectListeners = new Set<(event: ReconnectEvent) => void>()
  private store: BattleStoreLike
  private disposed = false
  private readonly shutdown = new AbortController()
  private taskCounter = 0
  private activeTask: (AnimationTask & { abort: AbortController }) | null = null
  private connectionGeneration = 0
  private reconnectAbort: AbortController | undefined
  private disconnectListener: (() => void) | undefined

  constructor(store: BattleStoreLike) {
    this.store = store
    this.stateMachine = new AnimationStateMachine()
    this.timeoutManager = new AnimationTimeoutManager()
    this.gsapManager = new AnimationGsapManager()
    this.healthMonitor = new AnimationHealthMonitor(this.stateMachine, store, this.gsapManager)
    this.gsapManager.attach(this.stateMachine)
    this.disconnectListener = this.stateMachine.onStateChange((_from, to) => {
      if (
        [AnimationState.PAUSED, AnimationState.RECOVERING, AnimationState.CATCHING_UP, AnimationState.STUCK].includes(
          to,
        )
      ) {
        this.cancelTask()
      }
    })
  }

  start(): void {
    if (!this.disposed) this.healthMonitor.start()
  }

  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    this.shutdown.abort()
    this.connectionGeneration++
    this.reconnectAbort?.abort()
    this.cancelTask()
    this.disconnectListener?.()
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
  }): AnimationTask | null {
    if (this.disposed || this.activeTask || !this.stateMachine.canAcceptNewTask) return null
    const abort = new AbortController()
    this.activeTask = { id: ++this.taskCounter, signal: abort.signal, abort }
    this.stateMachine.beginTask(opts)
    this.stateMachine.transition(AnimationState.PREPARING, `task-${opts.messageType}`)
    return this.activeTask
  }

  isTaskCurrent(task?: AnimationTask | null): boolean {
    return !this.disposed && !!task && this.activeTask === task && !task.signal.aborted
  }

  /** Connection suspension retains queued tasks; destroy releases their subscriptions. */
  waitUntilReady(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false)
    if (this.stateMachine.canAcceptNewTask) return Promise.resolve(true)
    return new Promise(resolve => {
      const finish = (ready: boolean) => {
        unsubscribe()
        this.shutdown.signal.removeEventListener('abort', onShutdown)
        resolve(ready)
      }
      const onShutdown = () => finish(false)
      const unsubscribe = this.stateMachine.onStateChange((_from, to) => {
        if (to === AnimationState.IDLE) finish(true)
      })
      this.shutdown.signal.addEventListener('abort', onShutdown, { once: true })
    })
  }

  private cancelTask(): void {
    const task = this.activeTask
    this.activeTask = null
    task?.abort.abort()
    this.timeoutManager.cancel()
  }

  onAnimationPlaying(task?: AnimationTask | null): void {
    if (this.isTaskCurrent(task)) this.stateMachine.transition(AnimationState.PLAYING, 'animation-started')
  }

  onAnimationComplete(task?: AnimationTask | null): void {
    if (this.isTaskCurrent(task) && this.stateMachine.isAnimating)
      this.stateMachine.transition(AnimationState.COMPLETING, 'animation-finished')
  }

  onAnimationCleanupDone(task?: AnimationTask | null): void {
    if (this.isTaskCurrent(task) && this.stateMachine.state === AnimationState.COMPLETING) {
      this.activeTask = null
      this.stateMachine.transition(AnimationState.IDLE, 'cleanup-complete')
    }
  }

  async waitForHit(source: PetSpriteRef | null, category: Category): Promise<TimeoutResult> {
    const config = this.buildTimeoutConfig(category, false)
    if (this.disposed || this.stateMachine.isRecovering) return 'cancelled'
    return this.timeoutManager.waitForCondition(source, this.stateMachine, {
      ...config,
      baseTimeout: Math.min(config.baseTimeout / 3, 3000),
    })
  }

  async waitForAnimationComplete(source: PetSpriteRef | null, category: Category): Promise<TimeoutResult> {
    if (this.disposed || this.stateMachine.isRecovering) return 'cancelled'
    const hasTransform = this.stateMachine.snapshot().hasTransform
    const config = this.buildTimeoutConfig(category, hasTransform)
    return this.timeoutManager.waitForCondition(source, this.stateMachine, config)
  }

  onDisconnect(): void {
    if (this.disposed) return
    this.connectionGeneration++
    this.reconnectAbort?.abort()
    this.stateMachine.onDisconnect()
    this.gsapManager.killAll()
    this.timeoutManager.cancel()
  }

  async onReconnect(store: BattleStoreLike): Promise<boolean> {
    if (this.disposed) return false
    this.reconnectAbort?.abort()
    const abort = new AbortController()
    this.reconnectAbort = abort
    const generation = ++this.connectionGeneration
    const current = () => !this.disposed && generation === this.connectionGeneration
    const snapshotSeq = store.lastProcessedSequenceId
    this.stateMachine.onReconnect()
    // Keep the channel captured by the page alive. Snapshot sequence fences
    // buffered tasks instead of replacing the Subject beneath its consumers.
    try {
      if (store.battleInterface) {
        const latestState = await waitForAnimationOperation(
          store.battleInterface.getState(store.playerId, false),
          abort.signal,
          10000,
        )
        if (!current()) return false
        const actions =
          latestState.status === 'Ended'
            ? []
            : await waitForAnimationOperation(store.fetchAvailableSelection(current), abort.signal, 10000)
        if (!current()) return false
        store.battleState = latestState
        if (latestState.status === 'Ended') store.isBattleEnd = true
        store.lastProcessedSequenceId = latestState.sequenceId ?? snapshotSeq
        store.availableActions = actions
        store.waitingForResponse = false
      }
    } catch (err) {
      if (!current()) return false
      this.stateMachine.markStuck('reconnect-state-fetch-failed')
      console.warn('[AnimationController] reconnect state fetch failed:', err)
      return false
    }
    if (!current()) return false
    const event = {
      lastSequenceId: snapshotSeq,
      latestSequenceId: store.lastProcessedSequenceId,
      backlog: Math.max(0, store.lastProcessedSequenceId - snapshotSeq),
    }
    for (const listener of this.onReconnectListeners) {
      try {
        listener(event)
      } catch (err) {
        console.error('[AnimationController] reconnect listener error:', err)
      }
      if (!current()) return false
    }
    // The authoritative snapshot already contains the backlog. Old queued
    // messages are ignored by sequence; no unbounded catch-up state is needed.
    this.stateMachine.onRecoveryComplete()
    return true
  }

  /** Register for reconnection events. The animation queue retains its identity across reconnects. Returns unsubscribe function. */
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
