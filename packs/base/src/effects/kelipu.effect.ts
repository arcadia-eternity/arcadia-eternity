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

const RESERVE = 'mark_chubeixiang'
const ILLUM = 'mark_zhaomingdan'
const BURN = 'mark_shaoshang'
const FROST = 'mark_dongshang'
const HITDOWN = 'mark_mingzhongxiajiang'
const BURIED = 'mark_qiandidan'

const reserveMarks = targets.ownerMarks.where(mark => mark.baseId === RESERVE && mark.isActive)
const reserveCount = reserveMarks.first().map(mark => mark.stack)

const flyingTarget = targets.opponentActive.condition((_, pets) => pets.some(pet => pet.element === 'Flying'))
const groundTarget = targets.opponentActive.condition((_, pets) => pets.some(pet => pet.element === 'Ground'))
const waterTarget = targets.opponentActive.condition((_, pets) => pets.some(pet => pet.element === 'Water'))
const grassTarget = targets.opponentActive.condition((_, pets) => pets.some(pet => pet.element === 'Grass'))
const fireTarget = targets.opponentActive.condition((_, pets) => pets.some(pet => pet.element === 'Fire'))

const opponentActive = contexts.skillUse.flatMap(event => (event.actualTarget ? [event.actualTarget] : []))

function extraDamageOnType(typeCondition: Condition, amount: number, skillId: string) {
  return {
    triggers: [EffectTrigger.OnHit] as const,
    priority: 0,
    when: conditions.all(
      conditions.selfUsesSkill,
      contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === skillId)),
      typeCondition,
    ),
    apply: opponentActive.apply(ops.dealDamage(amount)),
  }
}

@effectGroup({ id: 'kelipu' })
export class KelipuEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const reserve = marks.get(RESERVE)
    const illum = marks.get(ILLUM)
    const burn = marks.get(BURN)
    const frost = marks.get(FROST)
    const hitDown = marks.get(HITDOWN)
    const buried = marks.get(BURIED)
    if (!reserve || !illum || !burn || !frost || !hitDown || !buried) {
      throw new Error('Missing kelipu marks')
    }

    const addReserve = targets.ownerPet.apply(ops.addMark(reserve, { stack: 1 }))
    const addIllum = targets.ownerPet.apply(ops.addMark(illum, { stack: 1 }))
    const addBuried = targets.opponentActive.apply(ops.addMark(buried, { stack: 1 }))

    const burnOnGrass = {
      triggers: [EffectTrigger.OnHit] as const,
      priority: 0,
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_ranshaodan')),
        grassTarget,
      ),
      apply: targets.opponentActive.apply(ops.addMark(burn, { stack: 1 })),
    }

    const frostOnFire = {
      triggers: [EffectTrigger.OnHit] as const,
      priority: 0,
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_lengningdan')),
        fireTarget,
      ),
      apply: targets.opponentActive.apply(ops.addMark(frost, { stack: 1 })),
    }

    const hitDownOnHit = {
      triggers: [EffectTrigger.OnHit] as const,
      priority: 0,
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.skillUse.condition((_, events) =>
          events.some(event => event.skill.baseId === 'skill_xingguangfangongdan'),
        ),
      ),
      apply: targets.opponentActive.apply(ops.addMark(hitDown, { stack: 15 })),
    }

    const reserveDamageBonus = {
      triggers: [EffectTrigger.OnBeforeCalculateDamage] as const,
      priority: 0,
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.damage.condition((_, events) =>
          events.some(event => event.damageType === 'Physical' || event.damageType === 'Special'),
        ),
        ctx => (ctx.read(reserveCount) ?? 0) > 0,
      ),
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
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_sanshedan')),
      ),
      apply: contexts.skillUse.apply(ops.addMultihitResult(reserveCount)),
    }

    const buriedOnSwitchIn = {
      triggers: [EffectTrigger.OnSwitchIn] as const,
      priority: 0,
      when: conditions.ownerSwitchesIn,
      apply: targets.ownerPet.apply(ops.dealDamage(150)),
    }

    return defineEffects({
      effect_kelipu_ability_reserve_damage: reserveDamageBonus,
      effect_kelipu_ability_reserve_rage: reserveRageDiscount,
      effect_kelipu_emblem_reserve_cap: {
        triggers: [EffectTrigger.OnBeforeAddMark] as const,
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_, events) => events.some(event => event.baseMark.id === RESERVE)),
        ),
        apply: contexts.addMark.apply(ops.setMarkMaxStack(4)),
      },
      effect_kelipu_skill_xitongqianghua: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, events) =>
            events.some(event => event.skill.baseId === 'skill_xitongqianghua'),
          ),
        ),
        apply: targets.ownerPet.apply(ops.changeStatStage('spa', 1)),
      },
      effect_kelipu_skill_chubeidan: {
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_chubeidan')),
        ),
        apply: addReserve,
      },
      effect_kelipu_skill_kongkongdan: extraDamageOnType(flyingTarget, 40, 'skill_kongkongdan'),
      effect_kelipu_skill_rejiasu: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_rejiasu')),
        ),
        apply: targets.ownerPet.apply(ops.changeStatStage('spe', 1)),
      },
      effect_kelipu_skill_kongdidan: extraDamageOnType(groundTarget, 40, 'skill_kongdidan'),
      effect_kelipu_skill_ranshaodan: burnOnGrass,
      effect_kelipu_skill_konghangdan: extraDamageOnType(waterTarget, 40, 'skill_konghangdan'),
      effect_kelipu_skill_lengningdan: frostOnFire,
      effect_kelipu_skill_sanshedan: scatterMultihit,
      effect_kelipu_skill_xingguangfangongdan: hitDownOnHit,
      effect_kelipu_skill_zhaomingdan: {
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_zhaomingdan')),
        ),
        apply: addIllum,
      },
      effect_kelipu_skill_jiangyudan: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_jiangyudan')),
        ),
        apply: contexts.battle.apply(ops.addMark(marks.get('mark_global_yutian')!, { stack: 1 })),
      },
      effect_kelipu_skill_daijizhuangtai: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, events) =>
            events.some(event => event.skill.baseId === 'skill_daijizhuangtai'),
          ),
        ),
        apply: targets.ownerPet.apply(ops.addMark(reserve, { stack: 2 })),
      },
      effect_kelipu_skill_qiandidan: {
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_qiandidan')),
        ),
        apply: addBuried,
      },
      effect_kelipu_mark_qiandidan_switch: buriedOnSwitchIn,
      effect_kelipu_mark_zhaomingdan_reduce: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage] as const,
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          contexts.damage.condition((_, events) =>
            events.some(event => event.damageType === 'Physical' || event.damageType === 'Special'),
          ),
          contexts.damageSkill.condition((_, skills) => skills.some(skill => skill.element === 'Shadow')),
        ),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -35, delta: 0 })),
      },
    })
  }
}
