import {
  BattleMessageType,
  BattlePhase,
  BattleStatus,
  type BattleMessage,
  type PlayerSelection,
  type playerId,
  type Events,
} from '@arcadia-eternity/const'
import type { IBattleSystem, BattleRuntimeSnapshot } from '@arcadia-eternity/interface'
import type { Battle } from '../v4/battle'
import type { BattleSnapshot } from '../v4/snapshot'
import { ReconnectGrace, readReconnectWindows, type ReconnectWindow } from './reconnect-grace'
import { NativeTeamSelection, type NativeTeamSelectionOptions } from './team-selection'

export interface NativeBattleHostOptions {
  teamSelection?: NativeTeamSelectionOptions
}

/** The native counter points to the next message; the host protocol exposes the last covered message. */
function hostMessage(message: BattleMessage, view: NativeMessageView | undefined, battle: Battle): BattleMessage {
  let stateDelta = message.stateDelta
  if (stateDelta && typeof stateDelta === 'object' && !Array.isArray(stateDelta) && 'sequenceId' in stateDelta) {
    const sequence = stateDelta.sequenceId
    if (Array.isArray(sequence) && typeof sequence[0] === 'number') {
      if (sequence.length === 1) stateDelta = { ...stateDelta, sequenceId: [sequence[0] - 1] }
      else if (sequence.length === 2 && typeof sequence[1] === 'number')
        stateDelta = { ...stateDelta, sequenceId: [sequence[0] - 1, sequence[1] - 1] }
    }
  }
  if (
    message.type === BattleMessageType.TeamSelectionStart &&
    view?.viewerId &&
    !view.showAll &&
    !message.data.config.showOpponentTeam
  )
    return {
      ...message,
      stateDelta,
      data: {
        ...message.data,
        playerATeam: view.viewerId === battle.playerA.id ? message.data.playerATeam : null,
        playerBTeam: view.viewerId === battle.playerB.id ? message.data.playerBTeam : null,
      },
    }
  return { ...message, stateDelta }
}

export type NativeMessageView = NonNullable<Parameters<Battle['registerListener']>[1]>
type Subscription = { attach: (battle: Battle) => () => void; detach: () => void }
export interface NativeBattleContent {
  snapshot(battle: Battle): BattleSnapshot
  restore(data: unknown): Battle
}

/** Host protocol adapter; all game rules and phase execution remain on the native Battle. */
export class LocalBattleSystemV4 implements IBattleSystem {
  private readonly subscriptions = new Set<Subscription>()
  private readonly inputListeners = new Set<
    (input: { selection: PlayerSelection; turn: number; phase: BattlePhase }) => void
  >()
  onInputAccepted(
    callback: (input: { selection: PlayerSelection; turn: number; phase: BattlePhase }) => void,
  ): () => void {
    this.assertOpen()
    this.inputListeners.add(callback)
    return () => {
      this.inputListeners.delete(callback)
    }
  }
  private acceptInput(selection: PlayerSelection, turn: number, phase: BattlePhase): void {
    for (const listener of this.inputListeners) listener({ selection: structuredClone(selection), turn, phase })
  }
  private readonly expectedStops = new WeakSet<Battle>()
  private running?: Promise<void>
  private readiness?: Promise<void>
  private restoring?: Promise<void>
  private cleanupTask?: Promise<void>
  private started = false
  private closed = false
  private resume = false
  private failure?: Error
  private readonly reconnect: ReconnectGrace
  private readonly options: NativeBattleHostOptions
  private preparation?: NativeTeamSelection

  constructor(
    private battle: Battle,
    private readonly content: NativeBattleContent,
    options: NativeBattleHostOptions = {},
  ) {
    this.options = structuredClone(options)
    this.preparation = this.createPreparation(battle)
    this.reconnect = new ReconnectGrace(player => {
      if (!this.closed && !this.failure && this.battle.status !== BattleStatus.Ended) this.battle.abandonPlayer(player)
    })
    this.subscribe(battle => {
      const onEnd = (message: BattleMessage) => {
        if (message.type === BattleMessageType.BattleEnd) {
          this.reconnect.clear()
          this.preparation?.cancel()
        }
      }
      battle.registerListener(onEnd)
      return () => battle.unregisterListener(onEnd)
    })
  }

