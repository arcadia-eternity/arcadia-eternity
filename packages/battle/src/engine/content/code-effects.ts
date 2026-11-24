import type { BaseMark } from './authoring/domain'
import type { EffectDefinition, Parameter, Trigger } from './authoring/contracts'
import { defineNativeBehavior, type BehaviorDefinition, type NativeBehaviorExport } from './behaviors'

export { effectSdkApiVersion } from '@arcadia-eternity/const'

/** A code export is compiled separately for each content use. Never keep battle state in this factory. */
export interface CodeEffectContext {
  readonly effectId: string
  readonly sourceMark?: BaseMark
}

type CodeExport = { readonly id: string; readonly sourceKind: 'skill' | 'petMark' }

/** Native shorthand: the host supplies each use's stable compiled identity. */
export function defineCodeEffect<
  const T extends Trigger,
  const P extends Readonly<Record<string, Parameter<unknown>>> = Record<never, never>,
>(input: CodeExport & EffectDefinition<T, P>): NativeBehaviorExport

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
}): NativeBehaviorExport
export function defineCodeEffect(input: CodeExport & object): NativeBehaviorExport {
  type Parameters = Readonly<Record<string, Parameter<unknown>>>
  type Definition = EffectDefinition<Trigger, Parameters>
  let build: (context: CodeEffectContext) => Definition
  if ('build' in input) {
    build = input.build as typeof build
  } else {
    const { triggers, tags, parameters, bindings, ...definition } = input as CodeExport & Definition
    const direct = {
      ...definition,
      triggers: [...triggers],
      tags: tags && [...tags],
      parameters: parameters && { ...parameters },
      bindings: bindings && { ...bindings },
    }
    build = ({ effectId }) => {
      if (typeof direct.apply !== 'function') throw new Error('Native code effect requires an apply callback')
      return { ...direct, id: effectId }
    }
  }
  if (typeof build !== 'function') throw new Error('Code effect requires a definition factory')
  return defineNativeBehavior({
    id: input.id,
    sourceKind: input.sourceKind,
    parameters: {},
    build: context => build({ effectId: context.effectId, sourceMark: context.sourceMark }),
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
