import { Value } from '@sinclair/typebox/value'
import type { Static, TObject } from '@sinclair/typebox'
import type { EffectTrigger } from '@arcadia-eternity/const'
import type { EffectContext } from '../context'
import { SkillInstance } from '../skill'
import { Pet } from '../pet'
import { isCapabilityNeed, type ActionCapabilities, type ActionRuntime, type CapabilityNeed } from './capabilities'
import { nativeEffectTriggers, type NativeEffectContext, type NativeEffectTrigger } from './native-effect'
import { normalizeParams } from './parameters'
import { freezeContent } from './immutable'

export type EffectSourceKind = 'skill' | 'petMark' | 'battleMark'
export function effectSourceKind(context: EffectContext<EffectTrigger>): EffectSourceKind | undefined {
  if (context.source instanceof SkillInstance) return context.source.owner instanceof Pet ? 'skill' : undefined
  if (context.source.owner instanceof Pet) return 'petMark'
  return context.source.owner === context.battle ? 'battleMark' : undefined
}
export interface CompiledTrigger {
  readonly id: string
  readonly trigger: NativeEffectTrigger
  readonly params: unknown
  readonly available: readonly CapabilityNeed[]
  readonly matches: (context: EffectContext<EffectTrigger>) => boolean
  readonly runtime: (context: EffectContext<EffectTrigger>) => ActionRuntime
}
export interface RegisteredTrigger {
  readonly id: string
  readonly trigger: NativeEffectTrigger
  readonly params: TObject
  readonly provides: Readonly<Partial<Record<EffectSourceKind, readonly CapabilityNeed[]>>>
  readonly compile: (input: unknown, sourceKind: EffectSourceKind) => CompiledTrigger
}
const registeredTriggers = new WeakSet<RegisteredTrigger>()
export function isRegisteredTrigger(trigger: RegisteredTrigger): boolean {
  return registeredTriggers.has(trigger)
}

/** Trusted trigger adapters explicitly describe guarantees for each supported source kind. */
export function defineTrigger<S extends TObject, T extends NativeEffectTrigger>(definition: {
  readonly id: string
  readonly trigger: T
  readonly params: S
  readonly provides: RegisteredTrigger['provides']
  readonly matches?: (context: NativeEffectContext<T>, params: Readonly<Static<S>>) => boolean
  readonly resolve: (context: NativeEffectContext<T>, params: Readonly<Static<S>>) => Partial<ActionCapabilities>
}): RegisteredTrigger {
  if (!definition.id || !nativeEffectTriggers.includes(definition.trigger))
    throw new Error('Invalid trigger definition')
  const { id, trigger, matches, resolve } = definition
  const params = freezeContent(Value.Clone(definition.params))
  const provides = freezeContent(Value.Clone(definition.provides))
  for (const [kind, needs] of Object.entries(provides)) {
    if (
      !['skill', 'petMark', 'battleMark'].includes(kind) ||
      !Array.isArray(needs) ||
      new Set(needs).size !== needs.length ||
      needs.some(need => !isCapabilityNeed(need))
    )
      throw new Error('Invalid trigger capability guarantees')
  }
  const result: RegisteredTrigger = Object.freeze({
    id,
    trigger,
    params,
    provides,
    compile(input: unknown, sourceKind: EffectSourceKind) {
      const available = provides[sourceKind]
      if (!available) throw new Error(`CAPABILITY_MISMATCH: ${id} does not support ${sourceKind}`)
      const args = normalizeParams(params, input)
      const accepts = (context: EffectContext<EffectTrigger>) =>
        context.trigger === trigger && effectSourceKind(context) === sourceKind
      const correlate = (context: EffectContext<EffectTrigger>) => context as NativeEffectContext<T>
      return Object.freeze({
        id,
        trigger,
        params: args,
        available,
        matches(context: EffectContext<EffectTrigger>) {
          return accepts(context) && (matches?.(correlate(context), args) ?? true)
        },
        runtime(context: EffectContext<EffectTrigger>) {
          if (!accepts(context)) throw new Error('Mismatched trigger source or event')
          const capabilities = resolve(correlate(context), args)
          for (const need of available)
            if (capabilities[need] === undefined) throw new Error(`Missing trigger capability: ${need}`)
          return { effect: context, capabilities }
        },
      })
    },
  })
  registeredTriggers.add(result)
  return result
}
