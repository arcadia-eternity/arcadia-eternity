import {
  conditions,
  contexts,
  DamageType,
  defineEffects,
  EffectTrigger,
  ops,
  values,
  targets,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

const SPEED_UP = 'mark_biansu'
const GUARD_COUNTER = 'mark_yishouzhuangong'
const DODGE = 'mark_shanduo'
const LEAP = 'mark_qitiao'
const CRIT = 'mark_huixin'
const WEAKEN_IMMUNE = 'mark_mianyiruohua'

const attackDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Physical || event.damageType === DamageType.Special),
)

const firstMove = conditions.firstSkillThisTurn

function firstMovePowerMultiplier(multiplier: number) {
  return {
    triggers: [EffectTrigger.AfterUseSkillCheck] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, firstMove),
    apply: contexts.skillUse.apply(ops.amplifyPower(multiplier)),
  }
}

function firstMoveStatDrop(stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe', amount: number) {
  return {
    triggers: [EffectTrigger.OnHit] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, firstMove),
    apply: targets.opponentActive.apply(ops.changeStatStage(stat, -amount)),
  }
}

function firstMoveFlatDamage(amount: number) {
  return {
    triggers: [EffectTrigger.OnHit] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, firstMove),
    apply: targets.opponentActive.apply(ops.dealDamage(amount)),
  }
}

@effectGroup({ id: 'tiaotiaoshu' })
export class TiaotiaoshuEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const speedUp = marks.get(SPEED_UP)
    const guardCounter = marks.get(GUARD_COUNTER)
    const dodge = marks.get(DODGE)
    const leap = marks.get(LEAP)
    const crit = marks.get(CRIT)
    const weakenImmune = marks.get(WEAKEN_IMMUNE)
    if (!speedUp || !guardCounter || !dodge || !leap || !crit || !weakenImmune) {
      throw new Error('Missing tiaotiaoshu mark dependency')
    }

    return defineEffects({
      effect_tiaotiaoshu_ability_accuracy_down: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerIsSkillTarget,
          contexts.skillUse.condition((_, events) => events.some(event => event.category === 'Status')),
        ),
        apply: contexts.skillUse.apply(ops.addAccuracy(-10)),
      },
      effect_tiaotiaoshu_emblem_weaken_immune_duration: {
        triggers: [EffectTrigger.OnMarkCreated] as const,
        priority: 0,
        when: contexts.addMark.condition((_, events) => events.some(({ baseMark }) => baseMark.id === WEAKEN_IMMUNE)),
        apply: contexts.addMark.apply(ops.setMarkDuration(5)),
      },
      effect_tiaotiaoshu_skill_biansutuji: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(speedUp, { stack: 1, duration: 1 })),
      },
      effect_tiaotiaoshu_skill_suishalianji: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(ops.setMultihit(values.randomInt(2, 4))),
      },
      effect_tiaotiaoshu_skill_suishalianji_first: firstMovePowerMultiplier(2),
      effect_tiaotiaoshu_skill_shazhiqiu: {
        triggers: [EffectTrigger.BeforeHit],
        when: conditions.all(conditions.selfUsesSkill, firstMove),
        apply: targets.opponentActive.apply(ops.changeStatStage('spd', -1)),
      },
      effect_tiaotiaoshu_skill_yishouzhuangong: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(guardCounter, { stack: 1, duration: 1 })),
      },
      effect_tiaotiaoshu_skill_yapo: firstMoveStatDrop('spe', 1),
      effect_tiaotiaoshu_skill_shazhidaoren: firstMoveFlatDamage(35),
      effect_tiaotiaoshu_skill_huixin: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(crit, { stack: 1, duration: 1 })),
      },
      effect_tiaotiaoshu_skill_shanduo: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, firstMove),
        apply: targets.ownerPet.apply(ops.addMark(dodge, { stack: 1, duration: 1 })),
      },
      effect_tiaotiaoshu_skill_qitiao: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, firstMove),
        apply: targets.ownerPet.apply(ops.addMark(leap, { stack: 1, duration: 1 })),
      },
      effect_tiaotiaoshu_skill_pingheng: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(weakenImmune, { stack: 1, duration: 2 })),
      },
      effect_tiaotiaoshu_mark_biansu_priority: {
        triggers: [EffectTrigger.BeforeUseSkillCheck] as const,
        priority: 0,
        when: conditions.ownerUsesSkill,
        apply: targets.sourceSkill.apply(
          ops.addSkillAttributeModifier('priority', 'delta', 1, { lifetime: 'sourceMark' }),
        ),
      },
      effect_tiaotiaoshu_mark_yishouzhuangong_defense: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage] as const,
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, attackDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -50, delta: 0 })),
      },
      effect_tiaotiaoshu_mark_yishouzhuangong_offense: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage] as const,
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, attackDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 50, delta: 0 })),
      },
      effect_tiaotiaoshu_mark_shanduo_evade: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.all(
          conditions.ownerIsSkillTarget,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.category === 'Physical')),
        ),
        apply: contexts.skillUse.apply(ops.setSureMiss()),
      },
      effect_tiaotiaoshu_mark_qitiao_evade: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.all(
          conditions.ownerIsSkillTarget,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.category === 'Special')),
        ),
        apply: contexts.skillUse.apply(ops.setSureMiss()),
      },
    })
  }
}
