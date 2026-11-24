import {
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
  type Condition,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'
import { physicalOrSpecialDamage } from './damage-conditions'
import { activeOwnerMarks, requireMark } from './mark-queries'
import { actualSkillTarget, opponentHasElement } from './skill-queries'

const RESERVE = 'mark_chubeixiang'
const ILLUM = 'mark_zhaomingdan'
const BURN = 'mark_shaoshang'
const FROST = 'mark_dongshang'
const BURIED = 'mark_qiandidan'

const reserveMarks = activeOwnerMarks(RESERVE)
const reserveCount = reserveMarks.first().map(mark => mark.stack)

const flyingTarget = opponentHasElement('Flying')
const groundTarget = opponentHasElement('Ground')
const waterTarget = opponentHasElement('Water')
const grassTarget = opponentHasElement('Grass')
const fireTarget = opponentHasElement('Fire')

function extraDamageOnType(typeCondition: Condition, amount: number) {
  return {
    triggers: [EffectTrigger.OnHit] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, typeCondition),
    apply: actualSkillTarget.apply(ops.dealDamage(amount)),
  }
}

@effectGroup({ id: 'kelipu' })
export class KelipuEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const reserve = requireMark(marks, RESERVE)
    const illum = requireMark(marks, ILLUM)
    const burn = requireMark(marks, BURN)
    const frost = requireMark(marks, FROST)
    const buried = requireMark(marks, BURIED)

    const addReserve = targets.ownerPet.apply(ops.addMark(reserve, { stack: 1 }))
    const addIllum = targets.ownerPet.apply(ops.addMark(illum, { stack: 1 }))
    const addBuried = targets.opponentActive.apply(ops.addMark(buried, { stack: 1 }))

    const burnOnGrass = {
      triggers: [EffectTrigger.OnHit] as const,
      priority: 0,
      when: conditions.all(conditions.selfUsesSkill, grassTarget),
      apply: targets.opponentActive.apply(ops.addMark(burn, { stack: 1 })),
    }

    const frostOnFire = {
      triggers: [EffectTrigger.OnHit] as const,
      priority: 0,
      when: conditions.all(conditions.selfUsesSkill, fireTarget),
      apply: targets.opponentActive.apply(ops.addMark(frost, { stack: 1 })),
    }

    const reserveDamageBonus = {
      triggers: [EffectTrigger.OnBeforeCalculateDamage] as const,
      priority: 0,
      when: conditions.all(conditions.selfUsesSkill, physicalOrSpecialDamage, ctx => (ctx.read(reserveCount) ?? 0) > 0),
      apply: contexts.damage.apply(ops.modifyDamage({ percent: 10, delta: 0 })),
    }

    const reserveRageDiscount = {
      triggers: [EffectTrigger.BeforeUseSkillCheck] as const,
      priority: 0,
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.skillUse.condition((_, events) => events.some(event => event.skill.category === 'Special')),
        ctx => (ctx.read(reserveCount) ?? 0) > 0,
      ),
      apply: contexts.skillUse.property('rage').apply(ops.add(reserveCount.map(count => -5 * count))),
    }

    const scatterMultihit = {
      triggers: [EffectTrigger.BeforeMultiHit] as const,
      priority: 0,
      when: conditions.selfUsesSkill,
      apply: contexts.skillUse.apply(ops.addMultihitResult(reserveCount)),
    }

    const buriedOnSwitchIn = {
      triggers: [EffectTrigger.OnSwitchIn] as const,
      priority: 0,
      when: conditions.ownerSwitchesIn,
      apply: targets.ownerPet.apply(ops.dealDamage(150)),
    }

    return defineEffects({
      effect_ability_increase_attack_damage_10_percent_with_chubeixiang: reserveDamageBonus,
      effect_ability_reduce_special_skill_rage_cost_5_per_chubeixiang_stack: reserveRageDiscount,
      effect_emblem_set_chubeixiang_max_stacks_4: {
        triggers: [EffectTrigger.OnBeforeAddMark] as const,
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_, events) => events.some(event => event.baseMark.id === RESERVE)),
        ),
        apply: contexts.addMark.apply(ops.setMarkMaxStack(4)),
      },
      effect_skill_add_mark_self_chubeixiang_1_on_hit: {
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: addReserve,
      },
      effect_skill_deal_40_fixed_damage_to_flying_opponent_on_hit: extraDamageOnType(flyingTarget, 40),
      effect_skill_deal_40_fixed_damage_to_ground_opponent_on_hit: extraDamageOnType(groundTarget, 40),
      effect_skill_add_mark_opponent_shaoshang_if_grass: burnOnGrass,
      effect_skill_deal_40_fixed_damage_to_water_opponent_on_hit: extraDamageOnType(waterTarget, 40),
      effect_skill_add_mark_opponent_dongshang_if_fire: frostOnFire,
      effect_skill_add_multihit_per_chubeixiang_stack: scatterMultihit,
      effect_skill_add_mark_self_zhaomingdan_on_hit: {
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: addIllum,
      },
      effect_skill_add_mark_self_chubeixiang_2_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(reserve, { stack: 2 })),
      },
      effect_skill_add_mark_opponent_qiandidan_on_hit: {
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: addBuried,
      },
      effect_mark_damage_owner_150_on_switch_in: buriedOnSwitchIn,
      effect_mark_reduce_shadow_attack_damage_taken_35_percent: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage] as const,
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          physicalOrSpecialDamage,
          contexts.damageSkill.condition((_, skills) => skills.some(skill => skill.element === 'Shadow')),
        ),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -35, delta: 0 })),
      },
    })
  }
}
