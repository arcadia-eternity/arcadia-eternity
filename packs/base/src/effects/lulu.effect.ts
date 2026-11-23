import {
  conditions,
  contexts,
  DamageType,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
  values,
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

function secondaryStatDrop(stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe', chance: number, amount: number): Action {
  return ctx => {
    if (!conditions.selfUsesSkill(ctx)) return
    if (!conditions.chance(chance)(ctx)) return
    targets.opponentActive.apply(ops.changeStatStage(stat, amount))(ctx)
  }
}

function selfStatBoost(stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe', amount: number): Action {
  return ctx => {
    if (!conditions.selfUsesSkill(ctx)) return
    targets.ownerPet.apply(ops.changeStatStage(stat, amount))(ctx)
  }
}

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
      effect_lulu_ability_sandbunshin_growth: {
        triggers: [EffectTrigger.TurnEnd],
        priority: 0,
        when: conditions.ownerIsActive,
        apply: targets.ownerPet.apply(ops.addMark(sandbunshinMark, { stack: 1 })),
      },
      effect_lulu_emblem_sandbunshin_reduction: {
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
      effect_lulu_skill_shazhikaijia: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        apply: selfStatBoost('def', 1),
      },
      effect_lulu_skill_shafenshen: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        apply: gainSandbunshin(1),
      },
      effect_lulu_skill_shazhimao: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        apply: spendForCrit(1, 60),
      },
      effect_lulu_skill_shapuqiangzang: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        apply: spendForPower(1, 2),
      },
      effect_lulu_skill_shaluanpo: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(ops.setMultihit(values.randomInt(3, 5))),
      },
      effect_lulu_skill_shazhishouhu: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        apply: selfStatBoost('spd', 1),
      },
      effect_lulu_skill_shachenshuangji: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        apply: spendForBleed(2, 50),
      },
      effect_lulu_skill_shaliuzang: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        apply: chanceSuffocate(10),
      },
      effect_lulu_skill_shapusongzang: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        apply: spendForSureHit(2),
      },
      effect_lulu_skill_mieshapuzang: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        apply: secondaryStatDrop('spe', 15, -1),
      },
      effect_lulu_skill_fenshenshaluanzang: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        apply: gainSandbunshin(1),
      },
      effect_lulu_skill_shabaojianmao: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        apply: spendForCrit(1, 60),
      },
      effect_lulu_skill_jueduifangyu: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        apply: spendForAbsoluteDefense(3),
      },
      effect_lulu_skill_shapudazang: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        apply: spendForSureHit(2),
      },
      effect_lulu_skill_shafulao: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        apply: spendForSuffocate(3),
      },
      effect_lulu_mark_jueduifangyu_halve: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.selfBeDamaged,
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -50, delta: 0 })),
      },
    })
  }
}
