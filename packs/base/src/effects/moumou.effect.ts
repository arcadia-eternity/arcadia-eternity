import {
  actions,
  conditions,
  contexts,
  DamageType,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
  type Action,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

const HARDEN = 'mark_yinghua'
const SURE_HIT = 'mark_bizhong'

const attackDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Physical || event.damageType === DamageType.Special),
)

const opponentActive = targets.opponentActive
const ownerPet = targets.ownerPet

function secondaryDebuff(stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe', percent: number): Action {
  return actions.sequence(
    actions.choose(
      conditions.all(conditions.selfUsesSkill, conditions.chance(percent)),
      opponentActive.apply(ops.changeStatStage(stat, -1)),
    ),
  )
}

function secondaryBuff(stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe', percent: number): Action {
  return actions.sequence(
    actions.choose(
      conditions.all(conditions.selfUsesSkill, conditions.chance(percent)),
      ownerPet.apply(ops.changeStatStage(stat, 1)),
    ),
  )
}

@effectGroup({ id: 'moumou' })
export class MoumouEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const harden = marks.get(HARDEN)
    const sureHit = marks.get(SURE_HIT)
    if (!harden || !sureHit) throw new Error('Missing harden or sure-hit mark')

    return defineEffects({
      effect_moumou_ability_heal_on_hit: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, casts) => casts.some(cast => cast.category !== 'Status')),
        ),
        apply: ownerPet.apply(ops.heal(15)),
      },
      effect_moumou_skill_niliu: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        apply: secondaryDebuff('spe', 100),
      },
      effect_moumou_skill_hailangzhenpao: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.addMark(sureHit, { stack: 1, duration: 2 })),
      },
      effect_moumou_skill_jilangchongzhuang: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        apply: secondaryDebuff('atk', 10),
      },
      effect_moumou_skill_chaojihailiu: {
        triggers: [EffectTrigger.BeforeSort],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.property('priority').apply(ops.add(1)),
      },
      effect_moumou_skill_hainiupolang: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        apply: secondaryBuff('atk', 15),
      },
      effect_moumou_skill_buxieyiji: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        apply: secondaryBuff('def', 15),
      },
      effect_moumou_skill_moushenhuti: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.addMark(harden, { stack: 50, duration: 5 })),
      },
      effect_moumou_skill_chaohailiupo: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, attackDamage),
        apply: contexts.damage.apply(ops.setDamageThreshold({ min: 95 })),
      },
      effect_moumou_skill_nishichongzhuang: {
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
      effect_moumou_skill_mouwangjunshi_atk: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        apply: secondaryBuff('atk', 20),
      },
      effect_moumou_skill_mouwangjunshi_def: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        apply: secondaryBuff('def', 20),
      },
      effect_moumou_skill_mouwangshenji: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        apply: secondaryDebuff('spe', 20),
      },
      effect_moumou_skill_moumoumoumou: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
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
      effect_moumou_skill_mouwangzhinu: {
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
