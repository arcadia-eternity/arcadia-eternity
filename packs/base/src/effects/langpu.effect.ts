import {
  conditions,
  contexts,
  DamageType,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
  type Action,
  type Condition,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

const COUNTER_CRIT = 'mark_huixin'

const attackDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Physical || event.damageType === DamageType.Special),
)

const critDamage = contexts.damage.condition((_, events) => events.some(event => event.crit))

const notCritDamage = contexts.damage.condition((_, events) => events.every(event => !event.crit))

const opponentIsIce = targets.opponentActive.condition((_, pets) => pets.some(pet => pet.element === 'Ice'))

const skillTarget = contexts.skillUse.flatMap(event => (event.actualTarget ? [event.actualTarget] : []))

function healFraction(fraction: number) {
  return {
    triggers: [EffectTrigger.AfterUseSkillCheck] as const,
    priority: 0,
    when: conditions.selfUsesSkill,
    apply: targets.ownerPet.apply(
      ops.heal(targets.ownerPet.select(pet => Math.floor(pet.stat.maxHp * fraction)).first()),
    ),
  }
}

function rageOnNoCrit(amount: number) {
  return {
    triggers: [EffectTrigger.OnDamage] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, notCritDamage),
    apply: targets.ownerPet.apply(ops.addRage(amount)),
  }
}

function powerOnNoCrit(bonus: number) {
  return {
    triggers: [EffectTrigger.AfterUseSkillCheck] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, notCritDamage),
    apply: contexts.skillUse.apply(ops.addPower(bonus)),
  }
}

function flatDamageOnNoCrit(amount: number) {
  return {
    triggers: [EffectTrigger.OnDamage] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, notCritDamage),
    apply: skillTarget.apply(ops.dealDamage(amount)),
  }
}

function icePowerDouble() {
  return {
    triggers: [EffectTrigger.AfterUseSkillCheck] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, opponentIsIce),
    apply: contexts.skillUse.apply(ops.amplifyPower(2)),
  }
}

@effectGroup({ id: 'langpu' })
export class LangpuEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const counterCrit = marks.get(COUNTER_CRIT)
    if (!counterCrit) throw new Error('Missing langpu mark dependency')

    return defineEffects({
      effect_langpu_ability_crit_reduction: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, attackDamage, critDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -35, delta: 0 })),
      },
      effect_langpu_ability_crit_counter: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, attackDamage, critDamage),
        apply: targets.ownerPet.apply(ops.addMark(counterCrit)),
      },
      effect_langpu_emblem_crit_damage: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, attackDamage, critDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 15, delta: 0 })),
      },
      effect_langpu_skill_bingbao: rageOnNoCrit(15),
      effect_langpu_skill_suibing: icePowerDouble(),
      effect_langpu_skill_hanbingzhiti: powerOnNoCrit(35),
      effect_langpu_skill_hanguang: healFraction(0.25),
      effect_langpu_skill_xuebeng: flatDamageOnNoCrit(40),
      effect_langpu_skill_xuerenpaoxiao: {
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.chance(20)),
        apply: targets.ownerPet.apply(ops.changeStatStage('atk', 1)),
      },
      effect_langpu_skill_hanbingfanshi: {
        triggers: [EffectTrigger.BeforeUseSkillCheck, EffectTrigger.OnBeforeCalculateDamage] as const,
        priority: 0,
        when: (ctx =>
          ctx.trigger === EffectTrigger.BeforeUseSkillCheck
            ? conditions.selfUsesSkill(ctx)
            : conditions.all(conditions.selfUsesSkill, attackDamage)(ctx)) satisfies Condition<
          EffectTrigger.BeforeUseSkillCheck | EffectTrigger.OnBeforeCalculateDamage
        >,
        apply: (ctx => {
          if (ctx.trigger === EffectTrigger.BeforeUseSkillCheck) {
            contexts.skillUse.property('priority').apply(ops.add(-1))(ctx)
          } else {
            contexts.damage.apply(ops.setDamageThreshold({ min: 95 }))(ctx)
          }
        }) satisfies Action<EffectTrigger.BeforeUseSkillCheck | EffectTrigger.OnBeforeCalculateDamage>,
      },
      effect_langpu_skill_hanbingzhenji: powerOnNoCrit(40),
      effect_langpu_skill_daxuebeng: flatDamageOnNoCrit(50),
    })
  }
}
