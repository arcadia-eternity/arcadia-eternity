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

const NEEDLES = 'mark_fenghuangzhen'
const POISON = 'mark_zhongdu'
const PARALYSIS = 'mark_mabi'

const needles = targets.ownerMarks.where(mark => mark.baseId === NEEDLES && mark.isActive)
const remainingNeedles = needles.first().attribute('stack')
const spendNeedle = needles.apply(ops.consumeStacks(1))
const rollSecondary = conditions.chance(40)

function needleHit(secondary: Action) {
  return {
    triggers: [EffectTrigger.OnHit] as const,
    priority: 0,
    when: conditions.selfUsesSkill,
    apply: (ctx => {
      const before = ctx.read(remainingNeedles) ?? 0
      if (before > 0) spendNeedle(ctx)
      const spent = (ctx.read(remainingNeedles) ?? 0) < before
      if (spent || rollSecondary(ctx)) secondary(ctx)
    }) satisfies Action,
  }
}

const male = targets.ownerPet.condition((_, pets) => pets[0]?.gender === 'Male')
const female = targets.ownerPet.condition((_, pets) => pets[0]?.gender === 'Female')
const attackDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Physical || event.damageType === DamageType.Special),
)

function powerWhen(gender: Condition, bonus: number) {
  return {
    triggers: [EffectTrigger.AfterUseSkillCheck] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, gender),
    apply: contexts.skillUse.apply(ops.addPower(bonus)),
  }
}

function drainWhen(gender: Condition, amount: number) {
  const target = contexts.skillUse.flatMap(event => (event.actualTarget ? [event.actualTarget] : []))
  const drain = target.apply(ops.dealDamage(amount))
  const restore = targets.ownerPet.apply(ops.heal(contexts.damageResult.select(result => result.hpLoss).first()))
  return {
    triggers: [EffectTrigger.OnHit, EffectTrigger.OnDamage] as const,
    priority: 0,
    when: (ctx =>
      ctx.trigger === EffectTrigger.OnHit
        ? conditions.selfUsesSkill(ctx) && gender(ctx)
        : conditions.thisEffectCausedDamage(ctx)) satisfies Condition<EffectTrigger.OnHit | EffectTrigger.OnDamage>,
    apply: (ctx => (ctx.trigger === EffectTrigger.OnHit ? drain(ctx) : restore(ctx))) satisfies Action<
      EffectTrigger.OnHit | EffectTrigger.OnDamage
    >,
  }
}

@effectGroup({ id: 'shifeng' })
export class ShifengEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const needleMark = marks.get(NEEDLES)
    const poison = marks.get(POISON)
    const paralysis = marks.get(PARALYSIS)
    if (!needleMark || !poison || !paralysis) throw new Error('Missing needle, poison, or paralysis mark')

    return defineEffects({
      effect_shifeng_ability_init_needles: {
        triggers: [EffectTrigger.OnBattleStart],
        priority: 0,
        apply: targets.ownerPet.apply(ops.addMark(needleMark, { stack: 3 })),
      },
      effect_shifeng_ability_immune_status: {
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          ctx => ctx.read(remainingNeedles) === 0,
          contexts.addMark.condition((_, events) =>
            events.some(({ baseMark }) => baseMark.tags.includes('status') || baseMark.tags.includes('exceptional')),
          ),
        ),
        apply: contexts.addMark.apply(ops.disableContext()),
      },
      effect_shifeng_emblem_male_damage: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, male, attackDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 5, delta: 0 })),
      },
      effect_shifeng_emblem_female_reduction: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, female, attackDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -5, delta: 0 })),
      },
      effect_shifeng_skill_fenghuangduzhen: needleHit(targets.opponentActive.apply(ops.addMark(poison))),
      effect_shifeng_skill_fenghuangjinzhen: needleHit(targets.opponentActive.apply(ops.addMark(paralysis))),
      effect_shifeng_skill_fenghuangmizhen: needleHit(targets.opponentActive.apply(ops.changeStatStage('spe', -1))),
      effect_shifeng_skill_fenghuangzhenwu: powerWhen(female, 10),
      effect_shifeng_skill_xiongfengtuxi: powerWhen(male, 50),
      effect_shifeng_skill_fenghuangchuji: powerWhen(female, 50),
      effect_shifeng_skill_xiongfengzhici: drainWhen(male, 50),
      effect_shifeng_skill_fenghuangjuezhen: drainWhen(female, 65),
    })
  }
}
