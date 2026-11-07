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
  readonly maxIdleWorkers: number
  readonly maxQueuedBattles: number
  readonly queueTimeoutMs: number
  readonly initializeMs: number
  readonly requestMs: number
  readonly cleanupMs: number
  readonly heartbeatMs: number
  readonly reuseWorkers: boolean
  readonly vmGrouping: 'package' | 'environment'
}
const defaultPolicy: BattleWorkerPolicy = Object.freeze({
  maxBattles: 4,
  maxIdleWorkers: 4,
  maxQueuedBattles: 0,
  queueTimeoutMs: 30_000,
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
export type BattleWorkerAdmissionReason = 'capacity' | 'queue-timeout' | 'cancelled' | 'disposed'
/** Admission failures stay local to the manager, so callers can map reasons without parsing messages. */
export class BattleWorkerAdmissionError extends SandboxFault {
  constructor(readonly reason: BattleWorkerAdmissionReason) {
    const messages = {
      capacity: 'Concurrent battle limit or battle queue full',
      'queue-timeout': 'Battle queue deadline exceeded',
      cancelled: 'Battle launch cancelled',
      disposed: 'Battle Worker manager disposed',
    }
    super(reason === 'capacity' || reason === 'queue-timeout' ? 'budget' : 'disposed', 'battle', messages[reason])
  }
}
export interface BattleWorkerPoolStatus {
  /** Running or cleaning leases; capacity is held until cleanup/termination completes. */
  readonly active: number
  readonly preparing: number
  readonly idle: number
  readonly queued: number
  /** Includes workers still terminating. Never exceeds maxWorkers. */
  readonly workers: number
  readonly maxWorkers: number
}
interface QueuedBattle {
  readonly input: SandboxBattleInput
  readonly signal?: AbortSignal
  readonly resolve: (battle: WorkerBattleSystem) => void
  readonly reject: (error: unknown) => void
  timer?: ReturnType<typeof setTimeout>
  detachAbort?: () => void
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
  private readonly reservedEvictions = new Set<WorkerSlot>()
  private readonly idle: WorkerSlot[] = []
  private readonly active = new Map<number, WorkerBattleSystem>()
  private readonly history: BattleWorkerStatus[] = []
  private readonly queue: QueuedBattle[] = []
  private readonly launching = new Set<Promise<WorkerBattleSystem>>()
  private closed = false
  private disposing?: Promise<void>
  private readonly policy: BattleWorkerPolicy
  constructor(
    private readonly createWorker: () => BattleWorker,
    policy: Partial<BattleWorkerPolicy> = {},
  ) {
    this.policy = {
      ...defaultPolicy,
      ...policy,
      maxIdleWorkers: policy.maxIdleWorkers ?? policy.maxBattles ?? defaultPolicy.maxBattles,
    }
    const { reuseWorkers, vmGrouping, maxIdleWorkers, maxQueuedBattles, ...limits } = this.policy
    if (
      !Number.isSafeInteger(maxIdleWorkers) ||
      maxIdleWorkers < 0 ||
      maxIdleWorkers > this.policy.maxBattles ||
      !Number.isSafeInteger(maxQueuedBattles) ||
      maxQueuedBattles < 0 ||
      this.policy.queueTimeoutMs > 2_147_483_647
    )
      throw Error('Invalid Worker policy')
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
      .finally(() => {
        this.slots.delete(slot)
        this.reservedEvictions.delete(slot)
        this.schedule()
      })
    return slot.termination
  }
  private occupiedSlots(): number {
    return this.slots.size + this.creating - this.reservedEvictions.size
  }
  private canLaunch(): boolean {
    return (
      this.active.size + this.creating < this.policy.maxBattles &&
      (this.occupiedSlots() < this.policy.maxBattles || this.idle.length > 0)
    )
  }
  private detachQueued(entry: QueuedBattle): void {
    clearTimeout(entry.timer)
    entry.detachAbort?.()
  }
  private rejectQueued(entry: QueuedBattle, error: Error): void {
    const index = this.queue.indexOf(entry)
    if (index < 0) return
    this.queue.splice(index, 1)
    this.detachQueued(entry)
    entry.reject(error)
    this.schedule()
  }
  private start(entry: QueuedBattle): void {
    this.detachQueued(entry)
    const task = this.launch(entry.input, entry.signal)
    this.launching.add(task)
    void task.then(entry.resolve, entry.reject).finally(() => this.launching.delete(task))
  }
  private schedule(): void {
    while (!this.closed && this.queue.length && this.canLaunch()) {
      this.start(this.queue.shift()!)
    }
  }
  async create(input: SandboxBattleInput, signal?: AbortSignal): Promise<WorkerBattleSystem> {
    if (this.closed) throw new BattleWorkerAdmissionError('disposed')
    if (signal?.aborted) throw new BattleWorkerAdmissionError('cancelled')
    const serialized = JSON.stringify(input)
    if (new TextEncoder().encode(serialized).byteLength > 16 * 1024 * 1024)
      throw new SandboxFault('budget', 'battle', 'Battle input limit')
    // Capture even queued inputs now; caller mutation must never change the eventual environment or players.
    const captured: SandboxBattleInput = JSON.parse(serialized)
    return new Promise<WorkerBattleSystem>((resolve, reject) => {
      const entry: QueuedBattle = { input: captured, signal, resolve, reject }
      if (!this.queue.length && this.canLaunch()) {
        this.start(entry)
        return
      }
      if (this.queue.length >= this.policy.maxQueuedBattles) {
        reject(new BattleWorkerAdmissionError('capacity'))
        return
      }
      this.queue.push(entry)
      const cancel = () => this.rejectQueued(entry, new BattleWorkerAdmissionError('cancelled'))
      signal?.addEventListener('abort', cancel, { once: true })
      entry.detachAbort = () => signal?.removeEventListener('abort', cancel)
      entry.timer = setTimeout(() => {
        this.rejectQueued(entry, new BattleWorkerAdmissionError('queue-timeout'))
      }, this.policy.queueTimeoutMs)
      if (signal?.aborted) cancel()
      this.schedule()
    })
  }
  private async launch(captured: SandboxBattleInput, signal?: AbortSignal): Promise<WorkerBattleSystem> {
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
        // Creating leases reserve future slots, including while an eviction is awaiting termination.
        if (this.occupiedSlots() > this.policy.maxBattles && this.idle.length) {
          const victim = this.idle[0]
          this.reservedEvictions.add(victim)
          await this.terminate(victim)
        }
        if (this.slots.size >= this.policy.maxBattles)
          throw new SandboxFault('budget', 'battle', 'Concurrent worker limit')
        if (this.closed) throw new BattleWorkerAdmissionError('disposed')
        if (signal?.aborted) throw new BattleWorkerAdmissionError('cancelled')
        const worker = this.createWorker()
        slot = { id: ++this.nextWorkerId, worker, remote: wrap<SandboxWorkerRemote>(worker.endpoint), environment }
        this.slots.add(slot)
      }
      if (this.closed) throw new BattleWorkerAdmissionError('disposed')
      if (signal?.aborted) throw new BattleWorkerAdmissionError('cancelled')
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
          this.schedule()
        },
        owned.remote,
        async reusable => {
          if (
            reusable &&
            this.policy.reuseWorkers &&
            !this.closed &&
            !owned.termination &&
            this.idle.length < this.policy.maxIdleWorkers
          ) {
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
        try {
          if (slot) await this.terminate(slot)
        } finally {
          this.creating--
          this.schedule()
        }
      }
      throw error
    }
  }
  poolStatus(): BattleWorkerPoolStatus {
    const initializing = [...this.active.values()].filter(battle => battle.status().state === 'preparing').length
    return Object.freeze({
      active: this.active.size - initializing,
      preparing: this.creating + initializing,
      idle: this.idle.length,
      queued: this.queue.length,
      workers: this.slots.size,
      maxWorkers: this.policy.maxBattles,
    })
  }
  status(): readonly BattleWorkerStatus[] {
    return [...this.history.map(value => ({ ...value })), ...[...this.active.values()].map(battle => battle.status())]
  }
  dispose(): Promise<void> {
    this.closed = true
    for (const entry of this.queue.splice(0)) {
      this.detachQueued(entry)
      entry.reject(new BattleWorkerAdmissionError('disposed'))
    }
    return (this.disposing ??= (async () => {
      try {
        await Promise.all([...this.active.values()].map(battle => battle.cleanup()))
      } finally {
        try {
          await Promise.all([...this.slots].map(slot => this.terminate(slot)))
        } finally {
          await Promise.allSettled([...this.launching])
        }
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
    this.fail(new BattleWorkerAdmissionError('cancelled'))
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
