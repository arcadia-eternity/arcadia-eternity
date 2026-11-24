import {
  DamageType,
  actions,
  checks,
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  numberParam,
  ops,
  targets,
  values,
  type Action,
  type Condition,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'
import { physicalOrSpecialDamage } from './damage-conditions'
import { activeOpponentMarks, requireMark } from './mark-queries'

const ZHUILUO = 'mark_zhuiluo'
const ZHIKONG = 'mark_zhikong'
const LIUXIE = 'mark_liuxie'
const FANGONG = 'mark_fangong'

const MOON_TAG = 'moon'
const EARTH_TAG = 'earth'

const weakeningChance = numberParam({ default: 70, tags: ['skill_effect_probability'] })

@effectGroup({ id: 'yinji' })
export class YinjiEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const zhuiluo = requireMark(marks, ZHUILUO)
    const zhikong = requireMark(marks, ZHIKONG)
    const liuxie = requireMark(marks, LIUXIE)
    const fangong = requireMark(marks, FANGONG)

    const opponentHasZhuiluo = activeOpponentMarks(ZHUILUO).condition(checks.exists())
    const opponentHasZhikong = activeOpponentMarks(ZHIKONG).condition(checks.exists())

    const skillHasTag = (tag: string): Condition =>
      contexts.skillUse.condition((_, events) => events.some(event => event.skill.tags.includes(tag)))

    const moonSkill = skillHasTag(MOON_TAG)
    const earthSkill = skillHasTag(EARTH_TAG)

    const applyZhuiluo = targets.opponentActive.apply(ops.addMark(zhuiluo))
    const applyZhikong = targets.opponentActive.apply(ops.addMark(zhikong))

    const weakenAtk = targets.opponentActive.apply(ops.changeStatStage('atk', -1))
    const weakenSpa = targets.opponentActive.apply(ops.changeStatStage('spa', -1))

    const boostAtk = targets.ownerPet.apply(ops.changeStatStage('atk', 1))
    const boostSpe = targets.ownerPet.apply(ops.changeStatStage('spe', 1))

    const addFangong = targets.ownerPet.apply(ops.addMark(fangong, { stack: 1 }))

    const addStrongBleed = targets.opponentActive.apply(ops.addMark(liuxie, { stack: 50, duration: 3 }))

    const addWeightDamage = targets.opponentActive.apply(
      ops.dealDamage(targets.opponentActive.select(pet => pet.stat.weight).first(), { damageType: DamageType.Effect }),
    )

    const ignoreDefenseStages = contexts.skillUse.apply(ops.setIgnoreStageStrategy('positive'))

    const sureCrit = contexts.skillUse.apply(ops.setSureCrit())

    const addPower35 = contexts.skillUse.apply(ops.addPower(35))

    const setMultihit3to5 = contexts.skillUse.apply(ops.setMultihit(values.randomInt(3, 5)))

    const roll10 = conditions.chance(10)
    const roll70 = conditions.chance(weakeningChance)

    const firstMoveDamageBoost: Action = contexts.damage.apply(ops.modifyDamage({ percent: 25, delta: 0 }))

    return defineEffects({
      effect_mark_reduce_spe_45_on_create: {
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        apply: targets.ownerPet.apply(ops.addAttributeModifier('spe', 'delta', -45)),
      },
      effect_mark_make_targeted_skill_sure_hit_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.ownerIsSkillTarget,
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_mark_deal_35_damage_to_attacker_70_percent_on_attack_damage: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, physicalOrSpecialDamage, conditions.chance(70)),
        apply: targets.damageOriginPet.apply(ops.dealDamage(35)),
      },
      effect_ability_add_mark_opponent_zhuiluo_on_moon_skill_hit: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, moonSkill),
        apply: applyZhuiluo,
      },
      effect_ability_add_mark_opponent_zhikong_on_earth_skill_hit: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, earthSkill),
        apply: applyZhikong,
      },
      effect_emblem_amplify_outgoing_attack_damage_25_percent_if_first: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.firstSkillThisTurn, physicalOrSpecialDamage),
        apply: firstMoveDamageBoost,
      },
      effect_skill_add_mark_self_fangong_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: addFangong,
      },
      effect_skill_add_power_35_if_opponent_has_zhuiluo_on_calculate_damage: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasZhuiluo),
        apply: addPower35,
      },
      effect_skill_add_mark_opponent_liuxie_50_for_3_turns_if_zhikong: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasZhikong),
        apply: addStrongBleed,
      },
      effect_skill_ignore_opponent_positive_stages_if_zhuiluo: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasZhuiluo),
        apply: ignoreDefenseStages,
      },
      effect_skill_sure_crit_if_opponent_has_zhikong: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasZhikong),
        apply: sureCrit,
      },
      effect_skill_add_1_hit_10_percent: {
        triggers: [EffectTrigger.BeforeMultiHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, roll10),
        apply: contexts.skillUse.apply(ops.addMultihitResult(1)),
      },
      effect_skill_deal_effect_damage_equal_to_opponent_weight_if_zhuiluo: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasZhuiluo),
        apply: addWeightDamage,
      },
      effect_skill_set_3_to_5_hits_if_opponent_has_zhikong: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasZhikong),
        apply: setMultihit3to5,
      },
      effect_skill_raise_atk_spe_1_stage: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(boostAtk, boostSpe),
      },
      effect_skill_reduce_opponent_atk_1_stage_70_percent_if_zhuiluo: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        parameters: { chance: weakeningChance },
        when: conditions.all(conditions.selfUsesSkill, opponentHasZhuiluo, roll70),
        apply: weakenAtk,
      },
      effect_skill_reduce_opponent_spa_1_stage_70_percent_if_zhikong: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        parameters: { chance: weakeningChance },
        when: conditions.all(conditions.selfUsesSkill, opponentHasZhikong, roll70),
        apply: weakenSpa,
      },
    })
  }
}
