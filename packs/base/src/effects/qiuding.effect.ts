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

const SPIKE_SHELL = 'mark_jiancijiaqiao'
const BARB_SHELL = 'mark_daocijiaqiao'
const RAGE_SHELL = 'mark_baonujiaqiao'
const COUNTER_WILL = 'mark_fanjiyizhi'
const SPIKE_BURST = 'mark_jiancibaofa'
const SAND_SEVERITY = 'mark_shazhili'
const BLEED = 'mark_liuxie'

const physicalDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Physical),
)
const desertDamage = contexts.damage.condition((_, events) => events.some(event => event.element === 'Desert'))

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

    const addSpikeShell = targets.ownerPet.apply(ops.addMark(spikeShell, { stack: 1, duration: 1 }))
    const addBarbShell = targets.ownerPet.apply(ops.addMark(barbShell, { stack: 1, duration: 1 }))
    const addRageShell = targets.ownerPet.apply(ops.addMark(rageShell, { stack: 1, duration: 1 }))
    const addCounterWill = targets.ownerPet.apply(ops.addMark(counterWill, { stack: 1, duration: 3 }))
    const addSpikeBurst = targets.opponentActive.apply(ops.addMark(spikeBurst, { stack: 1, duration: 2 }))
    const addSandSeverity = targets.opponentActive.apply(ops.addMark(sandSeverity, { stack: 1, duration: 3 }))

    const defUp = targets.ownerPet.apply(ops.changeStatStage('def', 1))

    return defineEffects({
      effect_qiuding_ability_def_reduction: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, physicalDamage, ctx => (ctx.read(defValue) ?? 0) > 500),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -10, delta: 0 })),
      },
      effect_qiuding_emblem_shell_reduction: {
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
      effect_qiuding_skill_jiancijiaqiao: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: addSpikeShell,
      },
      effect_qiuding_skill_jiancichongzhuang: {
        triggers: [EffectTrigger.PreDamage],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(ops.addPower(defBonusDamage)),
      },
      effect_qiuding_skill_jiancibaofa: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: addSpikeBurst,
      },
      effect_qiuding_skill_jiancifangun: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(ops.setMultihit(defHits)),
      },
      effect_qiuding_skill_jiancituji: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.chance(10)),
        apply: defUp,
      },
      effect_qiuding_skill_daocijiaqiao: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: addBarbShell,
      },
      effect_qiuding_skill_shazhili: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: addSandSeverity,
      },
      effect_qiuding_skill_pojiatuji: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(ops.setIgnoreShield()),
      },
      effect_qiuding_skill_didongshanyao: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.chance(20)),
        apply: defUp,
      },
      effect_qiuding_skill_licitujin: {
        triggers: [EffectTrigger.PreDamage],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(ops.addPower(defBonusPower)),
      },
      effect_qiuding_skill_fanjiyizhi: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: addCounterWill,
      },
      effect_qiuding_skill_baonujiaqiao: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: addRageShell,
      },
      effect_qiuding_mark_spike_shell_rage: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          ctx => ctx.read(spikeShellActive.first().attribute('stack')) !== undefined,
        ),
        apply: actions.sequence(
          targets.damageOriginPet.apply(
            ops.dealDamage(contexts.damageResult.select(r => Math.min(284, Math.floor(r.hpLoss / 2))).first()),
          ),
          targets.ownerPet.apply(ops.addRage(15)),
          targets.ownerMarks.where(mark => mark.baseId === SPIKE_SHELL).apply(ops.removeMark()),
        ),
      },
      effect_qiuding_mark_barb_shell_bleed: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          ctx => ctx.read(barbShellActive.first().attribute('stack')) !== undefined,
        ),
        apply: actions.sequence(
          contexts.damage.apply(ops.modifyDamage({ percent: -50, delta: 0 })),
          targets.opponentActive.apply(ops.addMark(bleed, { stack: 30 })),
          targets.ownerMarks.where(mark => mark.baseId === BARB_SHELL).apply(ops.removeMark()),
        ),
      },
      effect_qiuding_mark_rage_shell_consume: {
        triggers: [EffectTrigger.OnDamageReplacement],
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          ctx => ctx.read(rageShellActive.first().attribute('stack')) !== undefined,
        ),
        apply: actions.sequence(
          contexts.damage.apply(
            ops.preventDamage({
              fraction: targets.ownerPet
                .first()
                .map(pet => pet.currentRage)
                .map(rage => rage / 100),
            }),
          ),
          targets.ownerPet.apply(
            ops.reduceRage(
              targets.ownerPet
                .first()
                .map(pet => pet.currentRage)
                .map(rage => Math.floor(rage / 2)),
            ),
          ),
          targets.ownerMarks.where(mark => mark.baseId === RAGE_SHELL).apply(ops.removeMark()),
        ),
      },
      effect_qiuding_mark_spike_burst_crit: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.ownerIsSkillTarget,
        apply: contexts.skillUse.apply(ops.addCritRate(50)),
      },
      effect_qiuding_mark_sand_severity_amplify: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, desertDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 50, delta: 0 })),
      },
    })
  }
}
