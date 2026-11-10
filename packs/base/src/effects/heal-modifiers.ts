import {
  defineEffects,
  EffectTrigger,
  conditions,
  contexts,
  ops,
  type Condition,
} from '@arcadia-eternity/battle/authoring'

function healingModifier(percent: number, when: Condition = conditions.selfBeHealed) {
  return {
    triggers: [EffectTrigger.OnBeforeHeal] as const,
    when,
    apply: contexts.heal.apply(ops.modifyHeal({ percent, delta: 0 })),
  }
}

/** Current YAML candidates. Fresh instances support independent catalogs and restore. */
export function createOfficialHealModifierEffects() {
  return defineEffects({
    effect_mark_decrease_heal: healingModifier(-15),
    effect_mark_increase_heal_20_percent: healingModifier(20),
    effect_mark_increase_heal_40_percent: healingModifier(40),
    effect_mark_reduce_healing_50_percent: healingModifier(-50),
    effect_emblem_20percent_double_heal: healingModifier(
      100,
      conditions.all(conditions.selfBeHealed, conditions.chance(20)),
    ),
  })
}
export const officialHealModifierEffects = createOfficialHealModifierEffects()
