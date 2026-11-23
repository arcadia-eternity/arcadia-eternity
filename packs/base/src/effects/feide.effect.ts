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
      effect_feide_ability_damage_up: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, attackDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 5, delta: 0 })),
      },
      effect_feide_ability_rage_loss: {
        triggers: [EffectTrigger.BeforeRageGain],
        priority: 0,
        when: conditions.ownerReceivesRage,
        apply: contexts.rage.apply(ops.modifyRage({ percent: 0, delta: -5 })),
      },
      effect_feide_emblem_sure_hit_vs_terror: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasTerror),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_feide_skill_zuogu: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: applyZuogu,
      },
      effect_feide_skill_youpan: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: applyYoupan,
      },
      effect_feide_skill_zhanqian: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: applyZhanqian,
      },
      effect_feide_skill_yanghou: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: applyYanghou,
      },
      effect_feide_skill_kongjuguangbo_power: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ownerLevelHigherThanTarget),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      },
      effect_feide_skill_kongjuguangbo_fear: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, rollFear),
        apply: opponentActive.apply(ops.addMark(terror)),
      },
      effect_feide_skill_kongjushengbo_fear: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: opponentActive.apply(ops.addMark(terror)),
      },
      effect_feide_skill_kongjushengbo_accuracy: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ownerLevelHigherThanTarget),
        apply: contexts.skillUse.apply(ops.addAccuracy(50)),
      },
      effect_feide_skill_linghunxiqu_drain: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: healFromDamage,
      },
      effect_feide_skill_linghunchenji_silence: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, rollSilence),
        apply: applySilence,
      },
      effect_feide_skill_nixianlaiba_crit: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ownerMovedSecond),
        apply: contexts.skillUse.apply(ops.setSureCrit()),
      },
      effect_feide_skill_woxianlaiba_crit: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ownerMovedFirst),
        apply: contexts.skillUse.apply(ops.setSureCrit()),
      },
      effect_feide_skill_tianyuankuanghuanqu: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(applyMadStraw, applyCarnival),
      },
      effect_feide_skill_dengzheqiaoba: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(applyEvasionUp, applyRageRefill),
      },
      effect_feide_skill_wopawuya_reduction: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.addMark(damageDown, { stack: 30 })),
      },
      effect_feide_skill_wochaoshenle_heal: {
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
      effect_feide_mark_zuogu_power: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          isNextTurn,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_youpan')),
        ),
        apply: contexts.skillUse.apply(ops.addPower(35)),
      },
      effect_feide_mark_youpan_power: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          isNextTurn,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_zuogu')),
        ),
        apply: contexts.skillUse.apply(ops.addPower(35)),
      },
      effect_feide_mark_zhanqian_sure_hit: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          isNextTurn,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_yanghou')),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_feide_mark_yanghou_sure_hit: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          isNextTurn,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_zhanqian')),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_feide_mark_mad_straw_vulnerable: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, attackDamage, isNextTurn),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 75, delta: 0 })),
      },
      effect_feide_mark_cancel_carnival_on_switch: {
        triggers: [EffectTrigger.OnSwitchOut],
        when: conditions.ownerIsActive,
        apply: targets.sourceMark.apply(ops.removeMark()),
      },
      effect_feide_mark_carnival_end: {
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
      effect_feide_mark_shanbitisheng_evasion: {
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        apply: ownerPet.apply(ops.addAttributeModifier('evasion', 'delta', 35)),
      },
      effect_feide_mark_rage_refill_on_evade: {
        triggers: [EffectTrigger.OnMiss],
        priority: 0,
        when: conditions.all(conditions.ownerIsActive, conditions.ownerIsSkillTarget),
        apply: ownerPet.apply(ops.setRage(100)),
      },
    })
  }
}
