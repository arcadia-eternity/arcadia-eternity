import { wrap, proxy, releaseProxy, type Endpoint, type Remote } from 'comlink'
import type { IBattleSystem } from '@arcadia-eternity/interface'
import type { BattleMessage, Events } from '@arcadia-eternity/const'
import type { LocalBattleSystemV4, NativeMessageView } from '../v4-host/local-battle'
import type { BattleMethod, SandboxBattleInput, SandboxEvent, SandboxWorkerRemote } from './runtime'
import { SandboxFault, sandboxPolicy } from './contracts'

export interface BattleWorker {
  readonly endpoint: Endpoint
  terminate(): void | Promise<unknown>
  onFailure(handler: (message: string) => void): () => void
  setIdle?(idle: boolean): void
}
export interface BattleWorkerPolicy {
  readonly maxBattles: number
  readonly initializeMs: number
  readonly requestMs: number
  readonly cleanupMs: number
  readonly heartbeatMs: number
  readonly reuseWorkers: boolean
  readonly vmGrouping: 'package' | 'environment'
}
const defaultPolicy: BattleWorkerPolicy = Object.freeze({
  maxBattles: 4,
  initializeMs: 20_000,
  requestMs: 5_000,
  cleanupMs: 1_000,
  heartbeatMs: 1_000,
  reuseWorkers: false,
  vmGrouping: 'package',
})
export interface BattleWorkerStatus {
  readonly id: number
  readonly workerId?: number
  readonly state: 'preparing' | 'active' | 'faulted' | 'disposed'
  readonly fault?: string
  readonly cleanup?: 'graceful' | 'terminated'
  readonly cleanupFault?: string
}
interface WorkerSlot {
  readonly id: number
  readonly worker: BattleWorker
  readonly remote: Remote<SandboxWorkerRemote>
  readonly environment: string
  detachIdleFailure?: () => void
  termination?: Promise<unknown>
}
/** Bounded worker ownership. Each lease is isolated; only healthy sequential sessions reuse content. */
export class BattleWorkerManager {
  private nextId = 0
  private nextWorkerId = 0
  private creating = 0
  private readonly slots = new Set<WorkerSlot>()
  private readonly idle: WorkerSlot[] = []
  private readonly active = new Map<number, WorkerBattleSystem>()
  private readonly history: BattleWorkerStatus[] = []
  private closed = false
  private disposing?: Promise<void>
  private readonly policy: BattleWorkerPolicy
  constructor(
    private readonly createWorker: () => BattleWorker,
    policy: Partial<BattleWorkerPolicy> = {},
  ) {
    this.policy = { ...defaultPolicy, ...policy }
    const { reuseWorkers, vmGrouping, ...limits } = this.policy
    for (const value of Object.values(limits))
      if (!Number.isSafeInteger(value) || value <= 0) throw Error('Invalid Worker policy')
    if (typeof reuseWorkers !== 'boolean' || !['package', 'environment'].includes(vmGrouping))
      throw Error('Invalid Worker policy')
  }
  private terminate(slot: WorkerSlot): Promise<unknown> {
    if (slot.termination) return slot.termination
    slot.detachIdleFailure?.()
    const index = this.idle.indexOf(slot)
    if (index >= 0) this.idle.splice(index, 1)
    slot.termination = Promise.resolve()
      .then(async () => {
        try {
          slot.remote[releaseProxy]()
        } catch {
          /* Endpoint may already be closed. */
        }
        await slot.worker.terminate()
      })
      .finally(() => this.slots.delete(slot))
    return slot.termination
  }
  async create(input: SandboxBattleInput, signal?: AbortSignal): Promise<WorkerBattleSystem> {
    if (this.closed) throw Error('Battle Worker manager disposed')
    if (signal?.aborted) throw new SandboxFault('disposed', 'battle', 'Battle launch cancelled')
    if (this.active.size + this.creating >= this.policy.maxBattles)
      throw new SandboxFault('budget', 'battle', 'Concurrent battle limit')
    const serialized = JSON.stringify(input)
    if (new TextEncoder().encode(serialized).byteLength > 16 * 1024 * 1024)
      throw new SandboxFault('budget', 'battle', 'Battle input limit')
    // Capture before yielding: revisions alone cannot authenticate changed data or code.
    const captured: SandboxBattleInput = JSON.parse(serialized)
    const environment = JSON.stringify(captured.environment)
    this.creating++
    let slot: WorkerSlot | undefined
    let battle: WorkerBattleSystem | undefined
    try {
      const match = this.policy.reuseWorkers ? this.idle.findIndex(value => value.environment === environment) : -1
      if (match >= 0) {
        slot = this.idle.splice(match, 1)[0]
        slot.detachIdleFailure?.()
        slot.detachIdleFailure = undefined
      } else {
        // Reclaim another environment's idle slot before allocating beyond the bound.
        if (this.slots.size >= this.policy.maxBattles && this.idle.length) await this.terminate(this.idle[0])
        if (this.slots.size >= this.policy.maxBattles)
          throw new SandboxFault('budget', 'battle', 'Concurrent worker limit')
        if (this.closed || signal?.aborted) throw new SandboxFault('disposed', 'battle', 'Battle launch cancelled')
        const worker = this.createWorker()
        slot = { id: ++this.nextWorkerId, worker, remote: wrap<SandboxWorkerRemote>(worker.endpoint), environment }
        this.slots.add(slot)
      }
      if (this.closed || signal?.aborted) throw new SandboxFault('disposed', 'battle', 'Battle launch cancelled')
      const owned = slot
      owned.worker.setIdle?.(false)
      const id = ++this.nextId
      battle = new WorkerBattleSystem(
        id,
        owned.worker,
        this.policy,
        status => {
          this.active.delete(id)
          this.history.push(status)
          if (this.history.length > 64) this.history.shift()
        },
        owned.remote,
        async reusable => {
          if (reusable && this.policy.reuseWorkers && !this.closed && !owned.termination) {
            owned.detachIdleFailure = owned.worker.onFailure(() => {
              void this.terminate(owned).catch(() => {})
            })
            this.idle.push(owned)
            owned.worker.setIdle?.(true)
          } else await this.terminate(owned)
        },
        owned.id,
      )
      this.active.set(id, battle)
      this.creating--
      const cancel = () => {
        void battle!.cancel()
      }
      signal?.addEventListener('abort', cancel, { once: true })
      battle.onClosed(() => signal?.removeEventListener('abort', cancel))
      if (signal?.aborted) cancel()
      await battle.initialize(captured)
      return battle
    } catch (error) {
      if (battle) await battle.cleanup()
      else {
        this.creating--
        if (slot) await this.terminate(slot)
      }
      throw error
    }
  }
  status(): readonly BattleWorkerStatus[] {
    return [...this.history.map(value => ({ ...value })), ...[...this.active.values()].map(battle => battle.status())]
  }
  dispose(): Promise<void> {
    this.closed = true
    return (this.disposing ??= (async () => {
      try {
        await Promise.all([...this.active.values()].map(battle => battle.cleanup()))
      } finally {
        await Promise.all([...this.slots].map(slot => this.terminate(slot)))
      }
    })())
  }
}

