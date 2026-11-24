import {
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
  type Condition,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'
import { physicalOrSpecialDamage } from './damage-conditions'
import { requireMark } from './mark-queries'

const SPEED_UP = 'mark_biansu'
const GUARD_COUNTER = 'mark_yishouzhuangong'
const DODGE = 'mark_shanduo'
const LEAP = 'mark_qitiao'
const CRIT = 'mark_huixin'
const WEAKEN_IMMUNE = 'mark_mianyiruohua'
const DAMAGE_REDUCTION = 'mark_shoudaoshanghaijianshao'

const usesOtherMove = contexts.skillUse.condition((_, uses) =>
  uses.some(use => use.skill.baseId !== 'skill_biansutuji'),
)
const firstMove = conditions.firstSkillThisTurn

const markDuration = (predicate: (duration: number) => boolean): Condition =>
  targets.sourceMark.condition((_, marks) => marks.some(mark => predicate(mark.duration)))

function firstMovePowerMultiplier(multiplier: number) {
  return {
    triggers: [EffectTrigger.AfterUseSkillCheck] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, firstMove),
    apply: contexts.skillUse.apply(ops.amplifyPower(multiplier)),
  }
}

function firstMoveStatDrop(stat: 'spd' | 'spe') {
  return {
    triggers: [EffectTrigger.BeforeHit] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, firstMove),
    apply: targets.opponentActive.apply(ops.changeStatStage(stat, -1)),
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
    const speedUp = requireMark(marks, SPEED_UP)
    const guardCounter = requireMark(marks, GUARD_COUNTER)
    const dodge = requireMark(marks, DODGE)
    const leap = requireMark(marks, LEAP)
    const crit = requireMark(marks, CRIT)
    const weakenImmune = requireMark(marks, WEAKEN_IMMUNE)
    const damageReduction = requireMark(marks, DAMAGE_REDUCTION)

    return defineEffects({
      effect_ability_reduce_incoming_status_skill_accuracy_10: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerIsSkillTarget,
          contexts.skillUse.condition((_, events) => events.some(event => event.category === 'Status')),
        ),
        apply: contexts.skillUse.apply(ops.addAccuracy(-10)),
      },
      effect_emblem_extend_mianyiruohua_applied_by_owner_2_turns: {
        triggers: [EffectTrigger.OnBeforeAddMark] as const,
        priority: 0,
        when: conditions.all(
          conditions.ownerAddsMark,
          contexts.addMark.condition((_, events) => events.some(({ baseMark }) => baseMark.id === WEAKEN_IMMUNE)),
        ),
        apply: contexts.addMark.apply(
          ops.setMarkDuration(
            contexts.addMark
              .select(event => event.duration)
              .all()
              .map(items => items.map(duration => duration + 2)),
          ),
        ),
      },
      effect_skill_add_mark_self_biansu_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(speedUp, { stack: 1 })),
      },
      effect_skill_power_2x_if_first_after_check_priority_0: firstMovePowerMultiplier(2),
      effect_skill_reduce_opponent_spd_1_stage_if_first: firstMoveStatDrop('spd'),
      effect_skill_add_mark_self_yishouzhuangong_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(guardCounter, { stack: 1 })),
      },
      effect_skill_add_mark_self_shoudaoshanghaijianshao_50_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(damageReduction, { stack: 50 })),
      },
      effect_skill_reduce_opponent_spe_1_stage_if_first: firstMoveStatDrop('spe'),
      effect_skill_deal_35_effect_damage_if_first_on_hit: firstMoveFlatDamage(35),
      effect_skill_add_mark_self_huixin_for_1_turn_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(crit, { stack: 1, duration: 1 })),
      },
      effect_skill_add_mark_self_shanduo_for_1_turn_if_first: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, firstMove),
        apply: targets.ownerPet.apply(ops.addMark(dodge, { stack: 1, duration: 1 })),
      },
      effect_skill_add_mark_self_qitiao_for_1_turn_if_first: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, firstMove),
        apply: targets.ownerPet.apply(ops.addMark(leap, { stack: 1, duration: 1 })),
      },
      effect_skill_add_mark_self_mianyiruohua_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(weakenImmune, { stack: 1 })),
      },
      effect_mark_add_1_priority_except_biansutuji: {
        triggers: [EffectTrigger.BeforeSort],
        when: conditions.all(conditions.ownerUsesSkill, usesOtherMove),
        apply: contexts.skillUse.property('priority').apply(ops.add(1)),
      },
      effect_mark_remove_self_after_check_except_biansutuji: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        when: conditions.all(conditions.ownerUsesSkill, usesOtherMove),
        apply: targets.sourceMark.apply(ops.removeMark()),
      },
      effect_mark_reduce_incoming_attack_damage_50_percent_before_last_turn: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage] as const,
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          physicalOrSpecialDamage,
          markDuration(duration => duration > 1),
        ),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -50, delta: 0 })),
      },
      effect_mark_amplify_outgoing_attack_damage_50_percent_on_last_turn: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage] as const,
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          physicalOrSpecialDamage,
          markDuration(duration => duration <= 1),
        ),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 50, delta: 0 })),
      },
      effect_mark_evade_targeted_physical_skill_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.all(
          conditions.ownerIsSkillTarget,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.category === 'Physical')),
        ),
        apply: contexts.skillUse.apply(ops.setSureMiss()),
      },
      effect_mark_evade_targeted_special_skill_after_check: {
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
