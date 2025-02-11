import { EffectContext } from '@core/context'
import { ConditionOperator } from './effectBuilder'
import { EffectTrigger } from '@core/effect'
import { GetValueFromSource, SelectorOpinion, ValueSource } from './selector'

export type CompareOperator = '>' | '<' | '>=' | '<=' | '=='

export const Conditions = {
  //只要筛选组内有满足要求的数则返回，被比较的数位于运算符的左侧。
  compare:
    <T extends number>(operator: CompareOperator, dynamicValue: ValueSource<number>): ConditionOperator<T> =>
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

  everyCompare:
    <T extends number>(operator: CompareOperator, dynamicValue: ValueSource<number>): ConditionOperator<T> =>
    (ctx: EffectContext<EffectTrigger>, values: T[]): boolean => {
      const compareValue = GetValueFromSource(ctx, dynamicValue)[0]
      return values.every(value => {
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
    <T extends SelectorOpinion>(dynamicValue: ValueSource<T>): ConditionOperator<T> =>
    (ctx: EffectContext<EffectTrigger>, values: T[]): boolean => {
      const comparValue = GetValueFromSource(ctx, dynamicValue)[0]
      return comparValue === values[0]
    },

  has:
    <T extends SelectorOpinion>(dynamicValue: ValueSource<T>): ConditionOperator<T> =>
    (ctx: EffectContext<EffectTrigger>, values: T[]): boolean => {
      const comparValue = GetValueFromSource(ctx, dynamicValue)[0]
      return values.some(v => v === comparValue)
    },

  every:
    <T extends SelectorOpinion>(dynamicValue: ValueSource<T>): ConditionOperator<T> =>
    (ctx: EffectContext<EffectTrigger>, values: T[]): boolean => {
      const comparValue = GetValueFromSource(ctx, dynamicValue)[0]
      return values.every(v => v === comparValue)
    },

  //输入的Condition只要有一个返回True,返回True
  any:
    <T>(...ops: ConditionOperator<T>[]): ConditionOperator<T> =>
    (ctx: EffectContext<EffectTrigger>, values: T[]) =>
      ops.some(op => op(ctx, values)),

  //输入的Condition仅当全部返回True时，返回True
  all:
    <T>(...ops: ConditionOperator<T>[]): ConditionOperator<T> =>
    (ctx: EffectContext<EffectTrigger>, values: T[]) =>
      ops.every(op => op(ctx, values)),

  //这是一个特殊处理，Mark的Tag通过筛选获得的时候嵌套了两层，有点难搞了
  hasTag:
    <T extends string[]>(tag: string): ConditionOperator<T> =>
    (ctx: EffectContext<EffectTrigger>, values: T[]) =>
      values.some(v => v.some(w => w === tag)),

  //对任意元素均有百分比的筛选几率，亦能直接作为随机按几率触发效果的Condition。
  probability:
    <T>(dynamicPercent: ValueSource<number>): ConditionOperator<T> =>
    (ctx: EffectContext<EffectTrigger>) => {
      const percent = GetValueFromSource(ctx, dynamicPercent)[0]
      return ctx.battle.random() < percent / 100
    },
}
