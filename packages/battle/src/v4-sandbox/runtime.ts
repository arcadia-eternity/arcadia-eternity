import * as sdk from '../../v4-authoring'
import { releaseProxy } from 'comlink'
import { createContentCatalog, type ContentPrototypeData } from '../v4/content/definition-catalog'
import type { BattleOptions } from '../v4/api'
import type { Battle } from '../v4/battle'
import { LocalBattleSystemV4, type NativeBattleHostOptions, type NativeMessageView } from '../v4-host/local-battle'
import { ArenaEffectModule } from './effect-module'
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
  | { readonly kind: 'input'; readonly data: Parameters<Parameters<LocalBattleSystemV4['onInputAccepted']>[0]>[0] }
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

/** One trusted native kernel and one Arena VM for each package, owned by one dedicated Worker. */
export class SandboxBattleRuntime {
  private readonly modules: ArenaEffectModule[] = []
  private readonly subscriptions: (() => void)[] = []
  private system?: LocalBattleSystemV4
  private battle?: Battle
  private initialized = false
  private closed = false
  private failure?: Error
  private revision?: string
  private readonly events: SandboxEvent[] = []
  private sending = false
  private delivery?: Promise<void>
  private emit?: (event: SandboxEvent) => Promise<void>
  private readonly battleSubscriptions = new Map<number, () => void>()
  async initialize(input: SandboxBattleInput, emit: (event: SandboxEvent) => Promise<void>): Promise<void> {
    if (this.initialized || this.closed) throw new SandboxFault('worker', 'battle', 'Worker cannot be reused')
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
      const environment = input.environment,
        names = new Set<string>()
      this.revision = environment.revision
      for (const entry of environment.modules) {
        if (
          names.has(entry.artifact.packageId) ||
          !['catalog', 'behaviors'].includes(entry.role) ||
          typeof entry.namespace !== 'string'
        )
          throw new SandboxFault('artifact', 'battle', 'Duplicate or invalid package')
        names.add(entry.artifact.packageId)
        this.modules.push(await ArenaEffectModule.prepare(entry.artifact))
      }
      const content = createContentCatalog(
        environment.data,
        environment.revision,
        marks => {
          const effects = new Map(),
            parameters = new Map()
          for (const [i, entry] of environment.modules.entries())
            if (entry.role === 'catalog') {
              const catalog = this.modules[i].createCatalog(marks)
              for (const [id, effect] of catalog.effects) {
                if (effects.has(id))
                  throw new SandboxFault('artifact', entry.artifact.packageId, `Duplicate effect ${id}`)
                effects.set(id, effect)
              }
              for (const [id, parameter] of catalog.parameters) parameters.set(id, parameter)
            }
          return { effects, parameters }
        },
        ({ marks }) => ({
          nativeExports: environment.modules.flatMap((entry, index) =>
            this.modules[index].createEffects({
              sdk,
              marks,
              id: local => {
                if (typeof local !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(local))
                  throw new SandboxFault('artifact', entry.artifact.packageId, 'Invalid local ID')
                return entry.namespace ? `${entry.namespace}:${local}` : local
              },
            }),
          ),
        }),
      )
      this.health()
      const [first, second] = content.parsePlayers(input.players, { aiPlayerIds: input.aiPlayerIds })
      this.battle = content.createBattle(first, second, input.options)
      this.observe(this.battle)
      this.system = new LocalBattleSystemV4(
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
  subscribeBattle(id: number, options?: NativeMessageView): void {
    this.health()
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
  unsubscribeBattle(id: number): void {
    this.battleSubscriptions.get(id)?.()
    this.battleSubscriptions.delete(id)
  }
  private observe(battle: Battle) {
    this.subscriptions.push(
      battle.executionBudget.observe(() => {
        for (const module of this.modules) module.assertHealthy()
      }),
    )
  }
  private enqueue(event: SandboxEvent, emit: (event: SandboxEvent) => Promise<void>): void {
    if (this.closed || this.failure) return
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
        while (!this.closed && this.events.length) await emit(this.events.shift()!)
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
  health(): { packages: number; state: 'ready' } {
    if (this.closed) throw new SandboxFault('disposed', 'battle', 'Worker disposed')
    if (this.failure) throw this.failure
    for (const module of this.modules) module.assertHealthy()
    this.battle?.executionBudget.assertActive()
    return { packages: this.modules.length, state: 'ready' }
  }
  async invoke(method: BattleMethod, args: unknown[]): Promise<unknown> {
    this.health()
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
    const fn = this.system[method] as (...args: unknown[]) => unknown
    try {
      const value: unknown = await fn.apply(this.system, args)
      if (method === 'ready')
        void this.system.waitForCompletion().catch(error => {
          this.failure = error instanceof Error ? error : new SandboxFault('execution', 'battle', String(error))
        })
      this.health()
      await this.delivery
      this.health()
      if (new TextEncoder().encode(JSON.stringify(value)).byteLength > sandboxPolicy.outputBytes)
        throw new SandboxFault('budget', 'battle', 'Battle output limit')
      return value
    } catch (error) {
      this.health()
      throw error
    }
  }
  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const detach of this.battleSubscriptions.values()) detach()
    this.battleSubscriptions.clear()
    for (const detach of this.subscriptions.splice(0)) detach()
    this.events.length = 0
    let failure: unknown
    try {
      if (this.system) await this.system.cleanup()
      else await this.battle?.cleanup()
    } catch (error) {
      failure = error
    }
    for (const module of this.modules.splice(0)) {
      try {
        module.dispose()
      } catch (error) {
        failure ??= error
      }
    }
    this.system = undefined
    this.battle = undefined
    if (this.emit) (this.emit as typeof this.emit & { [releaseProxy](): void })[releaseProxy]()
    this.emit = undefined
    if (failure) throw failure
  }
}
export type SandboxWorkerRemote = Pick<
  SandboxBattleRuntime,
  'initialize' | 'health' | 'invoke' | 'dispose' | 'subscribeBattle' | 'unsubscribeBattle'
>
