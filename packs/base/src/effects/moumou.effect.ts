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
import { physicalOrSpecialDamage } from './damage-conditions'
import { requireMark } from './mark-queries'
import { nonStatusSkillUse } from './skill-queries'

const HARDEN = 'mark_yinghua'
const SURE_HIT = 'mark_bizhong'

const defenseBoostChance = numberParam({ default: 15, tags: ['skill_effect_probability'] })

const ownerPet = targets.ownerPet

@effectGroup({ id: 'moumou' })
export class MoumouEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const harden = requireMark(marks, HARDEN)
    const sureHit = requireMark(marks, SURE_HIT)

    return defineEffects({
      effect_ability_heal_self_15_hp_after_non_status_hit: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, nonStatusSkillUse),
        apply: ownerPet.apply(ops.heal(15)),
      },
      effect_skill_add_mark_self_bizhong_2_turns_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.addMark(sureHit, { stack: 1, duration: 2 })),
      },
      effect_skill_raise_def_1_stage_15_percent: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        parameters: { chance: defenseBoostChance },
        when: conditions.all(conditions.selfUsesSkill, conditions.chance(defenseBoostChance)),
        apply: ownerPet.apply(ops.changeStatStage('def', 1)),
      },
      effect_skill_add_mark_self_yinghua_50_5_turns_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.addMark(harden, { stack: 50, duration: 5 })),
      },
      effect_skill_min_physical_special_damage_95: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, physicalOrSpecialDamage),
        apply: contexts.damage.apply(ops.setDamageThreshold({ min: 95 })),
      },
      effect_skill_double_damage_against_grass_water_desert_trait: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.damage.condition((_, events) =>
            events.some(event => {
              const target = event.target
              if (!target) return false
              const element = target.element
              return element === 'Grass' || element === 'Water' || element === 'Desert' || element === 'Trait'
            }),
          ),
        ),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 100, delta: 0 })),
      },
      effect_skill_raise_atk_1_stage_heal_self_17_percent_max_hp_before_hit: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          ownerPet.apply(ops.changeStatStage('atk', 1)),
          ownerPet.apply(
            ops.heal(
              ownerPet
                .select(pet => pet.stat.maxHp)
                .first()
                .map(maxHp => Math.floor(maxHp * 0.17)),
            ),
          ),
        ),
      },
      effect_skill_add_rage_50_if_previous_skill_missed: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, events) =>
            events.some(event => {
              const pet = event.pet
              return pet.lastMissedSkillId !== undefined
            }),
          ),
        ),
        apply: ownerPet.apply(ops.addRage(50)),
      },
    })
  }
}
