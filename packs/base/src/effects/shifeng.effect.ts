import {
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  numberParam,
  ops,
  targets,
  type Action,
  type Condition,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'
import { physicalOrSpecialDamage } from './damage-conditions'
import { activeOwnerMarks, requireMark } from './mark-queries'
import { actualSkillTarget } from './skill-queries'

const NEEDLES = 'mark_fenghuangzhen'
const POISON = 'mark_zhongdu'
const PARALYSIS = 'mark_mabi'

const needles = activeOwnerMarks(NEEDLES)
const remainingNeedles = needles.first().attribute('stack')
const spendNeedle = needles.apply(ops.consumeStacks(1))
function needleHit(secondary: Action, trigger: EffectTrigger.OnHit | EffectTrigger.BeforeHit, tags: string[]) {
  const chance = numberParam({ default: 40, tags: ['skill_effect_probability', ...tags] })
  const rollSecondary = conditions.chance(chance)
  return {
    triggers: [trigger] as const,
    priority: 0,
    parameters: { chance },
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

function powerWhen(gender: Condition, bonus: number) {
  return {
    triggers: [EffectTrigger.AfterUseSkillCheck] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, gender),
    apply: contexts.skillUse.apply(ops.addPower(bonus)),
  }
}

function drainWhen(gender: Condition, amount: number) {
  const drain = actualSkillTarget.apply(ops.dealDamage(amount))
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
    const needleMark = requireMark(marks, NEEDLES)
    const poison = requireMark(marks, POISON)
    const paralysis = requireMark(marks, PARALYSIS)

    return defineEffects({
      effect_ability_add_mark_self_fenghuangzhen_3_on_battle_start: {
        triggers: [EffectTrigger.OnBattleStart],
        priority: 0,
        apply: targets.ownerPet.apply(ops.addMark(needleMark, { stack: 3 })),
      },
      effect_ability_block_abnormal_status_when_fenghuangzhen_depleted: {
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
      effect_emblem_increase_attack_damage_5_percent_if_male: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, male, physicalOrSpecialDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 5, delta: 0 })),
      },
      effect_emblem_reduce_incoming_attack_damage_5_percent_if_female: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, female, physicalOrSpecialDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -5, delta: 0 })),
      },
      effect_skill_add_mark_opponent_zhongdu_40_percent_or_consume_fenghuangzhen: needleHit(
        targets.opponentActive.apply(ops.addMark(poison)),
        EffectTrigger.OnHit,
        [],
      ),
      effect_skill_add_mark_opponent_mabi_40_percent_or_consume_fenghuangzhen: needleHit(
        targets.opponentActive.apply(ops.addMark(paralysis)),
        EffectTrigger.OnHit,
        ['mark_mabi_chance'],
      ),
      effect_skill_reduce_opponent_spe_1_stage_40_percent_or_consume_fenghuangzhen: needleHit(
        targets.opponentActive.apply(ops.changeStatStage('spe', -1)),
        EffectTrigger.BeforeHit,
        [],
      ),
      effect_skill_add_power_10_if_female: powerWhen(female, 10),
      effect_skill_add_power_50_if_male: powerWhen(male, 50),
      effect_skill_add_power_50_if_female: powerWhen(female, 50),
      effect_skill_drain_hp_50_if_male: drainWhen(male, 50),
      effect_skill_drain_hp_65_if_female: drainWhen(female, 65),
    })
  }
}
