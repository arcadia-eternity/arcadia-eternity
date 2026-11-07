// Reviewed native behavior; edit this TypeScript source directly.
import {
  EffectTrigger,
  compileEffect,
  defineEffect,
  conditions,
  contexts,
  targets,
  ops,
  actions,
  type EffectFrame,
} from '@arcadia-eternity/battle/v4/authoring'
export function createGeneratedContextControls() {
  return Object.freeze({
    effect_block_damage_under_60: compileEffect(
      defineEffect({
        id: 'effect_block_damage_under_60',
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, (ctx: EffectFrame) => {
          const left = ctx.read(contexts.damage.select(event => event.damageResult).first())
          const right = 60
          return left !== undefined && right !== undefined && left <= right
        }),
        apply: actions.sequence(contexts.damage.apply(ops.preventDamage())),
      }),
    ),
    effect_mark_confuse: compileEffect(
      defineEffect({
        id: 'effect_mark_confuse',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(contexts.skillUse.apply(ops.setActualTarget(targets.ownerPet.first()))),
      }),
    ),
    effect_mark_prevent_damage: compileEffect(
      defineEffect({
        id: 'effect_mark_prevent_damage',
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.sourceOwnsEvent,
        apply: actions.sequence(contexts.damage.apply(ops.preventDamage())),
      }),
    ),
    effect_skill_ignore_opponent_stat_if_hp_above_quarter: compileEffect(
      defineEffect({
        id: 'effect_skill_ignore_opponent_stat_if_hp_above_quarter',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.currentHp).first())
          const right = ctx.read(
            targets.ownerPet
              .select(pet => pet.stat.maxHp)
              .first()
              .map(n => Math.floor(n * 0.25)),
          )
          return left !== undefined && right !== undefined && left > right
        }),
        apply: actions.sequence(contexts.skillUse.apply(ops.setIgnoreStageStrategy('positive'))),
      }),
    ),
    effect_skill_ignore_stat_opponent_has_mark_kuihuazhongzi: compileEffect(
      defineEffect({
        id: 'effect_skill_ignore_stat_opponent_has_mark_kuihuazhongzi',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_kuihuazhongzi')),
          ),
        ),
        apply: actions.sequence(contexts.skillUse.apply(ops.setIgnoreStageStrategy('positive'))),
      }),
    ),
  })
}
export const generatedContextControls = createGeneratedContextControls()
