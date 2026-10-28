import type { BaseMark } from '../mark'
import type { NativeBehaviorExport } from './behaviors'

/** Runtime values must come from the host's injected SDK, never a private engine copy. */
export type EffectSdk = typeof import('../../../v4-authoring')

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