  private createPreparation(battle: Battle): NativeTeamSelection | undefined {
    return this.options.teamSelection?.enabled && battle.status === BattleStatus.Unstarted
      ? new NativeTeamSelection(battle, this.options.teamSelection.config)
      : undefined
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Native battle system is disposed')
    if (this.restoring) throw new Error('Native battle system is being restored')
    if (this.failure) throw this.failure
  }
  private subscribe(attach: Subscription['attach']): () => void {
    this.assertOpen()
    const subscription = { attach, detach: attach(this.battle) }
    this.subscriptions.add(subscription)
    return () => {
      if (!this.subscriptions.delete(subscription)) return
      subscription.detach()
    }
  }
  async ready(): Promise<void> {
    this.assertOpen()
    if (this.started) return this.readiness
    this.started = true
    const battle = this.battle
    this.running = this.runBattle(battle, this.resume, this.preparation).catch(error => {
      if (this.expectedStops.has(battle)) return
      this.failure = error instanceof Error ? error : new Error('Native battle failed')
      this.reconnect.clear()
    })
    this.resume = false
    this.reconnect.activate()
    this.readiness = this.waitForInputReady()
    await this.readiness.catch(error => {
      if (!this.failure) throw error
    })
  }
  private async runBattle(battle: Battle, resume: boolean, preparation?: NativeTeamSelection): Promise<void> {
    if (preparation) await preparation.run()
    if (this.closed || this.expectedStops.has(battle) || battle.status === BattleStatus.Ended) return
    await (resume ? battle.resumeBattle() : battle.startBattle())
  }
  private async waitForInputReady(): Promise<void> {
    if (this.preparation?.active) return
    await Promise.race([this.battle.waitForInputReady(), this.running])
  }
  /** Observe the current execution without making ready() block the host's action loop. */
  async waitForCompletion(): Promise<void> {
    this.assertOpen()
    const running = this.running
    if (!running) throw new Error('Native battle system has not started')
    await running
    if (this.running === running && this.failure) throw this.failure
  }
  async getState(viewerId?: playerId, showHidden?: boolean) {
    this.assertOpen()
    const state = this.battle.getState(viewerId, showHidden ?? (viewerId ? false : this.battle.showHidden))
    return structuredClone({ ...state, sequenceId: (state.sequenceId ?? 0) - 1 })
  }
  async getAvailableSelection(playerId: playerId) {
    this.assertOpen()
    if (this.preparation?.active) return this.preparation.available(playerId)
    return this.battle.getAvailableSelection(playerId)
  }
  /** Current settled input boundary, including restored waits without re-emitting prompts. */
  async waitForPendingDecision() {
    this.assertOpen()
    if (!this.preparation?.active) await this.waitForInputReady()
    this.assertOpen()
    const selections: PlayerSelection[][] = []
    for (const player of [this.battle.playerA, this.battle.playerB])
      selections.push(
        this.battle.status === BattleStatus.Ended
          ? []
          : this.preparation?.active
            ? this.preparation.available(player.id)
            : player.selection
              ? []
              : this.battle.getAvailableSelection(player.id),
      )
    return { turn: this.battle.currentTurn, phase: this.battle.currentPhase, selections }
  }
  async submitAction(selection: PlayerSelection): Promise<void> {
    this.assertOpen()
    // Copy the protocol's only collection explicitly; callers may supply reactive array views.
    selection =
      selection.type === 'team-selection'
        ? { ...selection, selectedPets: [...selection.selectedPets] }
        : { ...selection }
    if (this.preparation?.active) {
      const turn = this.battle.currentTurn,
        phase = this.battle.currentPhase
      this.preparation.submit(selection)
      this.acceptInput(selection, turn, phase)
      return
    }
    if (this.started) {
      await this.waitForInputReady()
      this.assertOpen()
    }
    if (this.battle.status === BattleStatus.Ended) throw new Error('Native battle has ended')
    const turn = this.battle.currentTurn,
      phase = this.battle.currentPhase
    if (!this.battle.setSelection(selection)) throw new Error('Invalid native battle selection')
    if (selection.type === 'surrender') this.battle.abandonPlayer(selection.player)
    this.acceptInput(selection, turn, phase)
  }
  BattleEvent(callback: (message: BattleMessage) => void, options?: NativeMessageView): () => void {
    // Each registration gets a distinct identity, even when the callback is reused across views.
    return this.subscribe(battle => {
      const forward = (message: BattleMessage) => callback(structuredClone(hostMessage(message, options, battle)))
      battle.registerListener(forward, { showHidden: battle.showHidden, ...options })
      return () => battle.unregisterListener(forward)
    })
  }
  async isTimerEnabled() {
    this.assertOpen()
    return this.battle.isTimerEnabled()
  }
  async getPlayerTimerState(playerId: playerId) {
    this.assertOpen()
    return this.battle.getPlayerTimerState(playerId)
  }
  async getAllPlayerTimerStates() {
    this.assertOpen()
    return this.battle.getAllPlayerTimerStates()
  }
  async getTimerConfig() {
    this.assertOpen()
    return this.battle.getTimerConfig()
  }
  async startAnimation(source: string, expectedDuration: number, ownerId: playerId) {
    this.assertOpen()
    return this.battle.startAnimation(source, expectedDuration, ownerId)
  }
  async endAnimation(animationId: string, actualDuration?: number): Promise<void> {
    this.assertOpen()
    this.battle.endAnimation(animationId, actualDuration)
  }
  async startReconnectGraceTimer(player: playerId, seconds: number): Promise<void> {
    this.assertOpen()
    if (![this.battle.playerA.id, this.battle.playerB.id].includes(player)) throw new Error('Unknown reconnect player')
    if (this.battle.status === BattleStatus.Ended) return
    this.reconnect.start(player, seconds)
  }
  async cancelReconnectGraceTimer(player: playerId): Promise<void> {
    this.assertOpen()
    if (![this.battle.playerA.id, this.battle.playerB.id].includes(player)) throw new Error('Unknown reconnect player')
    this.reconnect.cancel(player)
  }

