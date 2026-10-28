import type { BaseMark } from '../mark'
import type { EffectDefinition, Parameter, Trigger } from './authoring/contracts'
import { defineNativeBehavior, type BehaviorDefinition, type NativeBehaviorExport } from './behaviors'
import type { NativeEffectContext, NativeEffectDefinition, NativeEffectTrigger } from './native-effect'
import { nativeEffectContext } from './authoring/runtime'

/** Bump when the injected authoring/module contract changes incompatibly. Actual builds have separate digests. */
export const effectSdkApiVersion = 1 as const

/** A code export is compiled separately for each content use. Never keep battle state in this factory. */
export interface CodeEffectContext {
  readonly effectId: string
  readonly sourceMark?: BaseMark
}

/** Official native-effect fields with the existing runtime parameter and binding metadata. */
export type NativeCodeEffectDefinition<
  T extends NativeEffectTrigger,
  P extends Readonly<Record<string, Parameter<unknown>>> = Record<never, never>,
> = Omit<NativeEffectDefinition<T>, 'id'> & {
  readonly id: string
} & Pick<EffectDefinition<Trigger, P>, 'parameters' | 'bindings' | 'rebindOnOwnerTransfer'>

type CodeExport = { readonly id: string; readonly sourceKind: 'skill' | 'petMark' }

/** Native shorthand: the host supplies each use's stable compiled identity. */
export function defineCodeEffect<
  const T extends NativeEffectTrigger,
  const P extends Readonly<Record<string, Parameter<unknown>>> = Record<never, never>,
>(input: CodeExport & Omit<NativeCodeEffectDefinition<T, P>, 'id'>): NativeBehaviorExport

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
  type Definition = EffectDefinition<Trigger, Parameters> | NativeCodeEffectDefinition<NativeEffectTrigger, Parameters>
  const declared = input as CodeExport & NativeCodeEffectDefinition<NativeEffectTrigger, Parameters>
  const direct =
    'build' in input
      ? undefined
      : {
          ...declared,
          triggers: [...declared.triggers],
          tags: declared.tags ? [...declared.tags] : undefined,
          parameters: declared.parameters ? { ...declared.parameters } : undefined,
          bindings: declared.bindings ? { ...declared.bindings } : undefined,
        }
  // The overloads retain each callback's trigger type; compilation validates the actual definition below.
  const build =
    'build' in input
      ? (input.build as (context: CodeEffectContext) => Definition)
      : (context: CodeEffectContext) => ({
          ...direct!,
          id: context.effectId,
        })
  if (typeof build !== 'function') throw new Error('Code effect requires a definition factory')
  return defineNativeBehavior({
    id: input.id,
    sourceKind: input.sourceKind,
    parameters: {},
    build(context) {
      const definition = build({ effectId: context.effectId, sourceMark: context.sourceMark })
      if (!('triggers' in definition)) return definition
      const { triggers, when, apply, ...metadata } = definition
      if (typeof apply !== 'function') throw new Error('Native code effect requires an apply callback')
      // Only adapt registration. Timing, context identity and domain operations are the official engine's.
      return {
        ...metadata,
        on: triggers.length === 1 ? triggers[0] : triggers,
        when: when ? frame => when(nativeEffectContext(frame) as NativeEffectContext<NativeEffectTrigger>) : undefined,
        execute: frame => apply(nativeEffectContext(frame) as NativeEffectContext<NativeEffectTrigger>),
      }
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
