import { conditions, contexts, defineEffects, EffectTrigger, ops, targets } from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'
import { activeOwnerMarks, activeOpponentMarks, requireMark } from './mark-queries'
import { nonStatusSkillUse } from './skill-queries'

const FOCUS = 'mark_jiaodianfushi'
const POISON = 'mark_zhongdu'
const BLEED = 'mark_liuxie'
const SWARM = 'mark_global_chongqun'

const focusMarks = activeOwnerMarks(FOCUS)
const hasFocus = focusMarks.condition((_, marks) => marks.some(mark => mark.stack > 0))
const opponentHasPoison = activeOpponentMarks(POISON).condition((_, marks) => marks.some(mark => mark.stack > 0))
const opponentHasBleed = activeOpponentMarks(BLEED).condition((_, marks) => marks.some(mark => mark.stack > 0))
const swarmActive = contexts.battle
  .flatMap(battle => battle.marks)
  .where(mark => mark.baseId === SWARM && mark.isActive)
  .condition((_, marks) => marks.some(mark => mark.stack > 0))

const opponentLowHp = targets.opponentActive.condition((_, pets) => {
  const pet = pets[0]
  if (!pet) return false
  return pet.currentHp < pet.stat.maxHp * 0.25
})

const focusPowerBonus = {
  triggers: [EffectTrigger.AfterUseSkillCheck] as const,
  priority: 0,
  when: conditions.all(conditions.ownerUsesSkill, hasFocus, nonStatusSkillUse),
  apply: contexts.skillUse.apply(ops.addPower(5)),
}

const focusDrain = {
  triggers: [EffectTrigger.OnDamage] as const,
  priority: 0,
  when: conditions.all(conditions.selfUsesSkill, hasFocus),
  apply: targets.ownerPet.apply(
    ops.heal(contexts.damageResult.select(result => Math.floor(result.hpLoss / 4)).first()),
  ),
}

const lowHpDamageBoost = {
  triggers: [EffectTrigger.OnBeforeCalculateDamage] as const,
  priority: 0,
  when: conditions.all(conditions.selfUsesSkill, opponentLowHp),
  apply: contexts.damage.apply(ops.modifyDamage({ percent: 50, delta: 0 })),
}

const poisonPowerQuad = {
  triggers: [EffectTrigger.AfterUseSkillCheck] as const,
  when: conditions.all(conditions.selfUsesSkill, opponentHasPoison),
  apply: contexts.skillUse.apply(ops.amplifyPower(4)),
}

const bleedDrain = {
  triggers: [EffectTrigger.OnDamage] as const,
  priority: 0,
  when: conditions.all(conditions.selfUsesSkill, opponentHasBleed),
  apply: targets.ownerPet.apply(ops.heal(contexts.damageResult.select(result => result.hpLoss).first())),
}

const consecutivePower = {
  triggers: [EffectTrigger.BeforeUseSkillCheck] as const,
  priority: 0,
  when: conditions.selfUsesSkill,
  apply: contexts.skillUse.apply(
    ops.addPower(contexts.skillUse.select(event => 50 * Math.min(2, event.pet.lastSkillUsedTimes - 1)).first()),
  ),
}

function lastMissed(skillId: string) {
  return conditions.all(
    conditions.selfUsesSkill,
    ctx => contexts.nearestSkillUse(ctx)?.pet.lastMissedSkillId === skillId,
  )
}

@effectGroup({ id: 'dayandujiao' })
export class DayandujiaoEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const focus = requireMark(marks, FOCUS)

    return defineEffects({
      effect_ability_add_power_5_to_attack_if_owner_has_jiaodianfushi: focusPowerBonus,
      effect_ability_heal_25_percent_damage_dealt_if_owner_has_jiaodianfushi: focusDrain,
      effect_emblem_increase_healing_received_5_percent: {
        triggers: [EffectTrigger.OnBeforeHeal],
        priority: 0,
        when: conditions.selfBeHealed,
        apply: contexts.heal.apply(ops.modifyHeal({ percent: 5, delta: 0 })),
      },
      effect_skill_add_mark_self_jiaodianfushi_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(focus, { stack: 1 })),
      },
      effect_skill_double_power_if_last_missed_yingjiazhongji_before_check: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: lastMissed('skill_yingjiazhongji'),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      },
      effect_skill_add_mark_self_jiaodianfushi_if_last_missed_yingjiazhongji: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: lastMissed('skill_yingjiazhongji'),
        apply: targets.ownerPet.apply(ops.addMark(focus, { stack: 1 })),
      },
      effect_skill_double_power_if_last_missed_zhongjiachuanci_before_check: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: lastMissed('skill_zhongjiachuanci'),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      },
      effect_skill_add_mark_self_jiaodianfushi_if_last_missed_zhongjiachuanci: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: lastMissed('skill_zhongjiachuanci'),
        apply: targets.ownerPet.apply(ops.addMark(focus, { stack: 1 })),
      },
      effect_skill_raise_spd_1_stage_if_chongqun: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, swarmActive),
        apply: targets.ownerPet.apply(ops.changeStatStage('spd', 1)),
      },
      effect_skill_raise_spa_1_stage_if_chongqun: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, swarmActive),
        apply: targets.ownerPet.apply(ops.changeStatStage('spa', 1)),
      },
      effect_skill_increase_damage_50_percent_if_opponent_hp_below_quarter: lowHpDamageBoost,
      effect_skill_add_power_50_per_consecutive_use_max_100: consecutivePower,
      effect_skill_quadruple_power_if_opponent_has_zhongdu: poisonPowerQuad,
      effect_skill_heal_100_percent_damage_dealt_if_opponent_has_liuxie: bleedDrain,
    })
  }
}