  private readonly timerSubscriptions = new Map<() => void, { type: keyof Events; handler: unknown }>()
  onTimerEvent<K extends keyof Events>(type: K, handler: (data: Events[K]) => void): () => void {
    const detach = this.subscribe(battle => battle.onTimerEvent(type, handler))
    const unsubscribe = () => {
      this.timerSubscriptions.delete(unsubscribe)
      detach()
    }
    this.timerSubscriptions.set(unsubscribe, { type, handler })
    return unsubscribe
  }
  offTimerEvent<K extends keyof Events>(type: K, handler: (data: Events[K]) => void): void {
    for (const [unsubscribe, subscription] of this.timerSubscriptions)
      if (subscription.type === type && subscription.handler === handler) unsubscribe()
  }
  async createRuntimeSnapshot(): Promise<BattleRuntimeSnapshot> {
    this.assertOpen()
    const teamSelection = this.preparation?.pending ? this.preparation.snapshot() : null
    return {
      format: 'arcadia.battle.native.v4',
      version: 3,
      payload: JSON.stringify({
        battle: this.content.snapshot(this.battle),
        reconnect: this.reconnect.snapshot(),
        teamSelection,
      }),
    }
  }
  async restoreRuntimeSnapshot(snapshot: BattleRuntimeSnapshot): Promise<void> {
    this.assertOpen()
    if (snapshot.format !== 'arcadia.battle.native.v4' || snapshot.version !== 3)
      return Promise.reject(new Error('Unsupported native runtime snapshot'))
    const task = this.replaceBattle(snapshot)
    this.restoring = task
    await task.finally(() => {
      if (this.restoring === task) this.restoring = undefined
    })
  }
  private async replaceBattle(snapshot: BattleRuntimeSnapshot): Promise<void> {
    // Validate and hydrate before changing the live battle or its subscriptions.
    const payload = JSON.parse(snapshot.payload)
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      Object.keys(payload).length !== 3 ||
      !Object.hasOwn(payload, 'battle') ||
      !Object.hasOwn(payload, 'reconnect') ||
      !Object.hasOwn(payload, 'teamSelection')
    )
      throw new Error('Invalid native runtime payload')
    const restored = this.content.restore(payload.battle)
    const previous = this.battle
    try {
      if (payload.teamSelection === null && restored.currentPhase === BattlePhase.TeamSelectionPhase)
        throw new Error('Team selection runtime snapshot requires saved host choices')
      const preparation =
        payload.teamSelection === null ? undefined : NativeTeamSelection.restore(restored, payload.teamSelection)
      const windows: ReconnectWindow[] = readReconnectWindows(payload.reconnect, [
        restored.playerA.id,
        restored.playerB.id,
      ])
      this.reconnect.suspend()
      this.expectedStops.add(previous)
      this.preparation?.cancel()
      await previous.cleanup()
      await this.running
      if (this.closed) throw new Error('Native battle system is disposed')
      for (const subscription of this.subscriptions) subscription.detach()
      this.battle = restored
      this.preparation = preparation
      this.reconnect.restore(windows)
      this.running = undefined
      this.readiness = undefined
      this.failure = undefined
      this.started = false
      this.resume = restored.status === BattleStatus.OnBattle
      for (const subscription of this.subscriptions) subscription.detach = subscription.attach(restored)
    } catch (error) {
      await restored.cleanup()
      throw error
    }
  }
  cleanup(): Promise<void> {
    if (this.cleanupTask) return this.cleanupTask
    this.closed = true
    this.cleanupTask = this.dispose()
    return this.cleanupTask
  }
  private async dispose(): Promise<void> {
    this.reconnect.clear()
    await this.restoring?.catch(() => undefined)
    this.preparation?.cancel()
    for (const subscription of this.subscriptions) subscription.detach()
    this.subscriptions.clear()
    this.timerSubscriptions.clear()
    this.inputListeners.clear()
    this.expectedStops.add(this.battle)
    await this.battle.cleanup()
    await this.running
  }
}
