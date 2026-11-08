import { releaseProxy } from 'comlink'
import type { ContentPrototypeData } from '../engine/content/definition-catalog'
import type { BattleOptions } from '../engine/api'
import type { Battle } from '../engine/battle'
import { LocalBattleSystem, type NativeBattleHostOptions, type NativeMessageView } from '../host/local-battle'
import { prepareSandboxContent, type SandboxContent } from './content'
import { SandboxFault, sandboxPolicy, type EffectModuleArtifact } from './contracts'
import type { BattleMessage, Events } from '@arcadia-eternity/const'

export interface SandboxEnvironment {
  readonly revision: string
  readonly data: ContentPrototypeData
  readonly modules: readonly {
    readonly artifact: EffectModuleArtifact
    readonly namespace: string
    readonly role: 'catalog' | 'behaviors'
  }[]
}
export interface SandboxBattleInput {
  readonly environment: SandboxEnvironment
  readonly players: readonly unknown[]
  readonly aiPlayerIds?: readonly string[]
  readonly options?: BattleOptions
  readonly hostOptions?: NativeBattleHostOptions
}
export interface SandboxRuntimeOptions {
  readonly sessionId: number
  readonly reuseContent: boolean
  readonly grouping: 'package' | 'environment'
}
export const timerEvents = [
  'timerStart',
  'timerUpdate',
  'timerPause',
  'timerResume',
  'timerTimeout',
  'teamSelectionTimerStart',
  'teamSelectionTimerStop',
  'teamSelectionTimeout',
  'timerSnapshot',
  'timerStateChange',
  'animationStart',
  'animationEnd',
] as const satisfies readonly (keyof Events)[]
export type SandboxEvent =
  | { readonly kind: 'battle'; readonly subscription: number; readonly message: BattleMessage }
  | { readonly kind: 'timer'; readonly type: keyof Events; readonly data: Events[keyof Events] }
  | { readonly kind: 'input'; readonly data: Parameters<Parameters<LocalBattleSystem['onInputAccepted']>[0]>[0] }
export const battleMethods = [
  'ready',
  'getState',
  'getAvailableSelection',
  'submitAction',
  'isTimerEnabled',
  'getPlayerTimerState',
  'getAllPlayerTimerStates',
  'getTimerConfig',
  'startAnimation',
  'endAnimation',
  'startReconnectGraceTimer',
  'cancelReconnectGraceTimer',
  'createRuntimeSnapshot',
  'restoreRuntimeSnapshot',
  'getInitialFingerprint',
  'waitForPendingDecision',
  'waitForCompletion',
] as const
export type BattleMethod = (typeof battleMethods)[number]

