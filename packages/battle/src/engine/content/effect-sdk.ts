import type { Context } from '../context'
import type { effectSdkFunctions } from './sdk-capabilities'
import type { BaseMark } from '../mark'
import type { NativeBehaviorExport } from './behaviors'

type Authoring = typeof import('../../../authoring')
type CallableCapability = (typeof effectSdkFunctions)[number]
/** Domain classes support identity checks, not guest construction or static host APIs. */
type IdentityClass<T> = abstract new (...args: never[]) => T
type InjectedValue<K extends keyof Authoring> = Authoring[K] extends abstract new (...args: never[]) => infer T
  ? K extends 'ParameterCatalog' | 'BehaviorCompilationError'
    ? Authoring[K]
    : T extends Context
      ? K extends 'Context'
        ? IdentityClass<T>
        : Authoring[K]
      : IdentityClass<T>
  : Authoring[K]

/** Runtime values come from the host. Only admitted functions and constructors are callable.
 * The full authoring entry remains available to trusted host code.
 */
export type EffectSdk = {
  readonly [K in keyof Authoring as Authoring[K] extends (...args: never[]) => unknown
    ? K extends CallableCapability
      ? K
      : never
    : K]: InjectedValue<K>
}

/** Synchronous module factory. Called while building a catalog, not once per battle or trigger. */
export interface CodeEffectModuleContext {
  readonly sdk: EffectSdk
  /** Canonical mark prototypes of the assembled environment, keyed by runtime ID. */
  readonly marks: ReadonlyMap<string, BaseMark>
  /** Qualify a stable local content ID with this package's namespace. */
  readonly id: (localId: string) => string
}

export interface CodeEffectModule {
  readonly createEffects: (context: CodeEffectModuleContext) => readonly NativeBehaviorExport[]
}
