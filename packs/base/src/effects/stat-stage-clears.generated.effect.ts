import { effectGroup } from '@arcadia-eternity/battle/effect-loading'
// Reviewed native behavior; edit this TypeScript source directly.
import {
  defineEffects,
  EffectTrigger,
  conditions,
  contexts,
  targets,
  checks,
  ops,
  actions,
} from '@arcadia-eternity/battle/authoring'
@effectGroup({ id: 'stat-stage-clears.generated' })
export class StatStageClearsGeneratedEffects {
  static build() {
    return defineEffects({
      effect_skill_clear_opponent_atk_spa_stage: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.opponentActive.apply(ops.clearStatStages({ stats: ['atk', 'spa'], strategy: 'positive' })),
        ),
      },
      effect_skill_clear_opponent_def_spd_stage: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.opponentActive.apply(ops.clearStatStages({ stats: ['def', 'spd'], strategy: 'positive' })),
        ),
      },
      effect_skill_clear_opponent_def_stage_if_has_mark_yinghua: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_yinghua')),
          ),
        ),
        apply: actions.sequence(
          targets.opponentActive.apply(ops.clearStatStages({ stats: ['def'], strategy: 'positive' })),
        ),
      },
      effect_skill_clear_opponent_spd_stage_if_has_mark_yinghua: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_yinghua')),
          ),
        ),
        apply: actions.sequence(
          targets.opponentActive.apply(ops.clearStatStages({ stats: ['spd'], strategy: 'positive' })),
        ),
      },
      effect_skill_clear_opponent_spe_stage: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.opponentActive.apply(ops.clearStatStages({ stats: ['spe'], strategy: 'positive' })),
        ),
      },
      effect_skill_clear_self_negative_stage: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(targets.ownerPet.apply(ops.clearStatStages({ stats: [], strategy: 'negative' }))),
      },
      effect_skill_clear_self_negative_stage_if_field_yemu: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.battle
            .flatMap(battle => battle.marks)
            .where(mark => mark.baseId === 'mark_global_yemu')
            .condition(checks.exists()),
        ),
        apply: actions.sequence(targets.ownerPet.apply(ops.clearStatStages({ stats: [], strategy: 'negative' }))),
      },
      effect_skill_clear_stage: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(targets.ownerPet.apply(ops.clearStatStages({ stats: [], strategy: 'negative' }))),
      },
      effect_skill_opponent_clear_stage: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(targets.opponentActive.apply(ops.clearStatStages({ stats: [], strategy: 'positive' }))),
      },
      effect_skill_opponent_clear_stage_hit_or_miss: {
        triggers: [EffectTrigger.BeforeHit, EffectTrigger.OnMiss],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(targets.opponentActive.apply(ops.clearStatStages({ stats: [], strategy: 'positive' }))),
      },
      effect_skill_reverse_self_negative_stage: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(targets.ownerPet.apply(ops.reverseStatStages({ stats: [], strategy: 'negative' }))),
      },
    })
  }
}

export const generatedStatStageClears = StatStageClearsGeneratedEffects.build()