/** One active battle session. Healthy pooled workers retain their immutable executable content. */
export class SandboxBattleRuntime {
  private effects?: SandboxContent
  private readonly subscriptions: (() => void)[] = []
  private system?: LocalBattleSystem
  private battle?: Battle
  private initialized = false
  private sessionId = 0
  private reuseContent = false
  private environment?: string
  private grouping?: SandboxRuntimeOptions['grouping']
  private ending = false
  private invocations = 0
  private readonly drained: (() => void)[] = []
  private endingTask?: Promise<void>
  private closed = false
  private failure?: Error
  private revision?: string
  private readonly events: SandboxEvent[] = []
  private sending = false
  private delivery?: Promise<void>
  private emit?: (event: SandboxEvent) => Promise<void>
  private readonly battleSubscriptions = new Map<number, () => void>()
  constructor(private readonly catalogMs?: number) {}
  async initialize(
    input: SandboxBattleInput,
    emit: (event: SandboxEvent) => Promise<void>,
    options: SandboxRuntimeOptions = { sessionId: 0, reuseContent: false, grouping: 'package' },
  ): Promise<void> {
    if (this.initialized || this.closed || this.ending || this.failure)
      throw new SandboxFault('worker', 'battle', 'Worker is unavailable')
    if (
      !Number.isSafeInteger(options.sessionId) ||
      options.sessionId < 0 ||
      typeof options.reuseContent !== 'boolean' ||
      !['package', 'environment'].includes(options.grouping)
    )
      throw new SandboxFault('artifact', 'battle', 'Invalid runtime options')
    this.sessionId = options.sessionId
    this.reuseContent = options.reuseContent
    this.endingTask = undefined
    this.initialized = true
    this.emit = emit
    try {
      if (
        !input ||
        !input.environment ||
        !Array.isArray(input.environment.modules) ||
        input.environment.modules.length > sandboxPolicy.packagesPerBattle ||
        !Array.isArray(input.players) ||
        input.players.length !== 2
      )
        throw new SandboxFault('artifact', 'battle', 'Invalid battle input')
      const environment = JSON.stringify(input.environment)
      if (
        this.effects &&
        (this.environment !== environment || this.grouping !== options.grouping || !options.reuseContent)
      )
        throw new SandboxFault('artifact', 'battle', 'Worker environment mismatch')
      this.revision = input.environment.revision
      if (!this.effects) {
        this.effects = await prepareSandboxContent(input.environment, {
          grouping: options.grouping,
          catalogMs: this.catalogMs,
        })
        this.environment = environment
        this.grouping = options.grouping
      }
      this.effects.beginSession()
      const { content } = this.effects
      this.health()
      const [first, second] = content.parsePlayers(input.players, { aiPlayerIds: input.aiPlayerIds })
      this.battle = content.createBattle(first, second, input.options)
      this.observe(this.battle)
      this.system = new LocalBattleSystem(
        this.battle,
        {
          snapshot: content.snapshot,
          restore: value => {
            const restored = content.restore(value)
            this.observe(restored)
            this.battle = restored
            return restored
          },
        },
        input.hostOptions,
      )
      this.subscriptions.push(this.system.onInputAccepted(data => this.enqueue({ kind: 'input', data }, emit)))
      for (const type of timerEvents)
        this.subscriptions.push(
          this.system.onTimerEvent(type, data => this.enqueue({ kind: 'timer', type, data }, emit)),
        )
    } catch (error) {
      await this.dispose()
      throw error
    }
  }
  subscribeBattle(id: number, options?: NativeMessageView, sessionId?: number): void {
    this.assertSession(sessionId)
    this.health(sessionId)
    if (
      !this.system ||
      !Number.isSafeInteger(id) ||
      id < 1 ||
      this.battleSubscriptions.has(id) ||
      this.battleSubscriptions.size >= 128
    )
      throw new SandboxFault('permission', 'battle', 'Invalid battle subscription')
    this.battleSubscriptions.set(
      id,
      this.system.BattleEvent(
        message => this.enqueue({ kind: 'battle', subscription: id, message }, this.emit!),
        options,
      ),
    )
  }
  unsubscribeBattle(id: number, sessionId?: number): void {
    this.assertSession(sessionId)
    this.battleSubscriptions.get(id)?.()
    this.battleSubscriptions.delete(id)
  }
  private observe(battle: Battle) {
    this.subscriptions.push(
      battle.executionBudget.observe(() => {
        this.effects?.assertHealthy()
      }),
    )
  }
  private enqueue(event: SandboxEvent, emit: (event: SandboxEvent) => Promise<void>): void {
    if (this.closed || this.ending || this.failure) return
    if (
      this.events.length >= 4096 ||
      new TextEncoder().encode(JSON.stringify(event)).byteLength > sandboxPolicy.outputBytes
    ) {
      this.failure = new SandboxFault('budget', 'battle', 'Battle event queue or size limit exceeded')
      this.battle?.executionBudget.fail(this.failure)
      throw this.failure
    }
    this.events.push(event)
    if (this.sending) return
    this.sending = true
    this.delivery = (async () => {
      try {
        while (!this.closed && !this.ending && this.events.length) await emit(this.events.shift()!)
      } catch (error) {
        this.failure = new SandboxFault(
          'worker',
          'battle',
          error instanceof Error ? error.message : 'Event delivery failed',
        )
      } finally {
        this.sending = false
      }
    })()
  }
  private assertSession(sessionId?: number): void {
    if (!this.initialized || this.ending || (sessionId !== undefined && sessionId !== this.sessionId))
      throw new SandboxFault('disposed', 'battle', 'Battle session expired')
  }
  health(sessionId?: number): { packages: number; vms: number; state: 'ready' } {
    if (sessionId !== undefined) this.assertSession(sessionId)
    if (this.closed) throw new SandboxFault('disposed', 'battle', 'Worker disposed')
    if (this.failure) throw this.failure
    this.effects?.assertHealthy()
    this.battle?.executionBudget.assertActive()
    return { packages: this.effects?.packageCount ?? 0, vms: this.effects?.vmCount ?? 0, state: 'ready' }
  }
  async invoke(method: BattleMethod, args: unknown[], sessionId?: number): Promise<unknown> {
    this.assertSession(sessionId)
    this.health(sessionId)
    if (!this.system || !battleMethods.includes(method) || !Array.isArray(args) || args.length > 4)
      throw new SandboxFault('permission', 'battle', 'Unknown battle operation')
    if (method === 'restoreRuntimeSnapshot') {
      const snapshot = args[0] as { payload?: unknown } | undefined
      if (
        typeof snapshot?.payload !== 'string' ||
        new TextEncoder().encode(snapshot.payload).byteLength > sandboxPolicy.outputBytes
      )
        throw new Error('Invalid or oversized runtime snapshot')
      const payload = JSON.parse(snapshot.payload) as { battle?: { catalog?: unknown } } | null
      if (payload?.battle?.catalog !== this.revision) throw new Error('Snapshot content revision mismatch')
    }
    const session = this.sessionId
    const system = this.system
    const fn = system[method] as (...args: unknown[]) => unknown
    this.invocations++
    try {
      const value: unknown = await fn.apply(system, args)
      if (method === 'ready')
        void system.waitForCompletion().catch(error => {
          if (this.closed || this.ending || session !== this.sessionId) return
          this.failure = error instanceof Error ? error : new SandboxFault('execution', 'battle', String(error))
        })
      this.assertSession(session)
      this.health(session)
      await this.delivery
      this.assertSession(session)
      this.health(session)
      if (new TextEncoder().encode(JSON.stringify(value)).byteLength > sandboxPolicy.outputBytes)
        throw new SandboxFault('budget', 'battle', 'Battle output limit')
      return value
    } catch (error) {
      this.assertSession(session)
      this.health(session)
      throw error
    } finally {
      this.invocations--
      if (!this.invocations) for (const resolve of this.drained.splice(0)) resolve()
    }
  }
  endSession(sessionId?: number): Promise<void> {
    if (sessionId !== undefined && sessionId !== this.sessionId)
      return Promise.reject(new SandboxFault('disposed', 'battle', 'Battle session expired'))
    if (this.endingTask) return this.endingTask
    if (!this.initialized) return Promise.resolve()
    this.ending = true
    return (this.endingTask = (async () => {
      for (const detach of this.battleSubscriptions.values()) detach()
      this.battleSubscriptions.clear()
      for (const detach of this.subscriptions.splice(0)) detach()
      this.events.length = 0
      let failure: unknown = this.failure
      try {
        this.effects?.assertHealthy()
        this.battle?.executionBudget.assertActive()
      } catch (error) {
        failure ??= error
      }
      try {
        if (this.system) await this.system.cleanup()
        else await this.battle?.cleanup()
        await this.delivery
        if (this.invocations) await new Promise<void>(resolve => this.drained.push(resolve))
        this.effects?.assertHealthy()
        this.effects?.endSession()
      } catch (error) {
        failure ??= error
      }
      this.system = undefined
      this.battle = undefined
      this.delivery = undefined
      this.sending = false
      if (this.emit) (this.emit as typeof this.emit & { [releaseProxy](): void })[releaseProxy]()
      this.emit = undefined
      this.initialized = false
      this.ending = false
      failure ??= this.failure
      if (failure) {
        this.failure =
          failure instanceof Error
            ? failure
            : new SandboxFault(
                'worker',
                'battle',
                typeof failure === 'string' ? failure : 'Battle session cleanup failed',
              )
        throw this.failure
      }
      if (!this.reuseContent) {
        this.effects?.dispose()
        this.effects = undefined
        this.closed = true
      }
    })())
  }
  async dispose(): Promise<void> {
    if (this.closed && !this.effects) return
    this.closed = true
    try {
      await this.endSession()
    } finally {
      this.effects?.dispose()
      this.effects = undefined
    }
  }
}
export type SandboxWorkerRemote = Pick<
  SandboxBattleRuntime,
  'initialize' | 'health' | 'invoke' | 'endSession' | 'dispose' | 'subscribeBattle' | 'unsubscribeBattle'
>
