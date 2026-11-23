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

import { preventedBySourceMark } from './damage-benefits.effect'

const OVERLOAD = 'mark_guozai_atongtie'
const PHYSICAL_ABSORB = 'mark_wulixishou_atongtie'
const SPECIAL_REFLECT = 'mark_teshufanshe_atongtie'
const SPECIAL_REBOUND = 'mark_tefongfantan_atongtie'
const ATK_HALF = 'mark_wugongjianban_atongtie'
const PROPERTY_FAIL = 'mark_shuxingshixiao_atongtie'
const ENRAGE = 'mark_jinu_atongtie'

const physicalDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Physical),
)
const specialDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Special),
)
const nextTurn = targets.sourceMark.condition((_, marks) => marks.some(mark => mark.duration === 1))

@effectGroup({ id: 'atongtie' })
export class AtongtieEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const overload = marks.get(OVERLOAD)
    const physicalAbsorb = marks.get(PHYSICAL_ABSORB)
    const specialReflect = marks.get(SPECIAL_REFLECT)
    const specialRebound = marks.get(SPECIAL_REBOUND)
    const atkHalf = marks.get(ATK_HALF)
    const propertyFail = marks.get(PROPERTY_FAIL)
    const enrage = marks.get(ENRAGE)
    if (!overload || !physicalAbsorb || !specialReflect || !specialRebound || !atkHalf || !propertyFail || !enrage) {
      throw new Error('Missing atongtie mark definitions')
    }

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
      effect_atongtie_ability_overload: {
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
      effect_atongtie_emblem_overload_defeat: {
        triggers: [EffectTrigger.OnDefeat] as const,
        priority: 0,
        when: conditions.all(conditions.ownerIsSkillTarget, ownerHasOverload),
        apply: targets.opponentActive.apply(ops.dealDamage(100)),
      },
      effect_atongtie_skill_wajietuji: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        apply: secondaryOnHit(100, addAtkHalf),
      },
      effect_atongtie_skill_wulixishou: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        apply: statusSkillAction(addPhysicalAbsorb),
      },
      effect_atongtie_skill_ganghuatuji: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        apply: secondaryOnHit(100, addSpecialRebound),
      },
      effect_atongtie_skill_teshufanshe: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        apply: statusSkillAction(addSpecialReflect),
      },
      effect_atongtie_skill_zhandouchengxu: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        apply: statusSkillAction(
          actions.sequence(
            targets.ownerPet.apply(ops.changeStatStage('atk', 1)),
            targets.ownerPet.apply(ops.changeStatStage('spa', 1)),
          ),
        ),
      },
      effect_atongtie_skill_chenmentuji: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        apply: secondaryOnHit(100, addPropertyFail),
      },
      effect_atongtie_skill_shengnu: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        apply: statusSkillAction(addEnrage),
      },
      effect_atongtie_skill_chaopinyunzhuan: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        apply: statusSkillAction(targets.ownerPet.apply(ops.changeStatStage('spe', 1))),
      },
      effect_atongtie_skill_qianghuatouchui: {
        triggers: [EffectTrigger.BeforeUseSkillCheck] as const,
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ownerHpBelowQuarter),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_atongtie_skill_atonggangtiepao: {
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, rollSecondary(10)),
        apply: targets.ownerPet.apply(ops.addRage(20)),
      },
      effect_atongtie_mark_guozai_lock_rage: {
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
      effect_atongtie_mark_guozai_end_on_climax: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.category === Category.Climax)),
        ),
        apply: targets.sourceMark.apply(ops.removeMark()),
      },
      effect_atongtie_mark_wulixishou_absorb: {
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
      effect_atongtie_mark_teshufanshe_reflect: {
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
      effect_atongtie_mark_teshufanshe_return: {
        triggers: [EffectTrigger.OnConsumeStack],
        when: ctx => ctx.parent.mark === ctx.read(targets.sourceMark.first()) && ctx.parent.reason === 'rule',
        apply: ctx => {
          const prevented = preventedBySourceMark(ctx)
          const cap = ctx.read(ownerMaxHp) ?? 0
          targets.damageOriginPet.apply(ops.dealDamage(Math.min(prevented, cap)))(ctx)
        },
      },
      effect_atongtie_mark_tefongfantan_rebound: {
        triggers: [EffectTrigger.OnDamage] as const,
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          nextTurn,
          specialDamage,
          contexts.damage.condition((_, hits) => hits.some(hit => hit.origin.trigger !== 'effect')),
        ),
        apply: (ctx => {
          const loss = ctx.read(contexts.damageResult.select(result => result.hpLoss).first()) ?? 0
          const reflected = Math.min(Math.floor(loss / 2), 182)
          if (reflected > 0)
            targets.damageOriginPet.apply(ops.dealDamage(reflected, { damageType: DamageType.Special }))(ctx)
        }) satisfies Action<EffectTrigger.OnDamage>,
      },
      effect_atongtie_mark_wugongjianban_halve: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage] as const,
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, nextTurn, physicalDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -50, delta: 0 })),
      },
      effect_atongtie_mark_shuxingshixiao_miss: {
        triggers: [EffectTrigger.BeforeUseSkillCheck] as const,
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          nextTurn,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.category === Category.Status)),
        ),
        apply: contexts.skillUse.apply(ops.setSureMiss()),
      },
      effect_atongtie_mark_jinu_rage: {
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
