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
      effect_mika_ability_qualification_damage: {
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
      effect_mika_emblem_climax_min_effect: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          contexts.skillUse.condition((_, casts) => casts.some(cast => cast.category === 'Climax')),
        ),
        apply: contexts.skillUse.apply(ops.setMinimumTypeMultiplier(1)),
      },
      effect_mika_skill_guangshufanchong: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.damageResult.condition((_, results) => results.some(result => result.hpLoss < 100)),
        ),
        apply: rageUp,
      },
      effect_mika_skill_guangjiangongji: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: selfSkillHit,
        apply: contexts.damage.apply(ops.setDamageThreshold({ min: 85 })),
      },
      effect_mika_skill_fenlituji: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.all(selfSkillHit, conditions.chance(25))),
        apply: defDown,
      },
      effect_mika_skill_guangxianchuantou: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: selfSkillHit,
        apply: contexts.skillUse.apply(ops.setIgnoreShield()),
      },
      effect_mika_skill_guangxiansuoding: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: selfSkillHit,
        apply: actions.sequence(spaUp, ownerPet.apply(ops.addMark(lightLock))),
      },
      effect_mika_skill_guangshuchongji: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.damageResult.condition((_, results) => results.some(result => result.hpLoss < 100)),
        ),
        apply: spaUp,
      },
      effect_mika_skill_amadisiguang: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.all(selfSkillHit, conditions.chance(20))),
        apply: blindApply,
      },
      effect_mika_skill_guangzhidun: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: selfSkillHit,
        apply: ownerPet.apply(ops.addMark(lightShield)),
      },
      effect_mika_skill_xiaotaiyang: {
        triggers: [EffectTrigger.OnMiss],
        priority: 0,
        when: selfSkillHit,
        apply: healQuarter,
      },
      effect_mika_skill_huixuanguangren: {
        triggers: [EffectTrigger.OnMiss],
        priority: 0,
        when: selfSkillHit,
        apply: ownerPet.apply(ops.addMark(spinBlade)),
      },
      effect_mika_mark_guangxiansuoding_surehit: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          contexts.skillUse.condition((_, uses) => uses.some(use => use.skill.category !== 'Status')),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_mika_mark_guangzhidun_reflect: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          contexts.damage.condition((_, damages) =>
            damages.some(damage => damage.damageType === 'Physical' || damage.damageType === 'Special'),
          ),
        ),
        apply: targets.damageOriginPet.apply(
          ops.dealDamage(contexts.damageResult.select(result => Math.floor(result.hpLoss / 2)).first()),
        ),
      },
      effect_mika_mark_huixuanguangren_power: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          contexts.skillUse.condition((_, uses) => uses.some(use => use.skill.baseId === 'skill_huixuanguangren')),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      },
    })
  }
}
