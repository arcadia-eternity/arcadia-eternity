import { EffectContext } from '@core/context'
import { ConditionOperator, DynamicValue } from './effectBuilder'
import { EffectTrigger } from '@core/effect'
import { Primitive } from 'zod'

export type CompareOperator = '>' | '<' | '>=' | '<=' | '=='

export const Condition = {
  compare:
    <T extends number>(operator: CompareOperator, dynamicValue: DynamicValue<number, T>) =>
    (ctx: EffectContext<EffectTrigger>, values: T[]): boolean => {
      const compareValue = typeof dynamicValue === 'function' ? dynamicValue(values[0], ctx)[0] : dynamicValue
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
    <T extends Primitive>(dynamicValue: DynamicValue<T, T>) =>
    (ctx: EffectContext<EffectTrigger>, values: T[]): boolean => {
      const comparValue = typeof dynamicValue === 'function' ? dynamicValue(values[0], ctx)[0] : dynamicValue
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

  probability:
    <T extends number>(dynamicPercent: DynamicValue<number, T>) =>
    (ctx: EffectContext<EffectTrigger>, values: T[]) => {
      const percent = typeof dynamicPercent === 'function' ? dynamicPercent(values[0], ctx)[0] : dynamicPercent
      return ctx.battle.random() < percent / 100
    },
}