export class WorkerBattleSystem implements IBattleSystem {
  private readonly remote: Remote<SandboxWorkerRemote>
  private state: BattleWorkerStatus['state'] = 'preparing'
  private failure?: Error
  private readonly listeners = new Map<number, (message: BattleMessage) => void>()
  private readonly timers = new Map<keyof Events, Set<(value: Events[keyof Events]) => void>>()
  private readonly inputListeners = new Set<Parameters<LocalBattleSystemV4['onInputAccepted']>[0]>()
  private nextSubscription = 0
  private heartbeat?: ReturnType<typeof setInterval>
  private checking = false
  private cleanupTask?: Promise<void>
  private readonly closedListeners: (() => void)[] = []
  private readonly pending = new Set<(error: Error) => void>()
  private readonly detachFailure: () => void
  private terminalReported = false
  private termination?: Promise<unknown>
  private cleanupState?: BattleWorkerStatus['cleanup']
  private cleanupFault?: string
  constructor(
    readonly id: number,
    private readonly worker: BattleWorker,
    private readonly policy: BattleWorkerPolicy,
    private readonly report: (status: BattleWorkerStatus) => void,
    remote?: Remote<SandboxWorkerRemote>,
    private readonly releaseWorker?: (reusable: boolean) => Promise<void>,
    private readonly workerId?: number,
  ) {
    this.remote = remote ?? wrap<SandboxWorkerRemote>(worker.endpoint)
    this.detachFailure = worker.onFailure(message => this.fail(new SandboxFault('worker', 'battle', message)))
  }
  status(): BattleWorkerStatus {
    return {
      id: this.id,
      workerId: this.workerId,
      state: this.state,
      fault: this.failure?.message,
      cleanup: this.cleanupState,
      cleanupFault: this.cleanupFault,
    }
  }
  onClosed(callback: () => void) {
    this.closedListeners.push(callback)
  }
  private assertOpen() {
    if (this.failure) throw this.failure
    if (this.state === 'disposed') throw new SandboxFault('disposed', 'battle', 'Battle Worker disposed')
  }
  private async request<T>(operation: () => Promise<T>, timeout = this.policy.requestMs): Promise<T> {
    this.assertOpen()
    let timer: ReturnType<typeof setTimeout> | undefined
    let rejectPending: ((error: Error) => void) | undefined
    const terminal = new Promise<never>((_, reject) => {
      rejectPending = reject
      this.pending.add(reject)
      if (timeout)
        timer = setTimeout(
          () => this.fail(new SandboxFault('worker', 'battle', 'Battle Worker deadline exceeded')),
          timeout,
        )
    })
    try {
      return await Promise.race([operation(), terminal])
    } catch (error) {
      if (error instanceof Error && ['SandboxFault', 'ExecutionBudgetExceeded'].includes(error.name)) this.fail(error)
      throw error
    } finally {
      clearTimeout(timer)
      if (rejectPending) this.pending.delete(rejectPending)
    }
  }
  async initialize(input: SandboxBattleInput): Promise<void> {
    await this.request(
      () =>
        this.remote.initialize(
          input,
          proxy(async (event: SandboxEvent) => {
            if (this.state === 'disposed' || this.failure) return
            if (!event || new TextEncoder().encode(JSON.stringify(event)).byteLength > sandboxPolicy.outputBytes) {
              this.fail(new SandboxFault('budget', 'battle', 'Invalid battle event'))
              return
            }
            if (event.kind === 'battle') this.listeners.get(event.subscription)?.(event.message)
            else if (event.kind === 'timer')
              for (const listener of this.timers.get(event.type) ?? []) listener(event.data)
            else if (event.kind === 'input') for (const listener of this.inputListeners) listener(event.data)
            else this.fail(new SandboxFault('permission', 'battle', 'Unknown battle event'))
          }),
          { sessionId: this.id, reuseContent: this.policy.reuseWorkers, grouping: this.policy.vmGrouping },
        ),
      this.policy.initializeMs,
    )
    this.assertOpen()
    this.state = 'active'
    this.heartbeat = setInterval(() => {
      if (this.checking || this.state !== 'active') return
      this.checking = true
      void this.request(() => this.remote.health(this.id))
        .catch(error => this.fail(error instanceof Error ? error : Error(String(error))))
        .finally(() => {
          this.checking = false
        })
    }, this.policy.heartbeatMs)
  }
  private call<K extends BattleMethod>(
    method: K,
    args: Parameters<LocalBattleSystemV4[K]>,
  ): Promise<Awaited<ReturnType<LocalBattleSystemV4[K]>>> {
    return this.request(
      () => this.remote.invoke(method, args, this.id),
      method === 'waitForCompletion' ? 0 : this.policy.requestMs,
    ) as Promise<Awaited<ReturnType<LocalBattleSystemV4[K]>>>
  }
  ready = () => this.call('ready', [])
  getState = (...args: Parameters<LocalBattleSystemV4['getState']>) => this.call('getState', args)
  getAvailableSelection: IBattleSystem['getAvailableSelection'] = (...args) => this.call('getAvailableSelection', args)
  submitAction(selection: Parameters<IBattleSystem['submitAction']>[0]) {
    // Capture this fixed DTO before Comlink's structured clone (UI selections may be reactive).
    const input =
      selection.type === 'team-selection'
        ? { ...selection, selectedPets: [...selection.selectedPets] }
        : { ...selection }
    return this.call('submitAction', [input])
  }
  isTimerEnabled = () => this.call('isTimerEnabled', [])
  getPlayerTimerState: IBattleSystem['getPlayerTimerState'] = (...args) => this.call('getPlayerTimerState', args)
  getAllPlayerTimerStates = () => this.call('getAllPlayerTimerStates', [])
  getTimerConfig = () => this.call('getTimerConfig', [])
  startAnimation: IBattleSystem['startAnimation'] = (...args) => this.call('startAnimation', args)
  endAnimation: IBattleSystem['endAnimation'] = (...args) => this.call('endAnimation', args)
  startReconnectGraceTimer: NonNullable<IBattleSystem['startReconnectGraceTimer']> = (...args) =>
    this.call('startReconnectGraceTimer', args)
  cancelReconnectGraceTimer: NonNullable<IBattleSystem['cancelReconnectGraceTimer']> = (...args) =>
    this.call('cancelReconnectGraceTimer', args)
  createRuntimeSnapshot = () => this.call('createRuntimeSnapshot', [])
  getInitialFingerprint = () => this.call('getInitialFingerprint', [])
  restoreRuntimeSnapshot: NonNullable<IBattleSystem['restoreRuntimeSnapshot']> = (...args) =>
    this.call('restoreRuntimeSnapshot', args)
  waitForPendingDecision() {
    return this.call('waitForPendingDecision', [])
  }
  waitForCompletion = () => this.call('waitForCompletion', [])
  onInputAccepted(callback: Parameters<LocalBattleSystemV4['onInputAccepted']>[0]): () => void {
    this.assertOpen()
    this.inputListeners.add(callback)
    return () => {
      this.inputListeners.delete(callback)
    }
  }
  BattleEvent(callback: (message: BattleMessage) => void, options?: NativeMessageView): () => void {
    this.assertOpen()
    const id = ++this.nextSubscription
    this.listeners.set(id, callback)
    void this.request(() => this.remote.subscribeBattle(id, options, this.id)).catch(error =>
      this.fail(error instanceof Error ? error : Error(String(error))),
    )
    return () => {
      this.listeners.delete(id)
      if (this.state === 'active') void this.request(() => this.remote.unsubscribeBattle(id, this.id)).catch(() => {})
    }
  }
  onTimerEvent<K extends keyof Events>(type: K, handler: (data: Events[K]) => void): () => void {
    this.assertOpen()
    let listeners = this.timers.get(type)
    if (!listeners) {
      listeners = new Set()
      this.timers.set(type, listeners)
    }
    const listener = handler as (data: Events[keyof Events]) => void
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  offTimerEvent<K extends keyof Events>(type: K, handler: (data: Events[K]) => void): void {
    this.timers.get(type)?.delete(handler as (data: Events[keyof Events]) => void)
  }
  private fail(error: Error): void {
    if (this.failure || this.state === 'disposed') return
    this.failure = error
    this.state = 'faulted'
    this.cleanupState = 'terminated'
    this.finish(error)
    void this.terminate().catch(() => {})
  }
  private finish(error: Error): void {
    clearInterval(this.heartbeat)
    this.detachFailure()
    for (const reject of this.pending) reject(error)
    this.pending.clear()
    this.listeners.clear()
    this.timers.clear()
    this.inputListeners.clear()
    for (const callback of this.closedListeners.splice(0)) callback()
  }
  cancel(): Promise<void> {
    this.fail(new SandboxFault('disposed', 'battle', 'Battle launch cancelled'))
    return this.cleanup()
  }
  private terminate(reusable = false): Promise<unknown> {
    this.termination ??= Promise.resolve()
      .then(() => (this.releaseWorker ? this.releaseWorker(reusable) : this.worker.terminate()))
      .finally(() => {
        if (!this.terminalReported) {
          this.terminalReported = true
          this.report(this.status())
        }
      })
    return this.termination
  }
  cleanup(): Promise<void> {
    if (this.cleanupTask) return this.cleanupTask
    const healthy = this.state === 'active'
    if (!this.failure) this.state = 'disposed'
    this.finish(this.failure ?? new SandboxFault('disposed', 'battle', 'Battle disposed'))
    this.cleanupTask = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        this.cleanupState ??= 'terminated'
        if (healthy) {
          const graceful = await Promise.race([
            (this.policy.reuseWorkers ? this.remote.endSession(this.id) : this.remote.dispose()).then(() => true),
            new Promise<boolean>(resolve => {
              timer = setTimeout(() => resolve(false), this.policy.cleanupMs)
            }),
          ])
          this.cleanupState = graceful ? 'graceful' : 'terminated'
          if (!graceful) this.cleanupFault = 'Graceful cleanup deadline exceeded'
        }
      } catch (error) {
        this.cleanupFault = error instanceof Error ? error.message : 'Worker cleanup failed'
      } finally {
        clearTimeout(timer)
        try {
          if (!this.releaseWorker) this.remote[releaseProxy]()
        } catch {
          /* Already disconnected. */
        }
        await this.terminate(healthy && !this.failure && this.cleanupState === 'graceful')
      }
    })()
    return this.cleanupTask
  }
}
