import {
  EffectTrigger,
  actions,
  checks,
  compileEffect,
  conditions,
  defineEffect,
  ops,
  selectFrom,
  targets,
  type Action,
} from '@arcadia-eternity/battle/v4/authoring'

/** Select first, then execute. Each selected action queries its target at execution time. */
function randomAction(...choices: readonly Action[]): Action {
  const chosen = selectFrom(choices).shuffled().first()
  return ctx => ctx.read(chosen)?.(ctx)
}
const when = conditions.all(
  conditions.selfUsesSkill,
  targets.ownerMarks.where(mark => mark.baseId === 'mark_emblem_wuxing').condition(checks.exists()),
  targets.opponentActive.condition((_, pets) => pets.some(pet => pet.gender === 'NoGender')),
)

/** Explicit candidates; the two flat historical choices correct eager action execution. */
export function createRandomStatActions() {
  return Object.freeze({
    effect_skill_reduce_opponent_atk_or_spa_1_stage_if_opponent_nogender_and_self_has_wuxing: compileEffect(
      defineEffect({
        id: 'effect_skill_reduce_opponent_atk_or_spa_1_stage_if_opponent_nogender_and_self_has_wuxing',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when,
        apply: randomAction(
          targets.opponentActive.apply(ops.changeStatStage('atk', -1)),
          targets.opponentActive.apply(ops.changeStatStage('spa', -1)),
        ),
      }),
    ),
    effect_skill_raise_atk_or_spe_1_stage_if_opponent_nogender_and_self_has_wuxing: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_atk_or_spe_1_stage_if_opponent_nogender_and_self_has_wuxing',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when,
        apply: randomAction(
          targets.ownerPet.apply(ops.changeStatStage('atk', 1)),
          targets.ownerPet.apply(ops.changeStatStage('spe', 1)),
        ),
      }),
    ),
    effect_skill_reduce_opponent_atk_def_or_spa_spd_1_stage_if_opponent_nogender_and_self_has_wuxing: compileEffect(
      defineEffect({
        id: 'effect_skill_reduce_opponent_atk_def_or_spa_spd_1_stage_if_opponent_nogender_and_self_has_wuxing',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when,
        apply: randomAction(
          actions.sequence(
            targets.opponentActive.apply(ops.changeStatStage('atk', -1)),
            targets.opponentActive.apply(ops.changeStatStage('def', -1)),
          ),
          actions.sequence(
            targets.opponentActive.apply(ops.changeStatStage('spa', -1)),
            targets.opponentActive.apply(ops.changeStatStage('spd', -1)),
          ),
        ),
      }),
    ),
  })
}
