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
    const flame = marks.get(FLAME)
    if (!burn || !confusion || !flame) {
      throw new Error('Missing kaise mark dependency')
    }

    const burnTarget = targets.opponentActive.apply(ops.addMark(burn))
    const confuseTarget = targets.opponentActive.apply(ops.addMark(confusion))
    const flameTarget = targets.opponentActive.apply(ops.addMark(flame, { stack: 1 }))

    return defineEffects({
      effect_mark_consume_self_2_stacks_deal_100_fixed_damage_on_stack: {
        triggers: [EffectTrigger.OnStack],
        priority: 0,
        when: ctx => ctx.parent.existingMark === ctx.read(targets.sourceMark.first()) && ctx.parent.stacksAfter >= 2,
        apply: ctx => {
          targets.sourceMark.apply(ops.consumeStacks(2))(ctx)
          targets.ownerPet.apply(ops.dealDamage(100))(ctx)
        },
      },
      effect_ability_deal_opponent_special_damage_6_percent_max_hp_capped_at_100_in_field_yanre: {
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
      effect_emblem_increase_damage_10_percent_if_opponent_has_mark_shaoshang: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentBurned),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 10, delta: 0 })),
      },
      effect_skill_add_mark_opponent_shaoshang_in_field_yanre: hotSecondary(100, burnTarget),
      effect_skill_add_mark_opponent_huomiao_1_in_field_yanre: hotSecondary(100, flameTarget),
      effect_skill_add_mark_opponent_shaoshang_10_percent_any_element: secondaryHit(10, burnTarget),
      effect_skill_add_power_30_in_field_yanre_before_damage: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hotActive),
        apply: contexts.skillUse.apply(ops.addPower(30)),
      },
      effect_skill_add_mark_opponent_shaoshang_15_percent_any_element: secondaryHit(15, burnTarget),
      effect_skill_add_mark_opponent_hunmi_in_field_yanre: hotSecondary(100, confuseTarget),
    })
  }
}
