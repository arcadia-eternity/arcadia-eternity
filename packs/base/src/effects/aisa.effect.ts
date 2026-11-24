import { conditions, contexts, defineEffects, EffectTrigger, ops, targets } from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'
import { criticalDamage, isPhysicalOrSpecial } from './damage-conditions'
import { activeOwnerMarks, requireMark } from './mark-queries'

const CAIXIAZHIXIN = 'mark_caixiazhixin'
const XUANGUANGQIDIAN = 'mark_xuanguangqidian'
const SHIMING = 'mark_shiming'

const caixiazhixin = activeOwnerMarks(CAIXIAZHIXIN)
const hasCaixiazhixin = caixiazhixin.condition((_, marks) => marks.length > 0)

const critDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.crit && isPhysicalOrSpecial(event.damageType)),
)

const critHeal = (fraction: number) => {
  const healAmount = targets.ownerPet.select(pet => Math.floor(pet.stat.maxHp * fraction)).first()
  return {
    triggers: [EffectTrigger.OnDamage] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, critDamage),
    apply: targets.ownerPet.apply(ops.heal(healAmount)),
  }
}

const critRage = (amount: number) => ({
  triggers: [EffectTrigger.OnDamage] as const,
  priority: 0,
  when: conditions.all(conditions.selfUsesSkill, critDamage),
  apply: targets.ownerPet.apply(ops.addRage(amount)),
})

const critBlind = (shimingMark: Parameters<typeof ops.addMark>[0]) => ({
  triggers: [EffectTrigger.OnDamage] as const,
  priority: 0,
  when: conditions.all(conditions.selfUsesSkill, critDamage, conditions.chance(50)),
  apply: targets.opponentActive.apply(ops.addMark(shimingMark)),
})

@effectGroup({ id: 'aisa' })
export class AisaEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const caixiazhixinMark = requireMark(marks, CAIXIAZHIXIN)
    const xuanguangqidianMark = requireMark(marks, XUANGUANGQIDIAN)
    const shimingMark = requireMark(marks, SHIMING)

    return defineEffects({
      effect_ability_add_crit_rate_5_percent_before_check: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(ops.addCritRate(5)),
      },
      effect_emblem_add_accuracy_5_percent_if_has_mark_caixiazhixin: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasCaixiazhixin),
        apply: contexts.skillUse.apply(ops.addAccuracy(5)),
      },
      effect_skill_add_mark_self_caixiazhixin_3_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(caixiazhixinMark, { stack: 3 })),
      },
      effect_skill_heal_16_percent_max_hp_on_crit_damage: critHeal(0.16),
      effect_skill_add_rage_15_on_crit_damage: critRage(15),
      effect_skill_add_mark_opponent_shiming_50_percent_on_crit_damage: critBlind(shimingMark),
      effect_skill_add_mark_self_xuanguangqidian_1_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(xuanguangqidianMark, { stack: 1 })),
      },
      effect_skill_add_rage_20_on_crit_damage: critRage(20),
      effect_mark_increase_crit_rate_15_percent_per_stack_before_check: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(ops.addCritRate(targets.sourceMark.select(mark => mark.stack * 15).first())),
      },
      effect_mark_remove_self_on_crit_damage_dealt: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, critDamage),
        apply: targets.sourceMark.apply(ops.removeMark()),
      },
      effect_mark_increase_crit_damage_50_percent: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, criticalDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 50, delta: 0 })),
      },
    })
  }
}
