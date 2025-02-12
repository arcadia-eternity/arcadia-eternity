import { EffectTrigger } from '@core/effect'
import { EffectContext, UseSkillContext, DamageContext, HealContext, AddMarkContext, RageContext } from '@core/context'
import { CreateStatStageMark, Mark } from '@core/mark'
import { Pet } from '@core/pet'
import { Player } from '@core/player'
import { type SelectorOpinion, type ValueSource, ChainableSelector, GetValueFromSource } from './selector'
import { StatTypeOnBattle, StatTypeWithoutHp } from '@/core/const'
import { Operator } from './effectBuilder'

function createDynamicOperator<T extends SelectorOpinion, U extends SelectorOpinion>(
  handler: (value: U[], target: T, ctx: EffectContext<EffectTrigger>) => void,
) {
  return (source: ValueSource<U>) => {
    return (ctx: EffectContext<EffectTrigger>, targets: T[]) => {
      targets.forEach(target => {
        let finalValue: U[] = []

        if (typeof source === 'function') {
          try {
            finalValue = (source as (ctx: EffectContext<EffectTrigger>) => U[])(ctx)
          } catch {
            finalValue = []
          }
        } else if (source instanceof ChainableSelector) {
          finalValue = source.build()(ctx)
        } else {
          finalValue = [source]
        }

        if (finalValue.length != 0) {
          return handler(finalValue, target, ctx)
        }
      })
    }
  }
}
// 操作符系统

export const Operators = {
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
    <T extends Pet>(mark: Mark, stack: number) =>
    (ctx: EffectContext<EffectTrigger>, targets: T[]) => {
      targets.forEach(pet => {
        pet.addMark(new AddMarkContext(ctx, pet, mark, stack))
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

  modifyStat:
    (stat: ValueSource<StatTypeOnBattle>, percent: ValueSource<number>, value: ValueSource<number>) =>
    (ctx: EffectContext<EffectTrigger>, targets: Pet[]) => {
      targets.forEach(pet => {
        const _stat = GetValueFromSource(ctx, stat)[0]
        const _percent = GetValueFromSource(ctx, percent)[0] ?? 0
        const _value = GetValueFromSource(ctx, value)[0] ?? 0
        pet.statModifiers[_stat][0] += _percent
        pet.statModifiers[_stat][1] += _value
      })
    },

  amplifyPower:
    (multiplier: ValueSource<number>): Operator<UseSkillContext> =>
    (ctx: EffectContext<EffectTrigger>, contexts: UseSkillContext[]) => {
      contexts.forEach(skillCtx => {
        const finalMultiplier = GetValueFromSource(ctx, multiplier)
        finalMultiplier.forEach(v => (skillCtx.power *= v))
      })
    },

  addPower: (value: ValueSource<number>) => (ctx: EffectContext<EffectTrigger>, contexts: UseSkillContext[]) => {
    contexts.forEach(skillCtx => {
      const _value = GetValueFromSource(ctx, value)
      _value.forEach(v => (skillCtx.power += v))
    })
  },

  statStageBuff:
    (statType: ValueSource<StatTypeWithoutHp>, value: ValueSource<number>) =>
    (ctx: EffectContext<EffectTrigger>, target: Pet[]) => {
      //TODO: 万一找不到呢？
      const _value = GetValueFromSource(ctx, value)[0] ?? 0
      const _statType = GetValueFromSource(ctx, statType)[0] ?? null
      const upMark = CreateStatStageMark(_statType, _value)
      target.forEach(v => v.addMark(new AddMarkContext(ctx, v, upMark, _value)))
    },
}
