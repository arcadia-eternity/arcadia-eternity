import { EffectTrigger } from '@core/effect'
import { EffectContext, UseSkillContext, DamageContext, HealContext, AddMarkContext, RageContext } from '@core/context'
import { Mark } from '@core/mark'
import { Pet } from '@core/pet'
import { Player } from '@core/player'
import type { DynamicValue } from './effectBuilder'
import { type SelectorOpinion, type ValueSource, ChainableSelector } from './selector'

function createDynamicOperator<T extends SelectorOpinion, U extends SelectorOpinion>(
  handler: (value: U[], target: T, ctx: EffectContext<EffectTrigger>) => void,
) {
  return (source: ValueSource<U, T>) => {
    return (ctx: EffectContext<EffectTrigger>, targets: T[]) => {
      targets.forEach(target => {
        let finalValue: U[] = []

        if (typeof source === 'function') {
          try {
            // 处理选择器函数
            if (source.length === 1) {
              // Context函数
              finalValue = (source as (ctx: EffectContext<EffectTrigger>) => U[])(ctx)
            } else if (source.length === 2) {
              // Target+Context函数
              finalValue = (source as (target: T, ctx: EffectContext<EffectTrigger>) => U[])(target, ctx)
            }
          } catch {
            finalValue = []
          }
        } else if (source instanceof ChainableSelector) {
          finalValue = source.build()(ctx)
        } else {
          finalValue = [source]
        }

        if (finalValue.length != 0) {
          handler(finalValue, target, ctx)
        }
      })
    }
  }
}
// 操作符系统

export const BattleActions = {
  dealDamage: createDynamicOperator<Pet, number>((value, pet, ctx) => {
    let source
    if (ctx.parent instanceof UseSkillContext) source = ctx.parent.pet
    else source = ctx.source
    pet.damage(new DamageContext(ctx, source, value[0]))
  }),

  heal: createDynamicOperator<Pet, number>((value, pet, ctx) => {
    pet.heal(new HealContext(ctx, ctx.source, value[0]))
  }),

  addMark:
    <T extends Pet>(mark: Mark) =>
    (ctx: EffectContext<EffectTrigger>, targets: T[]) => {
      targets.forEach(pet => {
        pet.addMark(new AddMarkContext(ctx, pet, mark))
      })
    },

  addStack:
    <T extends Mark>(markid: string, value: number) =>
    (ctx: EffectContext<EffectTrigger>, targets: T[]) => {
      targets.filter(mark => mark.id == markid).forEach(mark => mark.addStack(value))
    },

  consumeStacks:
    <T extends Mark>(markid: string, value: number) =>
    (ctx: EffectContext<EffectTrigger>, targets: T[]) => {
      targets.filter(mark => mark.id == markid).forEach(mark => mark.consumeStacks(ctx, value))
    },

  // 玩家操作
  addRage: createDynamicOperator<Player, number>((value, player, ctx) => {
    player.addRage(new RageContext(ctx, player, 'effect', 'add', value[0]))
  }),
  // // 属性操作增强
  // modifyStat:
  //   <T extends Pet, K extends keyof StatOnBattle>(stat: K, value: DynamicValue<number, T>) =>
  //   (ctx: EffectContext<EffectTrigger>, targets: T[]) => {
  //     targets.forEach(pet => {
  //       const finalValue = typeof value === 'function' ? value(pet, ctx) : value
  //       pet.stat[stat] += finalValue
  //     })
  //   },
  // // 上下文相关操作
  amplifyPower:
    (multiplier: DynamicValue<number, UseSkillContext>) =>
    (ctx: EffectContext<EffectTrigger>, contexts: UseSkillContext[]) => {
      contexts.forEach(skillCtx => {
        const finalMultiplier = typeof multiplier === 'function' ? multiplier(skillCtx, ctx) : multiplier
        if (typeof finalMultiplier === 'number') {
          skillCtx.power *= finalMultiplier
        } else {
          finalMultiplier.forEach(v => (skillCtx.power *= v))
        }
      })
    },
}
