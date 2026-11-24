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

const PARALYSIS = 'mark_mabi'

const opponentRageAbove50 = targets.opponentActive.condition((_, pets) => (pets[0]?.currentRage ?? 0) > 50)
const opponentRageBelow50 = targets.opponentActive.condition((_, pets) => (pets[0]?.currentRage ?? 0) < 50)

const specialDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Special),
)

const attackDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Physical || event.damageType === DamageType.Special),
)

const physicalSkill = contexts.skillUse.condition((_, events) =>
  events.some(event => event.skill.category === 'Physical'),
)

const opponentActive = targets.opponentActive
const ownerPet = targets.ownerPet

const skillIs = (id: string) =>
  contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === id))

@effectGroup({ id: 'azi' })
export class AziEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const paralysis = marks.get(PARALYSIS)
    if (!paralysis) throw new Error('Missing paralysis mark')

    return defineEffects({
      effect_ability_increase_special_damage_5_percent: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, specialDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 5, delta: 0 })),
      },
      effect_ability_add_physical_skill_accuracy_5_percent: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, physicalSkill),
        apply: contexts.skillUse.apply(ops.addAccuracy(5)),
      },
      effect_emblem_add_self_rage_20_when_using_tiaoxin: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_tiaoxin')),
        apply: ownerPet.apply(ops.addRage(20)),
      },
      effect_skill_add_priority_1_if_opponent_rage_above_50: {
        triggers: [EffectTrigger.BeforeSort],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentRageAbove50),
        apply: contexts.skillUse.property('priority').apply(ops.add(1)),
      },
      effect_skill_add_priority_1_if_opponent_rage_below_50: {
        triggers: [EffectTrigger.BeforeSort],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentRageBelow50),
        apply: contexts.skillUse.property('priority').apply(ops.add(1)),
      },
      effect_skill_add_power_40_if_opponent_rage_above_50: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentRageAbove50),
        apply: contexts.skillUse.apply(ops.addPower(40)),
      },
      effect_skill_add_power_40_if_opponent_rage_below_50: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentRageBelow50),
        apply: contexts.skillUse.apply(ops.addPower(40)),
      },
      effect_skill_raise_spd_1_stage_if_opponent_rage_below_50: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentRageBelow50),
        apply: ownerPet.apply(ops.changeStatStage('spd', 1)),
      },
      effect_skill_add_mark_opponent_mabi_40_percent: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.chance(40)),
        apply: opponentActive.apply(ops.addMark(paralysis)),
      },
      effect_skill_raise_def_1_stage_if_opponent_rage_above_50: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentRageAbove50),
        apply: ownerPet.apply(ops.changeStatStage('def', 1)),
      },
      effect_skill_min_physical_special_damage_100: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, attackDamage),
        apply: contexts.damage.apply(ops.setDamageThreshold({ min: 100 })),
      },
      effect_skill_add_multihit_1_if_opponent_rage_below_50: {
        triggers: [EffectTrigger.BeforeMultiHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentRageBelow50),
        apply: contexts.skillUse.apply(ops.addMultihitResult(1)),
      },
      effect_skill_deal_75_fixed_damage_to_skill_target_if_opponent_rage_above_50_on_hit: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentRageAbove50),
        apply: contexts.skillUse
          .flatMap(event => (event.actualTarget ? [event.actualTarget] : []))
          .apply(ops.dealDamage(75)),
      },
      effect_skill_heal_self_25_percent_max_hp_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(
          ops.heal(
            ownerPet
              .first()
              .attribute('maxHp')
              .map(maxHp => Math.floor(maxHp * 0.25)),
          ),
        ),
      },
      effect_skill_add_opponent_rage_20_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: opponentActive.apply(ops.addRage(20)),
      },
    })
  }
}
