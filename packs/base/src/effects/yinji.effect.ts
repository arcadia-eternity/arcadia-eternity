import {
  DamageType,
  actions,
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
  values,
  type Action,
  type Condition,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

const ZHUILUO = 'mark_zhuiluo'
const ZHIKONG = 'mark_zhikong'
const LIUXIE = 'mark_liuxie'
const LIANJI = 'mark_lianji'
const FANGONG = 'mark_fangong'

const MOON_TAG = 'moon'
const EARTH_TAG = 'earth'

@effectGroup({ id: 'yinji' })
export class YinjiEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const zhuiluo = marks.get(ZHUILUO)
    const zhikong = marks.get(ZHIKONG)
    const liuxie = marks.get(LIUXIE)
    const lianji = marks.get(LIANJI)
    const fangong = marks.get(FANGONG)
    if (!zhuiluo || !zhikong || !liuxie || !lianji || !fangong) {
      throw new Error('Missing yinji mark dependencies')
    }

    const opponentHasZhuiluo = targets.opponentActive.condition((_, pets) =>
      pets.some(pet => pet.marks.some(mark => mark.baseId === ZHUILUO && mark.isActive)),
    )
    const opponentHasZhikong = targets.opponentActive.condition((_, pets) =>
      pets.some(pet => pet.marks.some(mark => mark.baseId === ZHIKONG && mark.isActive)),
    )

    const attackDamage = contexts.damage.condition((_, events) =>
      events.some(event => event.damageType === DamageType.Physical || event.damageType === DamageType.Special),
    )

    const skillHasTag = (tag: string): Condition =>
      contexts.skillUse.condition((_, events) => events.some(event => event.skill.tags.includes(tag)))

    const moonSkill = skillHasTag(MOON_TAG)
    const earthSkill = skillHasTag(EARTH_TAG)

    const applyZhuiluo = targets.opponentActive.apply(ops.addMark(zhuiluo))
    const applyZhikong = targets.opponentActive.apply(ops.addMark(zhikong))

    const weakenAtk = targets.opponentActive.apply(ops.changeStatStage('atk', -1))
    const weakenSpe = targets.opponentActive.apply(ops.changeStatStage('spe', -1))
    const weakenSpa = targets.opponentActive.apply(ops.changeStatStage('spa', -1))

    const boostAtk = targets.ownerPet.apply(ops.changeStatStage('atk', 1))
    const boostSpe = targets.ownerPet.apply(ops.changeStatStage('spe', 1))

    const addLianji = targets.ownerPet.apply(ops.addMark(lianji, { stack: 1 }))
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
    const roll20 = conditions.chance(20)
    const roll70 = conditions.chance(70)

    const firstMoveDamageBoost: Action = contexts.damage.apply(ops.modifyDamage({ percent: 25, delta: 0 }))

    return defineEffects({
      effect_mark_zhuiluo_speed: {
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        apply: targets.ownerPet.apply(ops.addAttributeModifier('spe', 'delta', -45)),
      },
      effect_mark_zhikong_cannot_dodge: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.ownerIsSkillTarget,
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_mark_fangong_counter: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, attackDamage, conditions.chance(70)),
        apply: targets.damageOriginPet.apply(ops.dealDamage(35)),
      },
      effect_yinji_ability_moon_zhuiluo: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, moonSkill),
        apply: applyZhuiluo,
      },
      effect_yinji_ability_earth_zhikong: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, earthSkill),
        apply: applyZhikong,
      },
      effect_yinji_emblem_first_move_damage: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.firstSkillThisTurn, attackDamage),
        apply: firstMoveDamageBoost,
      },
      effect_yinji_skill_ningshenbeizhan_fangong: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: addFangong,
      },
      effect_yinji_skill_podijiaoren_weaken_spe: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, roll20),
        apply: weakenSpe,
      },
      effect_yinji_skill_podishengteng_power: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasZhuiluo),
        apply: addPower35,
      },
      effect_yinji_skill_cangyuekongzhan_bleed: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasZhikong),
        apply: addStrongBleed,
      },
      effect_yinji_skill_podibeixi_ignore_def: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasZhuiluo),
        apply: ignoreDefenseStages,
      },
      effect_yinji_skill_cangyuexuanren_sure_crit: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasZhikong),
        apply: sureCrit,
      },
      effect_yinji_skill_cangyuejirenzhan_lianji: {
        triggers: [EffectTrigger.BeforeMultiHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, roll10),
        apply: addLianji,
      },
      effect_yinji_skill_podijuexici_weight_damage: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasZhuiluo),
        apply: addWeightDamage,
      },
      effect_yinji_skill_cangyueliankongzhan_multihit: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasZhikong),
        apply: setMultihit3to5,
      },
      effect_yinji_skill_liqi_boost: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(boostAtk, boostSpe),
      },
      effect_yinji_skill_guyuedishazhan_weaken: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasZhuiluo, roll70),
        apply: weakenAtk,
      },
      effect_yinji_skill_guyuedishazhan_weaken_spa: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasZhikong, roll70),
        apply: weakenSpa,
      },
    })
  }
}
