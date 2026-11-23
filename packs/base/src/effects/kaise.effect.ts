import {
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

const BURN = 'mark_shaoshang'
const CONFUSION = 'mark_hunmi'
const IMMUNE_STATUS = 'mark_mianyibuliang'
const FLAME = 'mark_huomiao'
const HOT = 'mark_global_yanre'

const hotActive = contexts.battle.condition((_, battles) =>
  battles.some(battle => battle.marks.some(mark => mark.baseId === HOT && mark.isActive)),
)

const opponentBurned = targets.opponentActive.condition((_, pets) =>
  pets.some(pet => pet.marks.some(mark => mark.baseId === BURN && mark.isActive)),
)

function secondaryHit(percent: number, action: Action) {
  return {
    triggers: [EffectTrigger.OnHit] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, conditions.chance(percent)),
    apply: action,
  }
}

function hotSecondary(percent: number, action: Action) {
  return {
    triggers: [EffectTrigger.OnHit] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, hotActive, conditions.chance(percent)),
    apply: action,
  }
}

@effectGroup({ id: 'kaise' })
export class KaiseEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const burn = marks.get(BURN)
    const confusion = marks.get(CONFUSION)
    const immuneStatus = marks.get(IMMUNE_STATUS)
    const flame = marks.get(FLAME)
    if (!burn || !confusion || !immuneStatus || !flame) {
      throw new Error('Missing kaise mark dependency')
    }

    const burnTarget = targets.opponentActive.apply(ops.addMark(burn))
    const confuseTarget = targets.opponentActive.apply(ops.addMark(confusion))
    const flameTarget = targets.opponentActive.apply(ops.addMark(flame, { stack: 1 }))

    return defineEffects({
      effect_kaise_mark_huomiao_explode: {
        triggers: [EffectTrigger.OnStack],
        priority: 0,
        when: ctx => ctx.parent.existingMark === ctx.read(targets.sourceMark.first()) && ctx.parent.stacksAfter >= 2,
        apply: ctx => {
          targets.sourceMark.apply(ops.consumeStacks(2))(ctx)
          targets.ownerPet.apply(ops.dealDamage(100))(ctx)
        },
      },
      effect_kaise_ability_hot_burn: {
        triggers: [EffectTrigger.TurnEnd],
        priority: 0,
        when: conditions.all(conditions.ownerIsActive, hotActive),
        apply: targets.opponentActive.apply(
          ops.dealDamage(
            targets.opponentActive.select(pet => Math.min(100, Math.floor(pet.stat.maxHp * 0.06))).first(),
            { damageType: DamageType.Special },
          ),
        ),
      },
      effect_kaise_emblem_burn_damage: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentBurned),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 10, delta: 0 })),
      },
      effect_kaise_skill_chirehuoyan_burn: hotSecondary(100, burnTarget),
      effect_kaise_skill_chirehuomiao_flame: hotSecondary(100, flameTarget),
      effect_kaise_skill_zhuoreyiji_spa: secondaryHit(10, targets.ownerPet.apply(ops.changeStatStage('spa', 1))),
      effect_kaise_skill_huoyanpenshe_burn: secondaryHit(10, burnTarget),
      effect_kaise_skill_lieyanzhiqu_immune: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(immuneStatus, { stack: 1, duration: -1 })),
      },
      effect_kaise_skill_chiretuji_power: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hotActive),
        apply: contexts.skillUse.apply(ops.addPower(30)),
      },
      effect_kaise_skill_yehuoliaoyuan_burn: secondaryHit(15, burnTarget),
      effect_kaise_skill_huoyanzhiwu_confuse: hotSecondary(100, confuseTarget),
    })
  }
}
