import type { BaseMark } from '../mark'
import type { EffectDefinition, Parameter, Trigger } from './authoring/contracts'
import { defineNativeBehavior, type BehaviorDefinition, type NativeBehaviorExport } from './behaviors'

/** Bump when the injected authoring/module contract changes incompatibly. Actual builds have separate digests. */
export const effectSdkApiVersion = 1 as const

/** A code export is compiled separately for each content use. Never keep battle state in this factory. */
export interface CodeEffectContext {
  readonly effectId: string
  readonly sourceMark?: BaseMark
}

/** Ordinary TypeScript implementation without a required editor form or serialized configuration schema.
 * Runtime parameters declared on the definition retain their addresses, tags, modifiers and per-battle values.
 * Fixed reusable configuration may use typed functions/closures; persistent state belongs in engine instances.
 * The returned export still requires host admission before it can be registered.
 */
export function defineCodeEffect<
  const T extends Trigger,
  const P extends Readonly<Record<string, Parameter<unknown>>> = Record<never, never>,
>(input: {
  readonly id: string
  readonly sourceKind: 'skill' | 'petMark'
  readonly build: (context: CodeEffectContext) => EffectDefinition<T, P>
}): NativeBehaviorExport {
  const build = input.build
  if (typeof build !== 'function') throw new Error('Code effect requires a definition factory')
  return defineNativeBehavior({
    id: input.id,
    sourceKind: input.sourceKind,
    parameters: {},
    build(context) {
      return build({ effectId: context.effectId, sourceMark: context.sourceMark })
    },
  })
}

/** Serializable reference metadata. Creating it does not authorize or execute the export. */
export function codeEffectDefinition(effect: Pick<NativeBehaviorExport, 'id' | 'sourceKind'>): BehaviorDefinition {
  return Object.freeze({
    formatVersion: 1,
    id: effect.id,
    sourceKind: effect.sourceKind,
    parameters: Object.freeze({}),
    implementation: Object.freeze({ kind: 'native', exportId: effect.id }),
  })
}
