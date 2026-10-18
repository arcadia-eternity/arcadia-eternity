import { EffectTrigger, type effectId } from '@arcadia-eternity/const'
import { type EffectContext } from '../context'
import { Effect } from '../effect'

/** Only triggers with a concrete V4 applyEffects dispatch site belong here. */
export const nativeEffectTriggers = Object.freeze([
  EffectTrigger.OnBattleStart,
  EffectTrigger.BeforeSort,
  EffectTrigger.BeforeUseSkillCheck,
  EffectTrigger.AfterUseSkillCheck,
  EffectTrigger.BeforeMultiHit,
  EffectTrigger.BeforeHit,
  EffectTrigger.OnHit,
  EffectTrigger.OnMiss,
  EffectTrigger.PreDamage,
  EffectTrigger.OnCritPreDamage,
  EffectTrigger.OnDefeat,
  EffectTrigger.OnBeforeCalculateDamage,
  EffectTrigger.OnDamage,
  EffectTrigger.Shield,
  EffectTrigger.PostDamage,
  EffectTrigger.OnCritPostDamage,
  EffectTrigger.TurnStart,
  EffectTrigger.TurnEnd,
  EffectTrigger.OnBeforeAddMark,
  EffectTrigger.OnAnyMarkAdded,
  EffectTrigger.OnRemoveMark,
  EffectTrigger.OnMarkCreated,
  EffectTrigger.OnMarkDestroy,
  EffectTrigger.OnMarkDurationEnd,
  EffectTrigger.OnStackBefore,
  EffectTrigger.OnStack,
  EffectTrigger.OnBeforeHeal,
  EffectTrigger.OnHeal,
  EffectTrigger.OnRageGain,
  EffectTrigger.OnRageLoss,
  EffectTrigger.OnSwitchIn,
  EffectTrigger.OnSwitchOut,
  EffectTrigger.OnOwnerSwitchIn,
  EffectTrigger.OnOwnerSwitchOut,
  EffectTrigger.BeforeTransform,
  EffectTrigger.OnTransform,
  EffectTrigger.AfterTransform,
  EffectTrigger.OnTransformEnd,
  EffectTrigger.BeforeEffect,
  EffectTrigger.AfterEffect,
] as const)
export type NativeEffectTrigger = (typeof nativeEffectTriggers)[number]
export type NativeEffectContext<T extends NativeEffectTrigger> = {
  [K in T]: EffectContext<K>
}[T]

export interface NativeEffectDefinition<T extends NativeEffectTrigger> {
  readonly id: effectId
  readonly triggers: readonly T[]
  readonly priority?: number
  readonly when?: (context: NativeEffectContext<T>) => boolean
  readonly apply: (context: NativeEffectContext<T>) => void
  readonly consumesStacks?: number
  readonly tags?: readonly string[]
}

/** Trusted TS authoring seam. UGC must validate its data before constructing this definition. */
export function defineNativeEffect<const T extends NativeEffectTrigger>(
  definition: NativeEffectDefinition<T>,
): Effect<EffectTrigger> {
  if (!definition.id || definition.triggers.length === 0) throw new Error('Native effect needs an ID and triggers')
  const supported = new Set<EffectTrigger>(nativeEffectTriggers)
  if (definition.triggers.some(trigger => !supported.has(trigger))) throw new Error('Unsupported native effect trigger')
  if (new Set(definition.triggers).size !== definition.triggers.length)
    throw new Error('Duplicate native effect trigger')
  const priority = definition.priority ?? 0
  if (!Number.isFinite(priority)) throw new Error('Invalid native effect priority')
  if (
    definition.consumesStacks !== undefined &&
    (!Number.isSafeInteger(definition.consumesStacks) || definition.consumesStacks < 0)
  )
    throw new Error('Invalid native effect stack consumption')
  const apply = definition.apply
  const when = definition.when
  // The existing dispatcher constructs one context for the selected trigger. This adapter
  // preserves that object, including cancellation/success state, while exposing its union.
  const declared = new Set<EffectTrigger>(definition.triggers)
  const correlate = (context: EffectContext<EffectTrigger>): NativeEffectContext<T> => {
    if (!declared.has(context.trigger)) throw new Error('Mismatched native effect context')
    return context as NativeEffectContext<T>
  }
  const effect = new Effect<EffectTrigger>(
    definition.id,
    [...definition.triggers],
    context => apply(correlate(context)),
    priority,
    when ? context => when(correlate(context)) : undefined,
    definition.consumesStacks,
    [...(definition.tags ?? [])],
  )
  Object.freeze(effect.triggers)
  Object.freeze(effect.tags)
  Object.freeze(effect)
  return effect
}
