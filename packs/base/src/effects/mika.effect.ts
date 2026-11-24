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

const BLIND = 'mark_shiming'
const LIGHT_SHIELD = 'mark_guangzhidun'
const SPIN_BLADE = 'mark_huixuanguangren'
const LIGHT_LOCK = 'mark_guangxiansuoding'

@effectGroup({ id: 'mika' })
export class MikaEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const blind = marks.get(BLIND)
    const lightShield = marks.get(LIGHT_SHIELD)
    const spinBlade = marks.get(SPIN_BLADE)
    const lightLock = marks.get(LIGHT_LOCK)
    if (!blind || !lightShield || !spinBlade || !lightLock) {
      throw new Error('Missing mika mark dependency')
    }

    const opponentActive = targets.opponentActive
    const ownerPet = targets.ownerPet

    const blindApply = opponentActive.apply(ops.addMark(blind))
    const defDown = opponentActive.apply(ops.changeStatStage('def', -1))
    const spaUp = ownerPet.apply(ops.changeStatStage('spa', 1))
    const rageUp = ownerPet.apply(ops.addRage(20))
    const healQuarter = ownerPet.apply(
      ops.heal(
        ownerPet
          .select(pet => pet.stat.maxHp)
          .first()
          .map(v => Math.floor(v * 0.25)),
      ),
    )

    const selfSkillHit = conditions.selfUsesSkill

    return defineEffects({
      effect_ability_deal_damage_based_on_iv_after_non_status_hit: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(
          selfSkillHit,
          contexts.skillUse.condition((_, casts) => casts.some(cast => cast.category !== 'Status')),
        ),
        apply: contexts.skillUse
          .flatMap(event => (event.actualTarget ? [event.actualTarget] : []))
          .apply(
            ops.dealDamage(
              ownerPet
                .select(pet => {
                  const ivs = Object.values(pet.ivs)
                  const total = ivs.reduce((sum, iv) => sum + iv, 0)
                  // Classic teams can specify split IVs even though the original used one shared value.
                  return Math.floor(pet.owner?.battle?.individualValueMax === 31 ? total / ivs.length : total / 20)
                })
                .first(),
            ),
          ),
      },
      effect_emblem_set_climax_min_type_multiplier_1: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          contexts.skillUse.condition((_, casts) => casts.some(cast => cast.category === 'Climax')),
        ),
        apply: contexts.skillUse.apply(ops.setMinimumTypeMultiplier(1)),
      },
      effect_skill_add_rage_20_if_hp_loss_below_100: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.damageResult.condition((_, results) => results.some(result => result.hpLoss < 100)),
        ),
        apply: rageUp,
      },
      effect_skill_min_damage_85: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: selfSkillHit,
        apply: contexts.damage.apply(ops.setDamageThreshold({ min: 85 })),
      },
      effect_skill_reduce_opponent_def_1_stage_25_percent: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(selfSkillHit, conditions.chance(25)),
        apply: defDown,
      },
      effect_skill_raise_spa_1_stage_add_mark_self_guangxiansuoding_before_hit: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: selfSkillHit,
        apply: actions.sequence(spaUp, ownerPet.apply(ops.addMark(lightLock))),
      },
      effect_skill_raise_spa_1_stage_if_hp_loss_below_100: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.damageResult.condition((_, results) => results.some(result => result.hpLoss < 100)),
        ),
        apply: spaUp,
      },
      effect_skill_add_mark_opponent_shiming_20_percent_on_hit: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(selfSkillHit, conditions.chance(20)),
        apply: blindApply,
      },
      effect_skill_add_mark_self_guangzhidun_if_first_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(selfSkillHit, conditions.firstSkillThisTurn),
        apply: ownerPet.apply(ops.addMark(lightShield)),
      },
      effect_skill_heal_self_quarter_max_hp_on_miss: {
        triggers: [EffectTrigger.OnMiss],
        priority: 0,
        when: selfSkillHit,
        apply: healQuarter,
      },
      effect_skill_add_mark_self_huixuanguangren_on_miss: {
        triggers: [EffectTrigger.OnMiss],
        priority: 0,
        when: selfSkillHit,
        apply: ownerPet.apply(ops.addMark(spinBlade)),
      },
      effect_mark_set_non_status_skills_sure_hit: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          contexts.skillUse.condition((_, uses) => uses.some(use => use.skill.category !== 'Status')),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_mark_double_huixuanguangren_power_and_consume: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          contexts.skillUse.condition((_, uses) => uses.some(use => use.skill.baseId === 'skill_huixuanguangren')),
        ),
        apply: actions.sequence(
          contexts.skillUse.apply(ops.amplifyPower(2)),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      },
    })
  }
}
