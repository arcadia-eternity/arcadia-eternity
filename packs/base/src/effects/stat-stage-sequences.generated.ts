// Reviewed native behavior; edit this TypeScript source directly.
import {
  EffectTrigger,
  selectFrom,
  compileEffect,
  defineEffect,
  conditions,
  targets,
  checks,
  ops,
  actions,
  type EffectFrame,
} from '@arcadia-eternity/battle/v4/authoring'
export function createGeneratedStatStageSequences() {
  return Object.freeze({
    effect_mark_raise_def_1_when_hit_and_remove_self: compileEffect(
      defineEffect({
        id: 'effect_mark_raise_def_1_when_hit_and_remove_self',
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.selfBeDamaged,
        apply: actions.sequence(
          targets.ownerPet.apply(ops.changeStatStage('def', 1)),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      }),
    ),
    effect_skill_consume_heianwuzhi_reduce_opponent_spd_1_stage: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_heianwuzhi_reduce_opponent_spd_1_stage',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(
            targets.opponentMarks
              .where(mark => mark.baseId === 'mark_heianwuzhi')
              .select(mark => mark.stack)
              .all(),
          )
          const right = 0
          return right !== undefined && left.some(value => value > right)
        }),
        apply: actions.sequence(
          targets.opponentMarks.where(mark => mark.baseId === 'mark_heianwuzhi').apply(ops.consumeStacks(1)),
          targets.opponentActive.apply(ops.changeStatStage('spd', -1)),
        ),
      }),
    ),
    effect_skill_consume_huanxiang_raise_spa_1_stage: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_huanxiang_raise_spa_1_stage',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_huanxiang').condition(checks.exists()),
        ),
        apply: actions.sequence(
          targets.ownerMarks.where(mark => mark.baseId === 'mark_huanxiang').apply(ops.consumeStacks(1)),
          targets.ownerPet.apply(ops.changeStatStage('spa', 1)),
        ),
      }),
    ),
    effect_skill_consume_huanxiang_raise_spd_1_stage: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_huanxiang_raise_spd_1_stage',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_huanxiang').condition(checks.exists()),
        ),
        apply: actions.sequence(
          targets.ownerMarks.where(mark => mark.baseId === 'mark_huanxiang').apply(ops.consumeStacks(1)),
          targets.ownerPet.apply(ops.changeStatStage('spd', 1)),
        ),
      }),
    ),
    effect_skill_raise_atk_1_stage_and_other_1_stage: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_atk_1_stage_and_other_1_stage',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.ownerPet.apply(ops.changeStatStage('atk', 1)),
          targets.ownerPet.apply((ctx, pets) => {
            const stat = ctx.read(
              selectFrom(['def', 'spd', 'spa', 'spe'] as const)
                .shuffled()
                .first(),
            )
            if (stat !== undefined) ops.changeStatStage(stat, 1)(ctx, pets)
          }),
        ),
      }),
    ),
    effect_skill_raise_atk_def_1_stage_if_male: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_atk_def_1_stage_if_male',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerPet.condition((_ctx, pets) => pets.some(pet => pet.gender === 'Male')),
        ),
        apply: actions.sequence(
          targets.ownerPet.apply(ops.changeStatStage('atk', 1)),
          targets.ownerPet.apply(ops.changeStatStage('def', 1)),
        ),
      }),
    ),
    effect_skill_raise_both_spe_1_stage: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_both_spe_1_stage',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.ownerPet.apply(ops.changeStatStage('spe', 1)),
          targets.opponentActive.apply(ops.changeStatStage('spe', 1)),
        ),
      }),
    ),
    effect_skill_raise_spa_spd_1_stage_if_female: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_spa_spd_1_stage_if_female',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerPet.condition((_ctx, pets) => pets.some(pet => pet.gender === 'Female')),
        ),
        apply: actions.sequence(
          targets.ownerPet.apply(ops.changeStatStage('spa', 1)),
          targets.ownerPet.apply(ops.changeStatStage('spd', 1)),
        ),
      }),
    ),
    effect_skill_reduce_both_spa_1_stage: compileEffect(
      defineEffect({
        id: 'effect_skill_reduce_both_spa_1_stage',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.ownerPet.apply(ops.changeStatStage('spa', -1)),
          targets.opponentActive.apply(ops.changeStatStage('spa', -1)),
        ),
      }),
    ),
    effect_skill_reduce_opponent_atk_def_1_stage_if_opponent_male: compileEffect(
      defineEffect({
        id: 'effect_skill_reduce_opponent_atk_def_1_stage_if_opponent_male',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) => pets.some(pet => pet.gender === 'Male')),
        ),
        apply: actions.sequence(
          targets.opponentActive.apply(ops.changeStatStage('atk', -1)),
          targets.opponentActive.apply(ops.changeStatStage('def', -1)),
        ),
      }),
    ),
    effect_skill_reduce_opponent_spa_spd_1_stage_if_opponent_female: compileEffect(
      defineEffect({
        id: 'effect_skill_reduce_opponent_spa_spd_1_stage_if_opponent_female',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) => pets.some(pet => pet.gender === 'Female')),
        ),
        apply: actions.sequence(
          targets.opponentActive.apply(ops.changeStatStage('spa', -1)),
          targets.opponentActive.apply(ops.changeStatStage('spd', -1)),
        ),
      }),
    ),
  })
}
export const generatedStatStageSequences = createGeneratedStatStageSequences()
