import {
  DamageType,
  actions,
  checks,
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'
import { preventedBySourceMark } from './damage-benefits.effect'
import { nonEffectStrikeDamage } from './damage-conditions'
import { activeOwnerMarks, ruleConsumedSourceMark, requireMark } from './mark-queries'

const ABILITY = 'mark_ability_abu'
const EMBLEM = 'mark_emblem_abu'
const CURSE = 'mark_zuzhou'
const BANDAGE_SUBSTITUTE = 'mark_bengdaitishen'
const ABU_RESENTMENT = 'mark_abuzhiyuan'
const MENTAL_RESTRAINT = 'mark_xinlingzhiyue'

const opponentActive = targets.opponentActive
const ownerPet = targets.ownerPet

@effectGroup({ id: 'abu' })
export class AbuEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const curse = requireMark(marks, CURSE)
    const bandageSubstitute = requireMark(marks, BANDAGE_SUBSTITUTE)
    const abuResentment = requireMark(marks, ABU_RESENTMENT)
    const mentalRestraint = requireMark(marks, MENTAL_RESTRAINT)

    const ownerHasAbility = activeOwnerMarks(ABILITY)
    const ownerHasEmblem = activeOwnerMarks(EMBLEM)
    const ownerHasResentment = activeOwnerMarks(ABU_RESENTMENT)

    const repeatedHit = conditions.all(
      conditions.selfUsesSkill,
      contexts.skillUse.condition((_, events) =>
        events.some(({ pet, skill }) => pet.lastSkillUsedTimes > 1 && pet.lastMissedSkillId !== skill.baseId),
      ),
    )

    return defineEffects({
      effect_ability_drain_opponent_rage_10_on_first_skill_hit: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          conditions.firstSkillThisTurn,
          conditions.ownerIsActive,
          ownerHasAbility.condition(checks.exists()),
        ),
        apply: targets.opponentPlayer.apply(ops.reduceRage(10)),
      },
      effect_emblem_set_applied_zuzhou_duration_2_turns: {
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerAddsMark,
          ownerHasEmblem.condition(checks.exists()),
          contexts.addMark.condition((_, events) => events.some(({ baseMark }) => baseMark.id === CURSE)),
        ),
        apply: contexts.addMark.apply(ops.setMarkDuration(2)),
      },
      effect_skill_reduce_opponent_def_1_stage_after_repeated_use_without_miss: {
        triggers: [EffectTrigger.BeforeHit],
        when: repeatedHit,
        apply: opponentActive.apply(ops.changeStatStage('def', -1)),
      },
      effect_skill_reduce_opponent_spe_1_stage_after_repeated_use_without_miss: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: repeatedHit,
        apply: opponentActive.apply(ops.changeStatStage('spe', -1)),
      },
      effect_skill_add_mark_self_bengdaitishen_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.addMark(bandageSubstitute, { stack: 1 })),
      },
      effect_skill_add_mark_opponent_zuzhou_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: opponentActive.apply(ops.addMark(curse, { stack: 1 })),
      },
      effect_skill_add_mark_self_abuzhiyuan_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.addMark(abuResentment, { stack: 1 })),
      },
      effect_skill_add_mark_self_xinlingzhiyue_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.addMark(mentalRestraint, { stack: 1 })),
      },
      effect_skill_consume_abuzhiyuan_deal_100_effect_damage_ignoring_shields: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ownerHasResentment.condition(checks.exists())),
        apply: actions.sequence(
          ownerHasResentment.apply(ops.removeMark()),
          opponentActive.apply(ops.dealDamage(100, { damageType: DamageType.Effect, policy: { shields: false } })),
        ),
      },
      effect_mark_prevent_direct_attack_damage_twice_current_rage_consume_1_stack: {
        triggers: [EffectTrigger.OnDamageReplacement],
        when: conditions.all(conditions.selfBeDamaged, nonEffectStrikeDamage),
        apply: contexts.damage.apply(
          ops.preventDamage({
            amount: targets.ownerPet.first().map(pet => pet.currentRage * 2),
            stacks: 1,
          }),
        ),
      },
      effect_mark_restore_1_stack_spend_ceil_half_prevented_damage_as_rage: {
        triggers: [EffectTrigger.OnConsumeStack],
        when: ruleConsumedSourceMark,
        apply: ctx => {
          // The stack authorizes each hit. Rage pays for prevention until the mark expires.
          targets.sourceMark.apply(ops.addStacks(1))(ctx)
          ownerPet.apply(ops.reduceRage(Math.ceil(preventedBySourceMark(ctx) / 2)))(ctx)
        },
      },
      effect_mark_waive_non_climax_skill_rage_cost_if_has_abuzhiyuan: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          ownerHasResentment.condition(checks.exists()),
          contexts.skillUse.condition((_, events) => events.some(event => event.category !== 'Climax')),
        ),
        apply: contexts.skillUse.property('rage').apply(ops.assign(0)),
      },
      effect_mark_double_damage_rage_gain_and_consume: {
        triggers: [EffectTrigger.BeforeRageGain],
        priority: 0,
        when: conditions.ownerReceivesDamageRage,
        apply: actions.sequence(
          contexts.rage.apply(ops.modifyRage({ percent: 100, delta: 0 })),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      },
    })
  }
}
