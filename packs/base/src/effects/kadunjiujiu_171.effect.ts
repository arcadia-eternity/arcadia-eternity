import {
  actions,
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
  type Action,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

const HEART_MARK = 'mark_xinzhiyinji'
const BLOOD_MARK = 'mark_xuehongyinji'
const DAMAGE_REDUCTION = 'mark_shoudaoshanghaijianshao'

const heartMarks = targets.opponentActive
  .flatMap(pet => pet.marks)
  .where(mark => (mark.baseId === HEART_MARK || mark.baseId === BLOOD_MARK) && mark.isActive)
const hasHeartMark = heartMarks.condition((_, marks) => marks.length > 0)

function selfStatBoost(stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe', amount: number, chancePercent: number) {
  return {
    triggers: [EffectTrigger.OnHit] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, conditions.chance(chancePercent)),
    apply: targets.ownerPet.apply(ops.changeStatStage(stat, amount)),
  }
}

@effectGroup({ id: 'kadunjiujiu_171' })
export class Kadunjiujiu171Effects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const bloodMark = marks.get(BLOOD_MARK)
    const damageReduction = marks.get(DAMAGE_REDUCTION)
    if (!bloodMark || !damageReduction) {
      throw new Error('Missing blood or damage reduction mark')
    }

    const applyDamageReduction = targets.opponentActive.apply(ops.addMark(damageReduction, { stack: 50, duration: 3 }))

    const applyBloodMark = targets.opponentActive.apply(ops.addMark(bloodMark, { stack: 1, duration: 3 }))

    const healQuarter = targets.ownerPet.apply(
      ops.heal(
        targets.ownerPet
          .select(pet => Math.floor(pet.stat.maxHp * 0.25))
          .first()
          .map(value => value ?? 0),
      ),
    )

    const healEighth = targets.ownerPet.apply(
      ops.heal(
        targets.ownerPet
          .select(pet => Math.floor(pet.stat.maxHp * 0.125))
          .first()
          .map(value => value ?? 0),
      ),
    )

    const sureHitWhenHeartMark: Action = actions.choose(hasHeartMark, contexts.skillUse.apply(ops.setSureHit(0)))

    const consumeHeartMark: Action = actions.choose(hasHeartMark, heartMarks.apply(ops.consumeStacks(1)))

    return defineEffects({
      effect_kadunjiujiu_171_ability_priority: {
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
      effect_kadunjiujiu_171_emblem_sure_hit: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.base.id === 'skill_xinlingsuo')),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit(0)),
      },
      effect_kadunjiujiu_171_skill_xinlianxin: {
        triggers: [EffectTrigger.BeforeUseSkillCheck, EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: (ctx => {
          if (ctx.trigger === EffectTrigger.BeforeUseSkillCheck) {
            sureHitWhenHeartMark(ctx)
          } else {
            consumeHeartMark(ctx)
          }
        }) satisfies Action<EffectTrigger.BeforeUseSkillCheck | EffectTrigger.OnHit>,
      },
      effect_kadunjiujiu_171_skill_qingyingshenzi: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.ownerPet.apply(ops.changeStatStage('spe', 1)),
          targets.ownerPet.apply(ops.addAttributeModifier('weight', 'percent', -50)),
        ),
      },
      effect_kadunjiujiu_171_skill_quanlichongfeng: selfStatBoost('atk', 1, 15),
      effect_kadunjiujiu_171_skill_fanxincuican: selfStatBoost('spa', 1, 15),
      effect_kadunjiujiu_171_skill_xinlingsuo: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: applyDamageReduction,
      },
      effect_kadunjiujiu_171_skill_xuehongyinji: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: applyBloodMark,
      },
      effect_kadunjiujiu_171_skill_xinyuan: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: (ctx => {
          const ownerPet = ctx.parent.pet
          const lastSkillUsedTimes = ownerPet.lastSkillUsedTimes
          if (lastSkillUsedTimes > 1) {
            healEighth(ctx)
          } else {
            healQuarter(ctx)
          }
        }) satisfies Action<EffectTrigger.AfterUseSkillCheck>,
      },
    })
  }
}
