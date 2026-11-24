import {
  actions,
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  numberParam,
  ops,
  targets,
  type Condition,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'
import { activeOwnerMarks, requireMark } from './mark-queries'

const BLUE_WAVE = 'mark_lanbo'
const BERSERK = 'mark_baozou'
const CONFUSION = 'mark_hunmi'
const FEAR = 'mark_kongju'
const BLEED = 'mark_liuxie'
const VULNERABLE = 'mark_yishang'
const SHY_DODGE = 'mark_haixiuduobi'

const specialAttackBoostChance = numberParam({ default: 5, tags: ['skill_effect_probability'] })

@effectGroup({ id: 'qiaoba' })
export class QiaobaEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const blueWave = requireMark(marks, BLUE_WAVE)
    const berserk = requireMark(marks, BERSERK)
    const confusion = requireMark(marks, CONFUSION)
    const fear = requireMark(marks, FEAR)
    const bleed = requireMark(marks, BLEED)
    const vulnerable = requireMark(marks, VULNERABLE)
    const shyDodge = requireMark(marks, SHY_DODGE)

    const blueWaveStacks = activeOwnerMarks(BLUE_WAVE).first().attribute('stack')
    const hasBlueWave =
      (minimum: number): Condition =>
      ctx =>
        (ctx.read(blueWaveStacks) ?? 0) >= minimum

    const addBlueWave = targets.ownerPet.apply(ops.addMark(blueWave, { stack: 1 }))
    const addBerserk = targets.ownerPet.apply(ops.addMark(berserk, { stack: 1 }))

    const opponentActive = targets.opponentActive
    const addConfusion = opponentActive.apply(ops.addMark(confusion, { stack: 1 }))
    const addFear = opponentActive.apply(ops.addMark(fear, { stack: 1 }))
    const addBleed = opponentActive.apply(ops.addMark(bleed, { stack: 50 }))
    const addVulnerable = opponentActive.apply(ops.addMark(vulnerable, { stack: 50 }))

    const selfSpaUp = targets.ownerPet.apply(ops.changeStatStage('spa', 1))
    const selfSpdUp = targets.ownerPet.apply(ops.changeStatStage('spd', 1))

    const healQuarter = targets.ownerPet.apply(
      ops.heal(targets.ownerPet.select(pet => Math.floor(pet.stat.maxHp * 0.25)).first()),
    )

    const selfSkillUse = contexts.skillUse
    const selfSkillPower = selfSkillUse.apply(ops.addPower(35))
    const selfSkillSureHit = selfSkillUse.apply(ops.setSureHit())
    const selfSkillDoublePower = selfSkillUse.apply(ops.amplifyPower(2))
    const selfSkillSetMultihit4 = selfSkillUse.apply(ops.setMultihit(4))
    const selfSkillFreeRage = selfSkillUse.property('rage').apply(ops.assign(0))

    const firstThisTurn = conditions.firstSkillThisTurn

    return defineEffects({
      effect_ability_add_mark_self_lanbo_on_damage: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged),
        apply: addBlueWave,
      },
      effect_ability_add_mark_self_baozou_when_lanbo_reaches_3_stacks: {
        triggers: [EffectTrigger.OnStack],
        priority: 0,
        when: ctx =>
          ctx.parent.existingMark.owner === ctx.read(targets.ownerPet.first()) &&
          ctx.parent.existingMark.baseId === BLUE_WAVE &&
          ctx.parent.stacksBefore < 3 &&
          ctx.parent.stacksAfter >= 3,
        apply: addBerserk,
      },
      effect_emblem_extend_received_baozou_1_turn: {
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_, additions) => additions.some(addition => addition.baseMark.id === BERSERK)),
        ),
        apply: contexts.addMark.apply(
          ops.setMarkDuration(
            contexts.addMark.select(event => (event.duration ?? event.baseMark.config.duration ?? 1) + 1).first(),
          ),
        ),
      },
      effect_skill_raise_spa_1_stage_5_percent: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        parameters: { chance: specialAttackBoostChance },
        when: conditions.all(conditions.selfUsesSkill, conditions.chance(specialAttackBoostChance)),
        apply: selfSpaUp,
      },
      effect_skill_add_power_35_if_lanbo: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasBlueWave(1)),
        apply: selfSkillPower,
      },
      effect_skill_raise_spd_1_stage_if_lanbo: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasBlueWave(1)),
        apply: selfSpdUp,
      },
      effect_skill_heal_self_1_4_max_hp_and_add_lanbo: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(healQuarter, addBlueWave),
      },
      effect_skill_add_mark_opponent_liuxie_50_if_lanbo_2_stacks: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasBlueWave(2)),
        apply: addBleed,
      },
      effect_skill_set_rage_cost_0_if_lanbo_2_stacks: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasBlueWave(2)),
        apply: selfSkillFreeRage,
      },
      effect_skill_power_2x_if_first_before_sort: {
        triggers: [EffectTrigger.BeforeSort],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, firstThisTurn),
        apply: selfSkillDoublePower,
      },
      effect_skill_raise_spa_1_stage_if_lanbo: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasBlueWave(1)),
        apply: selfSpaUp,
      },
      effect_skill_sure_hit_if_lanbo_2_stacks: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasBlueWave(2)),
        apply: selfSkillSureHit,
      },
      effect_skill_add_mark_opponent_yishang_50_if_lanbo_2_stacks: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasBlueWave(2)),
        apply: addVulnerable,
      },
      effect_skill_set_4_hits_if_lanbo_3_stacks: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasBlueWave(3)),
        apply: selfSkillSetMultihit4,
      },
      effect_skill_add_mark_opponent_hunmi_50_percent_if_lanbo_3_stacks: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasBlueWave(3), conditions.chance(50)),
        apply: addConfusion,
      },
      effect_skill_add_mark_self_haixiuduobi_on_hit: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(shyDodge, { stack: 1 })),
      },
      effect_skill_add_mark_opponent_kongju_if_lanbo_3_stacks: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasBlueWave(3)),
        apply: addFear,
      },
      effect_mark_amplify_outgoing_skill_damage_100_percent: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.damage.condition((_, hits) => hits.some(hit => hit.policy.skillReactions)),
        ),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 100, delta: 0 })),
      },
      effect_mark_amplify_incoming_skill_damage_50_percent: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          contexts.damage.condition((_, hits) => hits.some(hit => hit.policy.skillReactions)),
        ),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 50, delta: 0 })),
      },
      effect_mark_remove_self_lanbo_on_baozou_duration_end: {
        triggers: [EffectTrigger.OnMarkDurationEnd],
        priority: 0,
        when: contexts.consumeStack.condition((_, events) => events.some(event => event.mark.baseId === BERSERK)),
        apply: targets.ownerMarks.where(mark => mark.baseId === BLUE_WAVE).apply(ops.removeMark()),
      },
      effect_mark_evade_targeted_skill_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.ownerIsSkillTarget,
        apply: contexts.skillUse.apply(ops.setSureMiss()),
      },
    })
  }
}
