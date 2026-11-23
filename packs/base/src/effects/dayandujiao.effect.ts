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

const FOCUS = 'mark_jiaodianfushi'
const POISON = 'mark_zhongdu'
const BLEED = 'mark_liuxie'
const SWARM = 'mark_global_chongqun'

const focusMarks = targets.ownerMarks.where(mark => mark.baseId === FOCUS && mark.isActive)
const hasFocus = focusMarks.condition((_, marks) => marks.some(mark => mark.stack > 0))
const opponentHasPoison = targets.opponentActive
  .flatMap(pet => pet.marks)
  .where(mark => mark.baseId === POISON && mark.isActive)
  .condition((_, marks) => marks.some(mark => mark.stack > 0))
const opponentHasBleed = targets.opponentActive
  .flatMap(pet => pet.marks)
  .where(mark => mark.baseId === BLEED && mark.isActive)
  .condition((_, marks) => marks.some(mark => mark.stack > 0))
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
  when: conditions.all(
    conditions.ownerUsesSkill,
    hasFocus,
    contexts.skillUse.condition((_, casts) => casts.some(cast => cast.category !== 'Status')),
  ),
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
  triggers: [EffectTrigger.OnBeforeCalculateDamage] as const,
  priority: 0,
  when: conditions.all(conditions.selfUsesSkill, opponentHasPoison),
  apply: contexts.damage.apply(ops.modifyDamage({ percent: 300, delta: 0 })),
}

const bleedDrain = {
  triggers: [EffectTrigger.OnDamage] as const,
  priority: 0,
  when: conditions.all(conditions.selfUsesSkill, opponentHasBleed),
  apply: targets.ownerPet.apply(ops.heal(contexts.damageResult.select(result => result.hpLoss).first())),
}

const swarmDefBoost = {
  triggers: [EffectTrigger.AfterUseSkillCheck] as const,
  priority: 0,
  when: conditions.all(conditions.selfUsesSkill, swarmActive),
  apply: targets.ownerPet.apply(ops.changeStatStage('spd', 1)),
}

const swarmSpaBoost = {
  triggers: [EffectTrigger.AfterUseSkillCheck] as const,
  priority: 0,
  when: conditions.all(conditions.selfUsesSkill, swarmActive),
  apply: targets.ownerPet.apply(ops.changeStatStage('spa', 1)),
}

const defBoost = {
  triggers: [EffectTrigger.AfterUseSkillCheck] as const,
  priority: 0,
  when: conditions.selfUsesSkill,
  apply: targets.ownerPet.apply(ops.changeStatStage('def', 1)),
}

const atkBoost = {
  triggers: [EffectTrigger.AfterUseSkillCheck] as const,
  priority: 0,
  when: conditions.selfUsesSkill,
  apply: targets.ownerPet.apply(ops.changeStatStage('atk', 1)),
}

const consecutivePower = {
  triggers: [EffectTrigger.BeforeUseSkillCheck] as const,
  priority: 0,
  when: conditions.selfUsesSkill,
  apply: contexts.skillUse.apply(
    ops.addPower(contexts.skillUse.select(event => 50 * Math.min(2, event.pet.lastSkillUsedTimes - 1)).first()),
  ),
}

@effectGroup({ id: 'dayandujiao' })
export class DayandujiaoEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const focus = marks.get(FOCUS)
    if (!focus) throw new Error('Missing focus mark')

    return defineEffects({
      effect_dayandujiao_ability_focus_power: focusPowerBonus,
      effect_dayandujiao_ability_focus_drain: focusDrain,
      effect_dayandujiao_emblem_heal_boost: {
        triggers: [EffectTrigger.OnBeforeHeal],
        priority: 0,
        when: conditions.selfBeHealed,
        apply: contexts.heal.apply(ops.modifyHeal({ percent: 5, delta: 0 })),
      },
      effect_dayandujiao_skill_jiaodianfushi: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(focus, { stack: 1 })),
      },
      effect_dayandujiao_skill_bujiuzhongji: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, skills) => {
            const skill = skills[0]
            if (!skill) return false
            const pet = skill.pet
            if (!pet) return false
            return pet.lastMissedSkillId === 'skill_yingjiazhongji'
          }),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      },
      effect_dayandujiao_skill_lingduzhongji: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, skills) => {
            const skill = skills[0]
            if (!skill) return false
            const pet = skill.pet
            if (!pet) return false
            return pet.lastMissedSkillId === 'skill_yingjiazhongji'
          }),
        ),
        apply: targets.ownerPet.apply(ops.addMark(focus, { stack: 1 })),
      },
      effect_dayandujiao_skill_chongqunqianfu: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(defBoost.apply, actions.choose(swarmActive, swarmDefBoost.apply)),
      },
      effect_dayandujiao_skill_bujiuchuanci: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, skills) => {
            const skill = skills[0]
            if (!skill) return false
            const pet = skill.pet
            if (!pet) return false
            return pet.lastMissedSkillId === 'skill_zhongjiachuanci'
          }),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      },
      effect_dayandujiao_skill_lingduchuanci: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, skills) => {
            const skill = skills[0]
            if (!skill) return false
            const pet = skill.pet
            if (!pet) return false
            return pet.lastMissedSkillId === 'skill_zhongjiachuanci'
          }),
        ),
        apply: targets.ownerPet.apply(ops.addMark(focus, { stack: 1 })),
      },
      effect_dayandujiao_skill_chongqunexi: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(atkBoost.apply, actions.choose(swarmActive, swarmSpaBoost.apply)),
      },
      effect_dayandujiao_skill_pojiaxuruo: lowHpDamageBoost,
      effect_dayandujiao_skill_wuxianzhuiji: consecutivePower,
      effect_dayandujiao_skill_duyefushi: poisonPowerQuad,
      effect_dayandujiao_skill_xueyetunshi: bleedDrain,
    })
  }
}
