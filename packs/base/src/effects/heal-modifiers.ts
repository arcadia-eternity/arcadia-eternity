import {
  EffectTrigger,
  compileEffect,
  conditions,
  contexts,
  defineEffect,
  ops,
  type Condition,
} from '@arcadia-eternity/battle/v4/authoring'

function healingModifier(id: string, percent: number, when: Condition = conditions.selfBeHealed) {
  return compileEffect(
    defineEffect({
      id,
      triggers: [EffectTrigger.OnBeforeHeal],
      when,
      apply: contexts.heal.apply(ops.modifyHeal({ percent, delta: 0 })),
    }),
  )
}

/** Current YAML candidates. Fresh instances support independent catalogs and restore. */
export function createOfficialHealModifierEffects() {
  return Object.freeze({
    effect_mark_decrease_heal: healingModifier('effect_mark_decrease_heal', -15),
    effect_mark_increase_heal_20_percent: healingModifier('effect_mark_increase_heal_20_percent', 20),
    effect_mark_increase_heal_40_percent: healingModifier('effect_mark_increase_heal_40_percent', 40),
    effect_mark_reduce_healing_50_percent: healingModifier('effect_mark_reduce_healing_50_percent', -50),
    effect_emblem_20percent_double_heal: healingModifier(
      'effect_emblem_20percent_double_heal',
      100,
      conditions.all(conditions.selfBeHealed, conditions.chance(20)),
    ),
  })
}
export const officialHealModifierEffects = createOfficialHealModifierEffects()
