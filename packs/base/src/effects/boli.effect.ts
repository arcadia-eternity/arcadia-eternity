import {
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
  values,
  type Condition,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

const FEAR = 'mark_haipa'
const CONFUSE = 'mark_hunmi'
const FROSTBITE = 'mark_dongshang'
const ANCESTOR = 'mark_xianzubinghun'

const opponentBelowHalf = targets.opponentActive.condition((_, pets) => {
  const pet = pets[0]
  return !!pet && pet.currentHp * 2 < pet.stat.maxHp
})

const opponentBelowQuarter = targets.opponentActive.condition((_, pets) => {
  const pet = pets[0]
  return !!pet && pet.currentHp * 4 < pet.stat.maxHp
})

const opponentHasFear = targets.opponentActive.condition((_, pets) =>
  pets.some(pet => pet.marks.some(mark => mark.baseId === FEAR && mark.isActive)),
)

const opponentHasConfuse = targets.opponentActive.condition((_, pets) =>
  pets.some(pet => pet.marks.some(mark => mark.baseId === CONFUSE && mark.isActive)),
)

function powerWhen(condition: Condition, multiplier: number) {
  return {
    triggers: [EffectTrigger.AfterUseSkillCheck] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, condition),
    apply: contexts.skillUse.apply(ops.amplifyPower(multiplier)),
  }
}

function secondaryStatus(markId: Parameters<typeof ops.addMark>[0], percent: number) {
  return {
    triggers: [EffectTrigger.OnHit] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, conditions.chance(percent)),
    apply: targets.opponentActive.apply(ops.addMark(markId)),
  }
}

@effectGroup({ id: 'boli' })
export class BoliEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const fear = marks.get(FEAR)
    const confuse = marks.get(CONFUSE)
    const frostbite = marks.get(FROSTBITE)
    const ancestor = marks.get(ANCESTOR)
    if (!fear || !confuse || !frostbite || !ancestor) {
      throw new Error('Missing boli mark dependency')
    }

    return defineEffects({
      effect_boli_ability_damage_boost: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentBelowHalf),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 10, delta: 0 })),
      },
      effect_boli_emblem_sure_hit: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.tags.includes('guaixiao'))),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_boli_skill_hanbingpaoxiao: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentBelowHalf, conditions.chance(50)),
        apply: targets.opponentActive.apply(ops.addMark(confuse)),
      },
      effect_boli_skill_yemanchongji: powerWhen(opponentHasConfuse, 2),
      effect_boli_skill_hanbingshigu: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.opponentActive.apply(
          ops.dealDamage(
            values.combine(
              targets.opponentActive.select(pet => pet.currentHp).first(),
              targets.opponentActive.first().attribute('maxHp'),
              current => Math.min(400, Math.floor(current * 0.13)),
            ),
          ),
        ),
      },
      effect_boli_skill_suiliepaiji: powerWhen(opponentBelowQuarter, 2),
      effect_boli_skill_xianzubinghun: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.opponentActive.apply(ops.addMark(ancestor)),
      },
      effect_boli_skill_hanbingtuxi: secondaryStatus(frostbite, 50),
      effect_boli_skill_bingqinxuemai: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(
          ops.heal(
            values.combine(
              targets.ownerPet.select(pet => pet.currentHp).first(),
              targets.ownerPet.first().attribute('maxHp'),
              (current, max) => {
                const ratio = max > 0 ? current / max : 1
                if (ratio < 0.1) return 120
                if (ratio < 0.4) return 90
                return 60
              },
            ),
          ),
        ),
      },
      effect_boli_skill_hanbingxiaohun: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentBelowHalf, conditions.chance(50)),
        apply: targets.opponentActive.apply(ops.addMark(fear)),
      },
      effect_boli_skill_manxiongzhili: powerWhen(opponentHasFear, 2),
      effect_boli_skill_guaixiaobenxi: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentBelowHalf),
        apply: targets.opponentActive.apply(ops.changeStatStage('def', -1)),
      },
      effect_boli_ancestor_block_heal: {
        triggers: [EffectTrigger.OnBeforeHeal],
        priority: 0,
        when: conditions.selfBeHealed,
        apply: contexts.heal.apply(ops.disableContext()),
      },
    })
  }
}
