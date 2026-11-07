import { EffectTrigger, compileEffect, defineEffect, ops, targets } from '@arcadia-eternity/battle/v4/authoring'
import type { ParameterCatalog } from '@arcadia-eternity/battle/v4'
const definitions = [
  {
    id: 'effect_emblem_fengbaozhixing_rage_boost_5',
    reference: 'effect_skill_add_rage_20_if_rage_below_40.add_rage_value',
    target: 'self',
    amount: 5,
  },
  {
    id: 'effect_emblem_dianhe_crit_rate_boost_5_percent',
    reference: 'effect_mark_increase_crit_rate_20_percent_per_stack.crit_rate_increase_per_stack',
    target: 'self',
    amount: 5,
  },
  {
    id: 'effect_emblem_shenjie_freeze_rate_boost_5_percent',
    reference: 'effect_skill_add_mark_opponent_bingdong_40_percent.bingdong_probability',
    target: 'self',
    amount: 5,
  },
  {
    id: 'effect_emblem_wuzhe_reduce_damage_increase_5_percent',
    reference: 'effect_mark_increase_damage_taken_15_percent_per_stack.mark_increase_damage_taken_per_stack',
    target: 'selfPlayer',
    amount: -5,
  },
  {
    id: 'effect_emblem_renzhe_reduce_damage_reduction_5_percent',
    reference: 'effect_mark_reduce_damage_taken_15_percent_per_stack.mark_reduce_damage_taken_per_stack',
    target: 'opponentPlayer',
    amount: -5,
  },
  {
    id: 'effect_emblem_dengxin_reduce_accuracy_5_percent_per_stack',
    reference: 'effect_mark_reduce_accuracy_5_per_stack.reduce_accuracy_per_stack',
    target: 'opponentPlayer',
    amount: -5,
  },
  {
    id: 'effect_emblem_increase_chaoshui_nishui_chance_10_percent',
    reference: 'effect_skill_add_mark_opponent_nishui_50_percent.probability',
    target: 'opponentPlayer',
    amount: 10,
  },
  {
    id: 'effect_emblem_shabaozhen_plus_5_percent_dodge',
    reference: 'effect_mark_increase_evasion_15_percent.evasion_increase',
    target: 'self',
    amount: 5,
  },
  {
    id: 'effect_emblem_increase_douzhanzhihun_fixed_damage_50_percent',
    reference: 'effect_skill_clear_rage_add_fixed_damage.multiply_value',
    target: 'self',
    amount: 0.5,
  },
] as const
export const namedParameterModifierDependencies = Object.freeze([
  ...new Set(definitions.map(d => d.reference.split('.')[0])),
])
/** Dependencies retain their own parameter catalogs; aliases resolve before effects are constructed. */
export function createNamedParameterModifiers(catalogs: ReadonlyMap<string, ParameterCatalog>) {
  return Object.freeze(
    Object.fromEntries(
      definitions.map(d => {
        const dependency = d.reference.split('.')[0]
        const catalog = catalogs.get(dependency)
        if (!catalog) throw new Error(`Missing parameter catalog: ${dependency}`)
        const target =
          d.target === 'self'
            ? targets.ownerPet
            : d.target === 'selfPlayer'
              ? targets.selfPlayer
              : targets.opponentPlayer
        return [
          d.id,
          compileEffect(
            defineEffect({
              id: d.id,
              triggers: [EffectTrigger.OnBattleStart],
              priority: 0,
              apply: target.apply(ops.addParameterModifier(catalog, d.reference, 'delta', d.amount)),
            }),
          ),
        ]
      }),
    ),
  )
}
