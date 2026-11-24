import {
  Category,
  DamageType,
  actions,
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
  type Action,
  type Condition,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'
import { preventedBySourceMark, reflectedHalfHpLoss } from './damage-benefits.effect'
import { physicalDamage, specialDamage } from './damage-conditions'
import { ruleConsumedSourceMark, sourceMarkOnLastTurn, requireMark } from './mark-queries'

const OVERLOAD = 'mark_guozai_atongtie'
const PHYSICAL_ABSORB = 'mark_wulixishou_atongtie'
const SPECIAL_REFLECT = 'mark_teshufanshe_atongtie'
const SPECIAL_REBOUND = 'mark_tefongfantan_atongtie'
const ATK_HALF = 'mark_wugongjianban_atongtie'
const PROPERTY_FAIL = 'mark_shuxingshixiao_atongtie'
const ENRAGE = 'mark_jinu_atongtie'

const reflectedDamage = reflectedHalfHpLoss(182)

@effectGroup({ id: 'atongtie' })
export class AtongtieEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const overload = requireMark(marks, OVERLOAD)
    const physicalAbsorb = requireMark(marks, PHYSICAL_ABSORB)
    const specialReflect = requireMark(marks, SPECIAL_REFLECT)
    const specialRebound = requireMark(marks, SPECIAL_REBOUND)
    const atkHalf = requireMark(marks, ATK_HALF)
    const propertyFail = requireMark(marks, PROPERTY_FAIL)
    const enrage = requireMark(marks, ENRAGE)

    const ownerHasOverload = targets.ownerMarks.condition((_, list) =>
      list.some(mark => mark.baseId === OVERLOAD && mark.isActive),
    )

    const ownerHpBelowQuarter = targets.ownerPet.condition((_, pets) => {
      const pet = pets[0]
      if (!pet) return false
      return pet.currentHp * 4 < pet.stat.maxHp
    })

    const ownerMaxHp = targets.ownerPet.first().attribute('maxHp')

    const addOverload = targets.ownerPet.apply(ops.addMark(overload, { stack: 1 }))
    const addPhysicalAbsorb = targets.ownerPet.apply(ops.addMark(physicalAbsorb, { stack: 1 }))
    const addSpecialReflect = targets.ownerPet.apply(ops.addMark(specialReflect, { stack: 1 }))
    const addSpecialRebound = targets.ownerPet.apply(ops.addMark(specialRebound, { stack: 1 }))
    const addAtkHalf = targets.opponentActive.apply(ops.addMark(atkHalf, { stack: 1 }))
    const addPropertyFail = targets.opponentActive.apply(ops.addMark(propertyFail, { stack: 1 }))
    const addEnrage = targets.opponentActive.apply(ops.addMark(enrage, { stack: 1 }))

    const rollSecondary = (percent: number) => conditions.chance(percent)

    const secondaryOnHit = (percent: number, action: Action<EffectTrigger.OnHit>): Action<EffectTrigger.OnHit> =>
      actions.choose(conditions.all(conditions.selfUsesSkill, rollSecondary(percent)), action)

    const statusSkillAction = (action: Action<EffectTrigger.OnHit>): Action<EffectTrigger.OnHit> =>
      actions.choose(conditions.selfUsesSkill, action)

    return defineEffects({
      effect_ability_add_mark_self_guozai_at_100_rage_on_gain_or_turn_start: {
        triggers: [EffectTrigger.OnRageGain, EffectTrigger.TurnStart] as const,
        priority: 0,
        when: (ctx => {
          if (ctx.trigger === EffectTrigger.OnRageGain) {
            return conditions.ownerReceivesRage(ctx) && conditions.ownerIsActive(ctx)
          }
          return conditions.ownerIsActive(ctx)
        }) satisfies Condition<EffectTrigger.OnRageGain | EffectTrigger.TurnStart>,
        apply: (ctx => {
          const pet = ctx.read(targets.ownerPet.first())
          if (!pet) return
          if (pet.currentRage >= 100) addOverload(ctx)
        }) satisfies Action<EffectTrigger.OnRageGain | EffectTrigger.TurnStart>,
      },
      effect_emblem_deal_opponent_fixed_damage_100_if_defeated_with_guozai: {
        triggers: [EffectTrigger.OnDefeat] as const,
        priority: 0,
        when: conditions.all(conditions.ownerIsSkillTarget, ownerHasOverload),
        apply: targets.opponentActive.apply(ops.dealDamage(100)),
      },
      effect_skill_add_mark_opponent_wugongjianban_100_percent_on_apply: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        apply: secondaryOnHit(100, addAtkHalf),
      },
      effect_skill_add_mark_self_wulixishou: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        apply: statusSkillAction(addPhysicalAbsorb),
      },
      effect_skill_add_mark_self_tefongfantan_100_percent_on_apply: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        apply: secondaryOnHit(100, addSpecialRebound),
      },
      effect_skill_add_mark_self_teshufanshe: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        apply: statusSkillAction(addSpecialReflect),
      },
      effect_skill_add_mark_opponent_shuxingshixiao_100_percent_on_apply: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        apply: secondaryOnHit(100, addPropertyFail),
      },
      effect_skill_add_mark_opponent_jinu: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        apply: statusSkillAction(addEnrage),
      },
      effect_skill_sure_hit_if_self_hp_below_quarter_before_check: {
        triggers: [EffectTrigger.BeforeUseSkillCheck] as const,
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ownerHpBelowQuarter),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_skill_add_rage_20_10_percent_on_hit: {
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, rollSecondary(10)),
        apply: targets.ownerPet.apply(ops.addRage(20)),
      },
      effect_mark_prevent_rage_changes_except_climax_cost: {
        triggers: [EffectTrigger.BeforeRageGain, EffectTrigger.BeforeRageLoss] as const,
        priority: 0,
        when: conditions.all(conditions.ownerIsActive, conditions.ownerReceivesRage),
        apply: (ctx => {
          if (ctx.trigger === EffectTrigger.BeforeRageGain) {
            contexts.rage.apply(ops.limitRageGain(0))(ctx)
          } else if (!(
            ctx.parent.reason === 'skill' && ctx.read(contexts.skillUse.first())?.category === Category.Climax
          )) {
            contexts.rage.apply(ops.disableContext())(ctx)
          }
        }) satisfies Action<EffectTrigger.BeforeRageGain | EffectTrigger.BeforeRageLoss>,
      },
      effect_mark_remove_self_after_climax_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.category === Category.Climax)),
        ),
        apply: targets.sourceMark.apply(ops.removeMark()),
      },
      effect_mark_replace_physical_attack_damage_below_max_hp_sixth_with_heal: {
        triggers: [EffectTrigger.OnDamageReplacement],
        when: conditions.all(
          conditions.selfBeDamaged,
          physicalDamage,
          contexts.damage.condition((_, hits) =>
            hits.some(hit => hit.origin.trigger !== 'effect' && hit.damageResult < hit.target.stat.maxHp / 6),
          ),
        ),
        apply: contexts.damage.apply(ops.replaceDamageWithHeal(1, 1)),
      },
      effect_mark_prevent_special_attack_damage_above_max_hp_half_and_consume_1: {
        triggers: [EffectTrigger.OnDamageReplacement],
        when: conditions.all(
          conditions.selfBeDamaged,
          specialDamage,
          contexts.damage.condition((_, hits) =>
            hits.some(hit => hit.origin.trigger !== 'effect' && hit.damageResult > hit.target.stat.maxHp / 2),
          ),
        ),
        apply: contexts.damage.apply(ops.preventDamage({ stacks: 1 })),
      },
      effect_mark_return_prevented_damage_capped_at_owner_max_hp_on_rule_consume: {
        triggers: [EffectTrigger.OnConsumeStack],
        when: ruleConsumedSourceMark,
        apply: ctx => {
          const prevented = preventedBySourceMark(ctx)
          const cap = ctx.read(ownerMaxHp) ?? 0
          targets.damageOriginPet.apply(ops.dealDamage(Math.min(prevented, cap)))(ctx)
        },
      },
      effect_mark_return_half_special_attack_hp_loss_max_182_next_turn: {
        triggers: [EffectTrigger.OnDamage] as const,
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          sourceMarkOnLastTurn,
          specialDamage,
          contexts.damage.condition((_, hits) => hits.some(hit => hit.origin.trigger !== 'effect')),
        ),
        apply: (ctx => {
          const reflected = ctx.read(reflectedDamage) ?? 0
          if (reflected > 0)
            targets.damageOriginPet.apply(ops.dealDamage(reflected, { damageType: DamageType.Special }))(ctx)
        }) satisfies Action<EffectTrigger.OnDamage>,
      },
      effect_mark_reduce_outgoing_physical_damage_50_percent_next_turn: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage] as const,
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, sourceMarkOnLastTurn, physicalDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -50, delta: 0 })),
      },
      effect_mark_sure_miss_for_status_skills_next_turn: {
        triggers: [EffectTrigger.BeforeUseSkillCheck] as const,
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          sourceMarkOnLastTurn,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.category === Category.Status)),
        ),
        apply: contexts.skillUse.apply(ops.setSureMiss()),
      },
      effect_mark_add_opponent_rage_30_after_owner_status_skill_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.category === Category.Status)),
        ),
        apply: targets.opponentActive.apply(ops.addRage(30)),
      },
    })
  }
}
