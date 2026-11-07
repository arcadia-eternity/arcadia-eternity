// Reviewed native behavior; edit this TypeScript source directly.
import {
  EffectTrigger,
  compileEffect,
  defineEffect,
  conditions,
  contexts,
  targets,
  checks,
  ops,
  actions,
} from '@arcadia-eternity/battle/v4/authoring'
export function createGeneratedDamageThresholds() {
  return Object.freeze({
    effect_mark_damage_cap_half_max_hp: compileEffect(
      defineEffect({
        id: 'effect_mark_damage_cap_half_max_hp',
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.selfBeDamaged,
        apply: actions.sequence(
          contexts.damage.apply(
            ops.setDamageThreshold({
              max: targets.ownerPet
                .select(pet => pet.stat.maxHp)
                .first()
                .map(n => Math.floor(n / 2)),
            }),
          ),
        ),
      }),
    ),
    effect_skill_min_damage_100: compileEffect(
      defineEffect({
        id: 'effect_skill_min_damage_100',
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(contexts.damage.apply(ops.setDamageThreshold({ min: 100 }))),
      }),
    ),
    effect_skill_min_damage_95: compileEffect(
      defineEffect({
        id: 'effect_skill_min_damage_95',
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(contexts.damage.apply(ops.setDamageThreshold({ min: 95 }))),
      }),
    ),
    effect_skill_minimum_damage_100_if_aideminyi: compileEffect(
      defineEffect({
        id: 'effect_skill_minimum_damage_100_if_aideminyi',
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_aideminyi').condition(checks.exists()),
        ),
        apply: actions.sequence(contexts.damage.apply(ops.setDamageThreshold({ min: 100 }))),
      }),
    ),
    effect_skill_save_hp_to_1: compileEffect(
      defineEffect({
        id: 'effect_skill_save_hp_to_1',
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          contexts.damage.apply(
            ops.setDamageThreshold({
              max: targets.opponentActive
                .select(pet => pet.currentHp)
                .first()
                .map(n => n + -1),
            }),
          ),
        ),
      }),
    ),
  })
}
export const generatedDamageThresholds = createGeneratedDamageThresholds()
