import {
  actions,
  conditions,
  contexts,
  DamageType,
  defineEffects,
  EffectTrigger,
  numberParam,
  ops,
  type Condition,
  targets,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

const SPIKE_SHELL = 'mark_jiancijiaqiao'
const BARB_SHELL = 'mark_daocijiaqiao'
const RAGE_SHELL = 'mark_baonujiaqiao'
const COUNTER_WILL = 'mark_fanjiyizhi'
const SPIKE_BURST = 'mark_jiancibaofa'
const SAND_SEVERITY = 'mark_shazhili'
const BLEED = 'mark_liuxie'

const defenseBoostChance = numberParam({ default: 10, tags: ['skill_effect_probability'] })

const physicalDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Physical),
)
const desertDamage = contexts.damage.condition((_, events) => events.some(event => event.element === 'Desert'))

const incomingAttack = conditions.all(
  conditions.selfBeDamaged,
  contexts.damage.condition((_, events) =>
    events.some(
      event =>
        event.origin.trigger !== 'effect' &&
        (event.damageType === DamageType.Physical || event.damageType === DamageType.Special),
    ),
  ),
)
const shellPaid: Condition<EffectTrigger.OnConsumeStack> = ctx =>
  ctx.parent.reason === 'rule' && ctx.parent.mark === ctx.read(targets.sourceMark.first())
const targetsMarkedPet = conditions.all(
  conditions.ownerIsSkillTarget,
  contexts.skillUse.condition((_, events) => events.some(event => event.category !== 'Status')),
)

@effectGroup({ id: 'qiuding' })
export class QiudingEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const spikeShell = marks.get(SPIKE_SHELL)
    const barbShell = marks.get(BARB_SHELL)
    const rageShell = marks.get(RAGE_SHELL)
    const counterWill = marks.get(COUNTER_WILL)
    const spikeBurst = marks.get(SPIKE_BURST)
    const sandSeverity = marks.get(SAND_SEVERITY)
    const bleed = marks.get(BLEED)
    if (!spikeShell || !barbShell || !rageShell || !counterWill || !spikeBurst || !sandSeverity || !bleed) {
      throw new Error('Missing qiuding mark dependency')
    }

    const defValue = targets.ownerPet.first().attribute('def')

    const spikeShellActive = targets.ownerMarks.where(mark => mark.baseId === SPIKE_SHELL && mark.isActive)
    const barbShellActive = targets.ownerMarks.where(mark => mark.baseId === BARB_SHELL && mark.isActive)
    const rageShellActive = targets.ownerMarks.where(mark => mark.baseId === RAGE_SHELL && mark.isActive)

    const defBonusDamage = defValue.map(def => Math.min(100, Math.floor(def / 5)))
    const defBonusPower = defValue.map(def => Math.min(100, Math.floor(def / 10)))
    const defHits = defValue.map(def => Math.max(1, Math.min(6, Math.floor(def / 100))))

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
      effect_skill_add_power_by_def_div_5_max_100_pre_damage: {
        triggers: [EffectTrigger.PreDamage],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(ops.addPower(defBonusDamage)),
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
      effect_skill_add_power_by_def_div_10_max_100_pre_damage: {
        triggers: [EffectTrigger.PreDamage],
        priority: 0,
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
          targets.damageOriginPet.apply(
            ops.dealDamage(contexts.damageResult.select(r => Math.min(284, Math.floor(r.hpLoss / 2))).first()),
          ),
          targets.ownerPet.apply(ops.addRage(15)),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      },
      effect_mark_add_attacker_liuxie_30_on_rule_stack_consumption: {
        triggers: [EffectTrigger.OnConsumeStack],
        when: shellPaid,
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
