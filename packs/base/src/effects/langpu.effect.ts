import {
  conditions,
  contexts,
  DamageType,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

const COUNTER_CRIT = 'mark_huixin'

const attackDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Physical || event.damageType === DamageType.Special),
)

const critDamage = contexts.damage.condition((_, events) => events.some(event => event.crit))

const notCritDamage = contexts.damage.condition((_, events) => events.every(event => !event.crit))

const opponentIsIce = targets.opponentActive.condition((_, pets) => pets.some(pet => pet.element === 'Ice'))

const skillTarget = contexts.skillUse.flatMap(event => (event.actualTarget ? [event.actualTarget] : []))

function rageOnNoCrit(amount: number) {
  return {
    triggers: [EffectTrigger.OnDamage] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, notCritDamage),
    apply: targets.ownerPet.apply(ops.addRage(amount)),
  }
}

function powerOnNoCrit(bonus: number) {
  return {
    triggers: [EffectTrigger.AfterUseSkillCheck] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, notCritDamage),
    apply: contexts.skillUse.apply(ops.addPower(bonus)),
  }
}

function flatDamageOnNoCrit(amount: number) {
  return {
    triggers: [EffectTrigger.OnDamage] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, notCritDamage),
    apply: skillTarget.apply(ops.dealDamage(amount)),
  }
}

function icePowerDouble() {
  return {
    triggers: [EffectTrigger.AfterUseSkillCheck] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, opponentIsIce),
    apply: contexts.skillUse.apply(ops.amplifyPower(2)),
  }
}

@effectGroup({ id: 'langpu' })
export class LangpuEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const counterCrit = marks.get(COUNTER_CRIT)
    if (!counterCrit) throw new Error('Missing langpu mark dependency')

    return defineEffects({
      effect_ability_reduce_critical_attack_damage_taken_35_percent: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, attackDamage, critDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -35, delta: 0 })),
      },
      effect_ability_add_mark_self_huixin_after_taking_critical_attack_damage: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, attackDamage, critDamage),
        apply: targets.ownerPet.apply(ops.addMark(counterCrit)),
      },
      effect_emblem_increase_critical_attack_damage_dealt_15_percent: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, attackDamage, critDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 15, delta: 0 })),
      },
      effect_skill_add_rage_self_15_on_noncritical_damage: rageOnNoCrit(15),
      effect_skill_double_power_against_ice_opponent_after_check: icePowerDouble(),
      effect_skill_add_power_35_unless_critical_damage_after_check: powerOnNoCrit(35),
      effect_skill_deal_40_fixed_damage_on_noncritical_damage: flatDamageOnNoCrit(40),
      effect_skill_min_attack_damage_95_if_not_first_skill: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        when: conditions.all(conditions.selfUsesSkill, attackDamage, conditions.not(conditions.firstSkillThisTurn)),
        apply: contexts.damage.apply(ops.setDamageThreshold({ min: 95 })),
      },
      effect_skill_add_power_40_unless_critical_damage_after_check: powerOnNoCrit(40),
      effect_skill_deal_50_fixed_damage_on_noncritical_damage: flatDamageOnNoCrit(50),
    })
  }
}
