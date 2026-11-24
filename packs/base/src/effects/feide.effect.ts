import {
  actions,
  conditions,
  contexts,
  DamageType,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

const TERROR = 'mark_kongju'
const SILENCE = 'mark_chenmo'
const DAMAGE_DOWN = 'mark_shoudaoshanghaijianshao'
const EVASION_UP = 'mark_shanbitisheng'
const RAGE_REFILL = 'mark_manhuinuqi'
const MAD_STRAW = 'mark_fengkuangdaocao'
const CARNIVAL = 'mark_kuanghuanqu'
const ZUOGU = 'mark_zuogu'
const YOUPAN = 'mark_youpan'
const ZHANQIAN = 'mark_zhanqian'
const YANGHOU = 'mark_yanghou'

const attackDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Physical || event.damageType === DamageType.Special),
)

const isNextTurn = targets.sourceMark.condition((_, marks) => marks.some(mark => mark.duration === 1))
const opponentHasTerror = targets.opponentActive.condition((_, pets) =>
  pets.some(pet => pet.marks.some(mark => mark.baseId === TERROR && mark.isActive)),
)

const ownerLevelHigherThanTarget = contexts.skillUse.condition((_, events) => {
  const event = events[0]
  if (!event?.actualTarget) return false
  return event.pet.level > event.actualTarget.level
})

const ownerMovedSecond = contexts.skillUse.condition((_, events) => {
  const event = events[0]
  if (!event) return false
  const turn = event.parent
  return turn.contexts.indexOf(event) > 0
})

const ownerMovedFirst = contexts.skillUse.condition((_, events) => {
  const event = events[0]
  if (!event) return false
  const turn = event.parent
  return turn.contexts.indexOf(event) === 0
})

