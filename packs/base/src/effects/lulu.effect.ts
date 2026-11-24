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

const SANDBUNSHIN = 'mark_shafenshen_lulu'
const ZHIXI = 'mark_zhixi'
const LIUXIE = 'mark_liuxie'
const JUEDUIFANGYU = 'mark_jueduifangyu_lulu'

const sandbunshin = targets.ownerMarks.where(mark => mark.baseId === SANDBUNSHIN && mark.isActive)
const sandbunshinCount = sandbunshin.first().attribute('stack')

function hasSandbunshin(amount: number): Condition {
  return ctx => (ctx.read(sandbunshinCount) ?? 0) >= amount
}

const attackDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Physical || event.damageType === DamageType.Special),
)

@effectGroup({ id: 'lulu' })
export class LuluEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const sandbunshinMark = marks.get(SANDBUNSHIN)
    const zhixi = marks.get(ZHIXI)
    const liuxie = marks.get(LIUXIE)
    const jueduifangyu = marks.get(JUEDUIFANGYU)
    if (!sandbunshinMark || !zhixi || !liuxie || !jueduifangyu) {
      throw new Error('Missing lulu mark dependency')
    }

    function gainSandbunshin(amount: number): Action {
      return ctx => {
        if (!conditions.selfUsesSkill(ctx)) return
        targets.ownerPet.apply(ops.addMark(sandbunshinMark!, { stack: amount }))(ctx)
      }
    }

    function spendForCrit(amount: number, critBonus: number): Action {
      return ctx => {
        if (!conditions.selfUsesSkill(ctx)) return
        if (!hasSandbunshin(amount)(ctx)) return
        sandbunshin.apply(ops.consumeStacks(amount))(ctx)
        contexts.skillUse.apply(ops.addCritRate(critBonus))(ctx)
      }
    }

    function spendForPower(amount: number, multiplier: number): Action {
      return ctx => {
        if (!conditions.selfUsesSkill(ctx)) return
        if (!hasSandbunshin(amount)(ctx)) return
        sandbunshin.apply(ops.consumeStacks(amount))(ctx)
        contexts.skillUse.apply(ops.amplifyPower(multiplier))(ctx)
      }
    }

    function spendForSureHit(amount: number): Action {
      return ctx => {
        if (!conditions.selfUsesSkill(ctx)) return
        if (!hasSandbunshin(amount)(ctx)) return
        sandbunshin.apply(ops.consumeStacks(amount))(ctx)
        contexts.skillUse.apply(ops.setSureHit())(ctx)
      }
    }

    function spendForBleed(amount: number, stacks: number): Action {
      return ctx => {
        if (!conditions.selfUsesSkill(ctx)) return
        if (!hasSandbunshin(amount)(ctx)) return
        sandbunshin.apply(ops.consumeStacks(amount))(ctx)
        targets.opponentActive.apply(ops.addMark(liuxie!, { stack: stacks }))(ctx)
      }
    }

    function spendForSuffocate(amount: number): Action {
      return ctx => {
        if (!conditions.selfUsesSkill(ctx)) return
        if (!hasSandbunshin(amount)(ctx)) return
        sandbunshin.apply(ops.consumeStacks(amount))(ctx)
        targets.opponentActive.apply(ops.addMark(zhixi!))(ctx)
      }
    }

    function chanceSuffocate(chance: number): Action {
      return ctx => {
        if (!conditions.selfUsesSkill(ctx)) return
        if (!conditions.chance(chance)(ctx)) return
        targets.opponentActive.apply(ops.addMark(zhixi!))(ctx)
      }
    }

    function spendForAbsoluteDefense(amount: number): Action {
      return ctx => {
        if (!conditions.selfUsesSkill(ctx)) return
        if (!hasSandbunshin(amount)(ctx)) return
        sandbunshin.apply(ops.consumeStacks(amount))(ctx)
        targets.ownerPet.apply(ops.addMark(jueduifangyu!))(ctx)
      }
    }

    return defineEffects({
      effect_ability_add_shafenshen_1_stack_at_turn_end_while_active: {
        triggers: [EffectTrigger.TurnEnd],
        priority: 0,
        when: conditions.ownerIsActive,
        apply: targets.ownerPet.apply(ops.addMark(sandbunshinMark, { stack: 1 })),
      },
      effect_emblem_reduce_attack_damage_5_percent_per_shafenshen_stack: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, attackDamage),
        apply: (ctx => {
          const count = ctx.read(sandbunshinCount) ?? 0
          if (count > 0) {
            contexts.damage.apply(ops.modifyDamage({ percent: -5 * count, delta: 0 }))(ctx)
          }
        }) satisfies Action,
      },
      effect_skill_add_mark_self_shafenshen_1_stack: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        apply: gainSandbunshin(1),
      },
      effect_skill_consume_shafenshen_1_add_crit_rate_60: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        apply: spendForCrit(1, 60),
      },
      effect_skill_consume_shafenshen_1_double_power_before_hit: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        apply: spendForPower(1, 2),
      },
      effect_skill_consume_shafenshen_2_add_mark_opponent_liuxie_50_before_hit: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        apply: spendForBleed(2, 50),
      },
      effect_skill_add_mark_opponent_zhixi_10_percent_on_hit_on_apply: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        apply: chanceSuffocate(10),
      },
      effect_skill_consume_shafenshen_2_set_sure_hit: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        apply: spendForSureHit(2),
      },
      effect_skill_consume_shafenshen_3_add_mark_self_jueduifangyu_after_check: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        apply: spendForAbsoluteDefense(3),
      },
      effect_skill_consume_shafenshen_3_add_mark_opponent_zhixi_before_hit: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        apply: spendForSuffocate(3),
      },
      effect_mark_reduce_damage_taken_50_percent: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.selfBeDamaged,
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -50, delta: 0 })),
      },
    })
  }
}
