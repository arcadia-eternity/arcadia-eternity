import {
  actions,
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  numberParam,
  ops,
  targets,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'
import { reflectedHalfHpLoss } from './damage-benefits.effect'
import { physicalDamage, nonEffectStrikeDamage } from './damage-conditions'
import { defensePowerBonus, defenseHitCount } from './defense-scaling'
import { activeOwnerMarks, ruleConsumedSourceMark, requireMark } from './mark-queries'
import { actualSkillTarget, nonStatusSkillUse } from './skill-queries'

const SPIKE_SHELL = 'mark_jiancijiaqiao'
const BARB_SHELL = 'mark_daocijiaqiao'
const RAGE_SHELL = 'mark_baonujiaqiao'
const COUNTER_WILL = 'mark_fanjiyizhi'
const SPIKE_BURST = 'mark_jiancibaofa'
const SAND_SEVERITY = 'mark_shazhili'
const BLEED = 'mark_liuxie'

const defenseBoostChance = numberParam({ default: 10, tags: ['skill_effect_probability'] })

const desertDamage = contexts.damage.condition((_, events) => events.some(event => event.element === 'Desert'))

const incomingAttack = conditions.all(conditions.selfBeDamaged, nonEffectStrikeDamage)
const targetsMarkedPet = conditions.all(conditions.ownerIsSkillTarget, nonStatusSkillUse)

@effectGroup({ id: 'qiuding' })
export class QiudingEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const spikeShell = requireMark(marks, SPIKE_SHELL)
    const barbShell = requireMark(marks, BARB_SHELL)
    const rageShell = requireMark(marks, RAGE_SHELL)
    const counterWill = requireMark(marks, COUNTER_WILL)
    const spikeBurst = requireMark(marks, SPIKE_BURST)
    const sandSeverity = requireMark(marks, SAND_SEVERITY)
    const bleed = requireMark(marks, BLEED)

    const defValue = targets.ownerPet.first().attribute('def')

    const spikeShellActive = activeOwnerMarks(SPIKE_SHELL)
    const barbShellActive = activeOwnerMarks(BARB_SHELL)
    const rageShellActive = activeOwnerMarks(RAGE_SHELL)

    const defBonusDamage = defValue.map(def => defensePowerBonus(def, 5))
    const defBonusPower = defValue.map(def => defensePowerBonus(def, 10))
    const defHits = defValue.map(defenseHitCount)

    const addSpikeShell = targets.ownerPet.apply(ops.addMark(spikeShell, { stack: 1 }))
    const addBarbShell = targets.ownerPet.apply(ops.addMark(barbShell, { stack: 1 }))
    const addRageShell = targets.ownerPet.apply(ops.addMark(rageShell, { stack: 1 }))
    const addCounterWill = targets.ownerPet.apply(ops.addMark(counterWill, { stack: 1 }))
    const addSpikeBurst = targets.opponentActive.apply(ops.addMark(spikeBurst, { stack: 1 }))
    const addSandSeverity = targets.opponentActive.apply(ops.addMark(sandSeverity, { stack: 1 }))

    const defUp = targets.ownerPet.apply(ops.changeStatStage('def', 1))

    return defineEffects({
      effect_ability_reduce_incoming_physical_damage_10_percent_if_def_above_500: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, physicalDamage, ctx => (ctx.read(defValue) ?? 0) > 500),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -10, delta: 0 })),
      },
      effect_emblem_reduce_incoming_damage_5_percent_if_shell_mark: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          ctx =>
            ctx.read(spikeShellActive.first().attribute('stack')) !== undefined ||
            ctx.read(barbShellActive.first().attribute('stack')) !== undefined ||
            ctx.read(rageShellActive.first().attribute('stack')) !== undefined,
        ),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -5, delta: 0 })),
      },
      effect_skill_add_mark_self_jiancijiaqiao_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: addSpikeShell,
      },
      effect_skill_deal_fixed_damage_1_per_5_def_max_100: {
        triggers: [EffectTrigger.OnHit],
        when: conditions.selfUsesSkill,
        apply: actualSkillTarget.apply(ops.dealDamage(defBonusDamage)),
      },
      effect_skill_add_mark_opponent_jiancibaofa_on_hit: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: addSpikeBurst,
      },
      effect_skill_set_hits_by_def_div_100_min_1_max_6: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(ops.setMultihit(defHits)),
      },
      effect_skill_raise_def_1_stage_10_percent: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        parameters: { chance: defenseBoostChance },
        when: conditions.all(conditions.selfUsesSkill, conditions.chance(defenseBoostChance)),
        apply: defUp,
      },
      effect_skill_add_mark_self_daocijiaqiao_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: addBarbShell,
      },
      effect_skill_add_mark_opponent_shazhili_on_hit: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: addSandSeverity,
      },
      effect_skill_add_power_1_per_10_def_max_100: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(ops.addPower(defBonusPower)),
      },
      effect_skill_add_mark_self_fanjiyizhi_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: addCounterWill,
      },
      effect_skill_add_mark_self_baonujiaqiao_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: addRageShell,
      },
      effect_mark_reflect_half_attack_hp_loss_max_284_add_15_rage_and_remove_self: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: incomingAttack,
        apply: actions.sequence(
          targets.damageOriginPet.apply(ops.dealDamage(reflectedHalfHpLoss(284))),
          targets.ownerPet.apply(ops.addRage(15)),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      },
      effect_mark_add_attacker_liuxie_30_on_rule_stack_consumption: {
        triggers: [EffectTrigger.OnConsumeStack],
        when: ruleConsumedSourceMark,
        apply: targets.damageOriginPet.apply(ops.addMark(bleed, { stack: 30 })),
      },
      effect_mark_prevent_attack_damage_percent_equal_to_rage_consume_1_stack: {
        triggers: [EffectTrigger.OnDamageReplacement],
        when: incomingAttack,
        apply: contexts.damage.apply(
          ops.preventDamage({
            fraction: targets.ownerPet.first().map(pet => Math.min(1, pet.currentRage / 100)),
            stacks: 1,
          }),
        ),
      },
      effect_mark_add_50_crit_rate_to_attacks_targeting_owner: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        when: targetsMarkedPet,
        apply: contexts.skillUse.apply(ops.addCritRate(50)),
      },
      effect_mark_amplify_incoming_desert_damage_50_percent: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, desertDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 50, delta: 0 })),
      },
    })
  }
}
