import {
  actions,
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

@effectGroup({ id: 'kadunjiujiu_171' })
export class Kadunjiujiu171Effects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const damageReduction = marks.get('mark_shoudaoshanghaijianshao')
    if (!damageReduction) throw new Error('Missing damage reduction mark')

    const applyDamageReduction = targets.opponentActive.apply(ops.addMark(damageReduction, { stack: 50, duration: 3 }))

    return defineEffects({
      effect_ability_raise_attack_skill_priority_1_10_percent: {
        triggers: [EffectTrigger.BeforeSort],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, events) =>
            events.some(event => event.skill.base.category === 'Physical' || event.skill.base.category === 'Special'),
          ),
          conditions.chance(10),
        ),
        apply: contexts.skillUse.property('priority').apply(ops.add(1)),
      },
      effect_emblem_set_xinlingsuo_sure_hit: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.base.id === 'skill_xinlingsuo')),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit(0)),
      },
      effect_skill_raise_spe_1_stage_and_halve_weight_before_hit: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.ownerPet.apply(ops.changeStatStage('spe', 1)),
          targets.ownerPet.apply(ops.addAttributeModifier('weight', 'percent', -50)),
        ),
      },
      effect_skill_add_mark_opponent_shoudaoshanghaijianshao_50_for_3_turns: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: applyDamageReduction,
      },
    })
  }
}
