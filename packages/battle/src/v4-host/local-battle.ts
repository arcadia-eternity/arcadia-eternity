import {
  BattleMessageType,
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

export type NativeMessageView = NonNullable<Parameters<Battle['registerListener']>[1]>
type Subscription = { attach: (battle: Battle) => () => void; detach: () => void }
export interface NativeBattleContent {
  snapshot(battle: Battle): BattleSnapshot
  restore(data: unknown): Battle
}

/** Host protocol adapter; all game rules and phase execution remain on the native Battle. */
export class LocalBattleSystemV4 implements IBattleSystem {
  private readonly subscriptions = new Set<Subscription>()
  private readonly expectedStops = new WeakSet<Battle>()
  private running?: Promise<void>
  private restoring?: Promise<void>
  private cleanupTask?: Promise<void>
  private started = false
  private closed = false
  private resume = false
  private failure?: Error
  private readonly reconnect: ReconnectGrace

  constructor(
    private battle: Battle,
    private readonly content: NativeBattleContent,
  ) {
    this.reconnect = new ReconnectGrace(player => {
      if (!this.closed && !this.failure && this.battle.status !== BattleStatus.Ended) this.battle.abandonPlayer(player)
    })
    this.subscribe(battle => {
      const onEnd = (message: BattleMessage) => {
        if (message.type === BattleMessageType.BattleEnd) this.reconnect.clear()
      }
      battle.registerListener(onEnd)
      return () => battle.unregisterListener(onEnd)
    })
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
    if (this.started) return
    this.started = true
    const battle = this.battle
    this.running = (this.resume ? battle.resumeBattle() : battle.startBattle()).catch(error => {
      if (this.expectedStops.has(battle)) return
      this.failure = error instanceof Error ? error : new Error('Native battle failed')
      this.reconnect.clear()
    })
    this.resume = false
    this.reconnect.activate()
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
    return this.battle.getState(viewerId, showHidden ?? (viewerId ? false : this.battle.showHidden))
  }
  async getAvailableSelection(playerId: playerId) {
    this.assertOpen()
    return this.battle.getAvailableSelection(playerId)
  }
  async submitAction(selection: PlayerSelection): Promise<void> {
    this.assertOpen()
    if (!this.battle.setSelection(selection)) throw new Error('Invalid native battle selection')
  }
  BattleEvent(callback: (message: BattleMessage) => void, options?: NativeMessageView): () => void {
    // Each registration gets a distinct identity, even when the callback is reused across views.
    return this.subscribe(battle => {
      const forward = (message: BattleMessage) => callback(message)
      battle.registerListener(forward, options)
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
    return {
      format: 'arcadia.battle.native.v4',
      version: 2,
      payload: JSON.stringify({ battle: this.content.snapshot(this.battle), reconnect: this.reconnect.snapshot() }),
    }
  }
  async restoreRuntimeSnapshot(snapshot: BattleRuntimeSnapshot): Promise<void> {
    this.assertOpen()
    if (snapshot.format !== 'arcadia.battle.native.v4' || ![1, 2].includes(snapshot.version))
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
      snapshot.version === 2 &&
      (!payload ||
        typeof payload !== 'object' ||
        Array.isArray(payload) ||
        Object.keys(payload).length !== 2 ||
        !Object.hasOwn(payload, 'battle') ||
        !Object.hasOwn(payload, 'reconnect'))
    )
      throw new Error('Invalid native runtime payload')
    const restored = this.content.restore(snapshot.version === 1 ? payload : payload.battle)
    const previous = this.battle
    try {
      const windows: ReconnectWindow[] =
        snapshot.version === 1
          ? []
          : readReconnectWindows(payload.reconnect, [restored.playerA.id, restored.playerB.id])
      this.reconnect.suspend()
      this.expectedStops.add(previous)
      await previous.cleanup()
      await this.running
      if (this.closed) throw new Error('Native battle system is disposed')
      for (const subscription of this.subscriptions) subscription.detach()
      this.battle = restored
      this.reconnect.restore(windows)
      this.running = undefined
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
    for (const subscription of this.subscriptions) subscription.detach()
    this.subscriptions.clear()
    this.timerSubscriptions.clear()
    this.expectedStops.add(this.battle)
    await this.battle.cleanup()
    await this.running
  }
}