@effectGroup({ id: 'feide' })
export class FeideEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const terror = marks.get(TERROR)
    const silence = marks.get(SILENCE)
    const damageDown = marks.get(DAMAGE_DOWN)
    const evasionUp = marks.get(EVASION_UP)
    const rageRefill = marks.get(RAGE_REFILL)
    const madStraw = marks.get(MAD_STRAW)
    const carnival = marks.get(CARNIVAL)
    const zuogu = marks.get(ZUOGU)
    const youpan = marks.get(YOUPAN)
    const zhanqian = marks.get(ZHANQIAN)
    const yanghou = marks.get(YANGHOU)
    if (
      !terror ||
      !silence ||
      !damageDown ||
      !evasionUp ||
      !rageRefill ||
      !madStraw ||
      !carnival ||
      !zuogu ||
      !youpan ||
      !zhanqian ||
      !yanghou
    ) {
      throw new Error('Missing Feide mark dependency')
    }

    const opponentActive = targets.opponentActive
    const ownerPet = targets.ownerPet

    const applySilence = opponentActive.apply(ops.addMark(silence))
    const applyMadStraw = ownerPet.apply(ops.addMark(madStraw, { stack: 1 }))
    const applyCarnival = opponentActive.apply(ops.addMark(carnival, { stack: 1 }))
    const applyEvasionUp = ownerPet.apply(ops.addMark(evasionUp, { stack: 1 }))
    const applyRageRefill = ownerPet.apply(ops.addMark(rageRefill, { stack: 1 }))
    const applyZuogu = ownerPet.apply(ops.addMark(zuogu, { stack: 1 }))
    const applyYoupan = ownerPet.apply(ops.addMark(youpan, { stack: 1 }))
    const applyZhanqian = ownerPet.apply(ops.addMark(zhanqian, { stack: 1 }))
    const applyYanghou = ownerPet.apply(ops.addMark(yanghou, { stack: 1 }))

    const rollFear = conditions.chance(10)
    const rollSilence = conditions.chance(10)

    const healFromDamage = ownerPet.apply(
      ops.heal(contexts.damageResult.select(result => Math.floor(result.hpLoss * 0.5)).first()),
    )

    return defineEffects({
      effect_ability_increase_attack_damage_5_percent: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, attackDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 5, delta: 0 })),
      },
      effect_ability_reduce_rage_gain_5: {
        triggers: [EffectTrigger.BeforeRageGain],
        priority: 0,
        when: conditions.ownerReceivesRage,
        apply: contexts.rage.apply(ops.modifyRage({ percent: 0, delta: -5 })),
      },
      effect_emblem_sure_hit_if_opponent_has_kongju: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasTerror),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_skill_add_mark_self_zuogu: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: applyZuogu,
      },
      effect_skill_add_mark_self_youpan: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: applyYoupan,
      },
      effect_skill_add_mark_self_zhanqian: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: applyZhanqian,
      },
      effect_skill_add_mark_self_yanghou: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: applyYanghou,
      },
      effect_skill_double_power_if_level_above_target_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ownerLevelHigherThanTarget),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      },
      effect_skill_add_mark_opponent_kongju_10_percent: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, rollFear),
        apply: opponentActive.apply(ops.addMark(terror)),
      },
      effect_skill_add_mark_opponent_kongju: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: opponentActive.apply(ops.addMark(terror)),
      },
      effect_skill_increase_accuracy_50_if_level_above_target_before_check: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ownerLevelHigherThanTarget),
        apply: contexts.skillUse.apply(ops.addAccuracy(50)),
      },
      effect_skill_heal_50_percent_damage_dealt: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: healFromDamage,
      },
      effect_skill_add_mark_opponent_chenmo_10_percent: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, rollSilence),
        apply: applySilence,
      },
      effect_skill_sure_crit_if_acting_after_first_before_check: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ownerMovedSecond),
        apply: contexts.skillUse.apply(ops.setSureCrit()),
      },
      effect_skill_sure_crit_if_acting_first_before_check: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ownerMovedFirst),
        apply: contexts.skillUse.apply(ops.setSureCrit()),
      },
      effect_skill_add_mark_self_fengkuangdaocao_and_opponent_kuanghuanqu: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(applyMadStraw, applyCarnival),
      },
      effect_skill_add_mark_self_shanbitisheng_and_manhuinuqi: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(applyEvasionUp, applyRageRefill),
      },
      effect_skill_add_mark_shoudaoshanghaijianshao_30: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.addMark(damageDown, { stack: 30 })),
      },
      effect_skill_heal_self_17_percent_max_hp_on_defeat_opponent: {
        triggers: [EffectTrigger.OnDefeat],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.damageTargetBelongsToOtherPlayer),
        apply: ownerPet.apply(
          ops.heal(
            ownerPet
              .first()
              .attribute('maxHp')
              .map(hp => Math.floor(hp * 0.17)),
          ),
        ),
      },
      effect_mark_add_power_35_to_youpan_next_turn: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          isNextTurn,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_youpan')),
        ),
        apply: contexts.skillUse.apply(ops.addPower(35)),
      },
      effect_mark_add_power_35_to_zuogu_next_turn: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          isNextTurn,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_zuogu')),
        ),
        apply: contexts.skillUse.apply(ops.addPower(35)),
      },
      effect_mark_sure_hit_for_yanghou_next_turn: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          isNextTurn,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_yanghou')),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_mark_sure_hit_for_zhanqian_next_turn: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          isNextTurn,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_zhanqian')),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_mark_increase_attack_damage_received_75_percent_next_turn: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, attackDamage, isNextTurn),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 75, delta: 0 })),
      },
      effect_mark_remove_self_on_owner_switch_out: {
        triggers: [EffectTrigger.OnSwitchOut],
        when: conditions.ownerIsActive,
        apply: targets.sourceMark.apply(ops.removeMark()),
      },
      effect_mark_deal_opponent_max_hp_half_to_owner_on_expiry: {
        triggers: [EffectTrigger.OnMarkDurationEnd],
        priority: 0,
        apply: ownerPet.apply(
          ops.dealDamage(
            targets.opponentActive
              .first()
              .attribute('maxHp')
              .map(hp => Math.floor(hp / 2)),
          ),
        ),
      },
      effect_mark_add_owner_evasion_35_on_created: {
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        apply: ownerPet.apply(ops.addAttributeModifier('evasion', 'delta', 35)),
      },
      effect_mark_set_owner_rage_100_on_dodge: {
        triggers: [EffectTrigger.OnMiss],
        priority: 0,
        when: conditions.all(conditions.ownerIsActive, conditions.ownerIsSkillTarget),
        apply: ownerPet.apply(ops.setRage(100)),
      },
    })
  }
}
