import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten'
import variant from '@jitl/quickjs-singlefile-browser-release-sync'
import { Arena } from 'quickjs-emscripten-sync'
import type { CodeEffectModule, CodeEffectModuleContext } from '../v4/content/effect-sdk'
import type { TrustedEffectCatalog } from '../v4/content/definition-catalog'
import type { BaseMark } from '../v4/mark'
import { Effect } from '../../v4-authoring'
import { ArenaEffectSdk } from './sdk'
import {
  SandboxFault,
  sandboxPolicy,
  type SandboxPolicy,
  type EffectModuleArtifact,
  type PreparedEffectModule,
} from './contracts'

interface AuthorModule extends Partial<CodeEffectModule> {
  createCatalog?(marks: ReadonlyMap<string, BaseMark>): TrustedEffectCatalog
}
/** Each instance owns its WASM memory, Runtime, Context and Arena. */
export class ArenaEffectModule implements PreparedEffectModule {
  readonly packageId: string
  private closed = false
  private failure?: SandboxFault
  private depth = 0
  private deadline = Infinity
  private rootCalls = 0
  private totalCalls = 0
  private author?: AuthorModule
  private adapter?: ArenaEffectSdk
  private arena?: Arena
  private release: (() => void) | undefined
  private constructor(
    private readonly artifact: EffectModuleArtifact,
    private readonly policy: SandboxPolicy,
  ) {
    this.packageId = artifact.packageId
  }
  static async prepare(
    artifact: EffectModuleArtifact,
    policy: SandboxPolicy = sandboxPolicy,
  ): Promise<ArenaEffectModule> {
    if (
      !artifact ||
      artifact.format !== 'arcadia.effect-module' ||
      artifact.version !== 1 ||
      artifact.sdkApi !== 2 ||
      typeof artifact.packageId !== 'string' ||
      !artifact.packageId.length ||
      artifact.packageId.length > 200 ||
      typeof artifact.source !== 'string' ||
      new TextEncoder().encode(artifact.source).byteLength > policy.sourceBytes
    )
      throw new SandboxFault('artifact', 'module', 'Invalid effect artifact')
    for (const key of Object.keys(sandboxPolicy) as (keyof SandboxPolicy)[])
      if (!Number.isSafeInteger(policy[key]) || policy[key] <= 0 || policy[key] > sandboxPolicy[key])
        throw new SandboxFault('budget', artifact.packageId, `Invalid policy: ${key}`)
    if (policy.wasmBytes < 16 * 1024 * 1024 || policy.wasmBytes % 65536)
      throw new SandboxFault('budget', artifact.packageId, 'Invalid WASM memory ceiling')
    const session = new ArenaEffectModule(artifact, policy)
    const memory = new WebAssembly.Memory({ initial: 256, maximum: policy.wasmBytes / 65536 })
    const wasm = await newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmMemory: memory }))
    const runtime = wasm.newRuntime()
    runtime.setMemoryLimit(policy.memoryBytes)
    runtime.setMaxStackSize(policy.stackBytes)
    const context = runtime.newContext()
    let arena: Arena
    try {
      arena = new Arena(context, { isMarshalable: value => value !== globalThis })
    } catch (error) {
      context.dispose()
      runtime.dispose()
      throw error
    }
    session.arena = arena
    session.release = () => {
      arena.dispose()
      context.dispose()
      runtime.dispose()
    }
    runtime.setInterruptHandler(() => {
      if (session.failure || performance.now() > session.deadline) {
        session.failure ??= new SandboxFault('budget', session.packageId, 'Effect deadline exceeded')
        return true
      }
      return false
    })
    session.adapter = new ArenaEffectSdk(
      arena,
      policy,
      operation => session.run(operation),
      error => session.reject(error),
    )
    try {
      session.run(() => {
        for (const key of ['TypeBox.Kind', 'TypeBox.Optional', 'TypeBox.Readonly'])
          arena.register(Symbol.for(key), `Symbol.for(${JSON.stringify(key)})`)
        session.adapter!.expose()
        arena.evalCode(`(() => {
          const NativeDate = Date;
          function DeterministicDate(...args) {
            if (!new.target) return new NativeDate(0).toString();
            return new NativeDate(...(args.length ? args : [0]));
          }
          DeterministicDate.prototype = NativeDate.prototype;
          NativeDate.prototype.constructor = DeterministicDate;
          DeterministicDate.now = () => 0;
          DeterministicDate.parse = NativeDate.parse;
          DeterministicDate.UTC = NativeDate.UTC;
          globalThis.Date = DeterministicDate;
          Math.random = () => { throw Error('Use battle RNG'); };
        })();`)
        const module = arena.evalModule<AuthorModule>(artifact.source, `${artifact.packageId}.js`)
        if (
          !module ||
          typeof Reflect.get(module, 'then') === 'function' ||
          (typeof Reflect.get(module, 'createEffects') !== 'function' &&
            typeof Reflect.get(module, 'createCatalog') !== 'function')
        )
          throw new SandboxFault(
            'artifact',
            session.packageId,
            'Expected synchronous createEffects or createCatalog export',
          )
        session.author = module as AuthorModule
      }, policy.prepareMs)
      return session
    } catch (error) {
      try {
        session.dispose()
      } catch {
        /* The owning Worker is terminated after failed initialization. */
      }
      throw error
    }
  }
  get state(): 'ready' | 'faulted' | 'disposed' {
    return this.closed ? 'disposed' : this.failure ? 'faulted' : 'ready'
  }
  assertHealthy(): void {
    if (this.failure) throw this.failure
    if (this.closed) throw new SandboxFault('disposed', this.packageId, 'Effect module disposed')
  }
  private reject(error: unknown): never {
    this.failure ??=
      error instanceof SandboxFault && error.packageId === this.packageId
        ? error
        : new SandboxFault(
            error instanceof SandboxFault ? error.code : 'execution',
            this.packageId,
            error instanceof Error
              ? error.message
              : typeof error === 'string'
                ? error
                : 'Author threw a non-Error value',
          )
    throw this.failure
  }
  private run<T>(operation: () => T, limit = this.policy.callMs): T {
    this.assertHealthy()
    const root = this.depth++ === 0
    if (root) {
      this.deadline = performance.now() + limit
      this.rootCalls = 0
    }
    try {
      if (
        ++this.rootCalls > this.policy.callsPerRoot ||
        ++this.totalCalls > this.policy.callsPerSession ||
        performance.now() > this.deadline
      )
        this.reject(new SandboxFault('budget', this.packageId, 'Effect call budget exceeded'))
      const result = operation()
      if (root && this.arena)
        while (this.arena.context.runtime.hasPendingJob()) {
          if (performance.now() > this.deadline)
            this.reject(new SandboxFault('budget', this.packageId, 'Pending job deadline exceeded'))
          this.arena.executePendingJobs(16)
        }
      this.assertHealthy()
      return result
    } catch (error) {
      return this.reject(error)
    } finally {
      this.depth--
      if (root) this.deadline = Infinity
    }
  }
  createEffects(context: CodeEffectModuleContext) {
    return this.run(() => {
      if (!this.author?.createEffects) {
        if (this.author?.createCatalog) return []
        throw new SandboxFault('artifact', this.packageId, 'Missing createEffects')
      }
      this.adapter!.output(context)
      const exports = this.author.createEffects(context)
      if (!Array.isArray(exports) || exports.length > 5000)
        throw new SandboxFault('artifact', this.packageId, 'Invalid effect exports')
      const canonical = []
      for (const value of exports) {
        if (!this.adapter!.isCanonical(value))
          throw new SandboxFault('artifact', this.packageId, 'Expected SDK-created effect exports')
        canonical.push(value)
      }
      return Object.freeze(canonical) as ReturnType<CodeEffectModule['createEffects']>
    }, this.policy.prepareMs)
  }
  createCatalog(marks: ReadonlyMap<string, BaseMark>): TrustedEffectCatalog {
    return this.run(() => {
      if (!this.author?.createCatalog) throw new SandboxFault('artifact', this.packageId, 'Missing createCatalog')
      this.adapter!.output(marks)
      const catalog = this.author.createCatalog(marks)
      if (
        !(catalog.effects instanceof Map) ||
        !(catalog.parameters instanceof Map) ||
        catalog.effects.size > 5000 ||
        catalog.parameters.size > 5000
      )
        throw new SandboxFault('artifact', this.packageId, 'Invalid effect catalog')
      const effects = new Map(catalog.effects),
        parameters = new Map(catalog.parameters)
      for (const effect of effects.values())
        if (!(effect instanceof Effect) || !this.adapter!.isCanonical(effect))
          throw new SandboxFault('artifact', this.packageId, 'Expected SDK-compiled effects')
      for (const parameter of parameters.values())
        if (!this.adapter!.isCanonical(parameter))
          throw new SandboxFault('artifact', this.packageId, 'Expected SDK parameter catalogs')
      return { effects, parameters }
    }, this.policy.prepareMs)
  }
  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.author = undefined
    this.adapter = undefined
    const release = this.release
    this.release = undefined
    release?.()
  }
}
