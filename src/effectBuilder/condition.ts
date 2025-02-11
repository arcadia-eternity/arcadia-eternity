import { EffectContext } from '@core/context'
import { ConditionOperator } from './effectBuilder'
import { EffectTrigger } from '@core/effect'
import { Primitive } from 'zod'
import { GetValueFromSource, ValueSource } from './selector'

export type CompareOperator = '>' | '<' | '>=' | '<=' | '=='

export const Conditions = {
  compare:
    <T extends number>(operator: CompareOperator, dynamicValue: ValueSource<number>) =>
    (ctx: EffectContext<EffectTrigger>, values: T[]): boolean => {
      const compareValue = GetValueFromSource(ctx, dynamicValue)[0]
      return values.some(value => {
        switch (operator) {
          case '>':
            return value > compareValue
          case '<':
            return value < compareValue
          case '>=':
            return value >= compareValue
          case '<=':
            return value <= compareValue
          case '==':
            return value === compareValue
          default:
            return false
        }
      })
    },

  same:
    <T extends Primitive>(dynamicValue: ValueSource<T>) =>
    (ctx: EffectContext<EffectTrigger>, values: T[]): boolean => {
      const comparValue = GetValueFromSource(ctx, dynamicValue)[0]
      return comparValue === values[0]
    },

  any:
    <T>(...ops: ConditionOperator<T>[]): ConditionOperator<T> =>
    (ctx: EffectContext<EffectTrigger>, values: T[]) =>
      ops.some(op => op(ctx, values)),

  all:
    <T>(...ops: ConditionOperator<T>[]): ConditionOperator<T> =>
    (ctx: EffectContext<EffectTrigger>, values: T[]) =>
      ops.every(op => op(ctx, values)),

  probability: (dynamicPercent: ValueSource<number>) => (ctx: EffectContext<EffectTrigger>) => {
    const percent = GetValueFromSource(ctx, dynamicPercent)[0]
    return ctx.battle.random() < percent / 100
  },
}
