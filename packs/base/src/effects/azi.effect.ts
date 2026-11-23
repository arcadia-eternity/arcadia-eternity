import {
  conditions,
  contexts,
  DamageType,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

const PARALYSIS = 'mark_mabi'

const opponentRageAbove50 = targets.opponentActive.condition((_, pets) => (pets[0]?.currentRage ?? 0) > 50)
const opponentRageBelow50 = targets.opponentActive.condition((_, pets) => (pets[0]?.currentRage ?? 0) < 50)

const specialDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Special),
)

const physicalSkill = contexts.skillUse.condition((_, events) =>
  events.some(event => event.skill.category === 'Physical'),
)

const attackDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Physical || event.damageType === DamageType.Special),
)

const opponentActive = targets.opponentActive
const ownerPet = targets.ownerPet

const skillIs = (id: string) =>
  contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === id))

@effectGroup({ id: 'azi' })
export class AziEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const paralysis = marks.get(PARALYSIS)
    if (!paralysis) throw new Error('Missing paralysis mark')

    return defineEffects({
      effect_azi_ability_special_damage: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, specialDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 5, delta: 0 })),
      },
      effect_azi_ability_physical_accuracy: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, physicalSkill),
        apply: contexts.skillUse.apply(ops.addAccuracy(5)),
      },
      effect_azi_emblem_taunt_rage: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_tiaoxin')),
        apply: ownerPet.apply(ops.addRage(20)),
      },
      effect_azi_skill_zidianguang_priority: {
        triggers: [EffectTrigger.BeforeSort],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_zidianguang'), opponentRageAbove50),
        apply: contexts.skillUse.property('priority').apply(ops.add(1)),
      },
      effect_azi_skill_zidianpo_priority: {
        triggers: [EffectTrigger.BeforeSort],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_zidianpo'), opponentRageBelow50),
        apply: contexts.skillUse.property('priority').apply(ops.add(1)),
      },
      effect_azi_skill_ziguangbo_power: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_ziguangbo'), opponentRageAbove50),
        apply: contexts.skillUse.apply(ops.addPower(40)),
      },
      effect_azi_skill_ziguangzhan_power: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_ziguangzhan'), opponentRageBelow50),
        apply: contexts.skillUse.apply(ops.addPower(40)),
      },
      effect_azi_skill_zidiantongti_atk: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_zidiantongti')),
        apply: ownerPet.apply(ops.changeStatStage('atk', 1)),
      },
      effect_azi_skill_zidiantongti_spd: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_zidiantongti'), opponentRageBelow50),
        apply: ownerPet.apply(ops.changeStatStage('spd', 1)),
      },
      effect_azi_skill_chuantoudianqiu_surehit: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_chuantoudianqiu')),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_azi_skill_chuantoudianqiu_ignore_shield: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_chuantoudianqiu')),
        apply: contexts.skillUse.apply(ops.setIgnoreShield()),
      },
      effect_azi_skill_zidianchongji_paralysis: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_zidianchongji'), conditions.chance(40)),
        apply: opponentActive.apply(ops.addMark(paralysis)),
      },
      effect_azi_skill_zidianguantong_spa: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_zidianguantong')),
        apply: ownerPet.apply(ops.changeStatStage('spa', 1)),
      },
      effect_azi_skill_zidianguantong_def: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_zidianguantong'), opponentRageAbove50),
        apply: ownerPet.apply(ops.changeStatStage('def', 1)),
      },
      effect_azi_skill_zidianleimingqiang_surehit: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_zidianleimingqiang')),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_azi_skill_zidianleimingqiang_ignore_shield: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_zidianleimingqiang')),
        apply: contexts.skillUse.apply(ops.setIgnoreShield()),
      },
      effect_azi_skill_juedianzhiqiang_surehit: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_juedianzhiqiang')),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_azi_skill_juedianzhiqiang_min_damage: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_juedianzhiqiang'), attackDamage),
        apply: contexts.damage.apply(ops.setDamageThreshold({ min: 100 })),
      },
      effect_azi_skill_zidianlianzhan_multihit: {
        triggers: [EffectTrigger.BeforeMultiHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_zidianlianzhan'), opponentRageBelow50),
        apply: contexts.skillUse.apply(ops.addMultihitResult(1)),
      },
      effect_azi_skill_zidianjueguang_extra: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_zidianjueguang'), opponentRageAbove50),
        apply: contexts.skillUse
          .flatMap(event => (event.actualTarget ? [event.actualTarget] : []))
          .apply(ops.dealDamage(75)),
      },
      effect_azi_skill_tiaoxin_heal: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_tiaoxin')),
        apply: ownerPet.apply(
          ops.heal(
            ownerPet
              .first()
              .attribute('maxHp')
              .map(maxHp => Math.floor(maxHp * 0.25)),
          ),
        ),
      },
      effect_azi_skill_tiaoxin_opponent_rage: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_tiaoxin')),
        apply: opponentActive.apply(ops.addRage(20)),
      },
    })
  }
}
