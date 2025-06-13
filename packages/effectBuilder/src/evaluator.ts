import { EffectContext } from '@arcadia-eternity/battle'
import { EffectTrigger } from '@arcadia-eternity/const'
import type { Condition, Evaluator, TargetSelector } from './effectBuilder'
import { ChainableSelector, type SelectorOpinion } from './selector'
import { GetValueFromSource } from './operator'
import { type ValueSource } from './effectBuilder'

export type CompareOperator = '>' | '<' | '>=' | '<=' | '=='

export const Evaluators = {
  //只要筛选组内有满足要求的数则返回，被比较的数位于运算符的左侧。
  compare:
    <T extends number>(operator: CompareOperator, dynamicValue: ValueSource<number>): Evaluator<T> =>
    (context: EffectContext<EffectTrigger>, values: T[]): boolean => {
      const compareValue = GetValueFromSource(context, dynamicValue)[0]
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
    <T extends number>(operator: CompareOperator, dynamicValue: ValueSource<number>): Evaluator<T> =>
    (context: EffectContext<EffectTrigger>, values: T[]): boolean => {
      const compareValue = GetValueFromSource(context, dynamicValue)[0]
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
    <T extends SelectorOpinion>(dynamicValue: ValueSource<T>): Evaluator<T> =>
    (context: EffectContext<EffectTrigger>, values: T[]): boolean => {
      const comparValue = GetValueFromSource(context, dynamicValue)[0]
      return comparValue === values[0]
    },

  notSame:
    <T extends SelectorOpinion>(dynamicValue: ValueSource<T>): Evaluator<T> =>
    (context: EffectContext<EffectTrigger>, values: T[]): boolean => {
      const comparValue = GetValueFromSource(context, dynamicValue)[0]
      return comparValue !== values[0]
    },

  has:
    <T extends SelectorOpinion>(dynamicValue: ValueSource<T>): Evaluator<T> =>
    (context: EffectContext<EffectTrigger>, values: T[]): boolean => {
      const comparValue = GetValueFromSource(context, dynamicValue)[0]
      return values.some(v => v === comparValue)
    },

  every:
    <T extends SelectorOpinion>(dynamicValue: ValueSource<T>): Evaluator<T> =>
    (context: EffectContext<EffectTrigger>, values: T[]): boolean => {
      const comparValue = GetValueFromSource(context, dynamicValue)[0]
      return values.every(v => v === comparValue)
    },

  //输入的Condition只要有一个返回True,返回True
  any:
    <T>(...ops: Evaluator<T>[]): Evaluator<T> =>
    (context: EffectContext<EffectTrigger>, values: T[]) =>
      ops.some(op => op(context, values)),

  //输入的Condition仅当全部返回True时，返回True
  all:
    <T>(...ops: Evaluator<T>[]): Evaluator<T> =>
    (context: EffectContext<EffectTrigger>, values: T[]) =>
      ops.every(op => op(context, values)),

  not:
    <T extends SelectorOpinion>(op: Evaluator<T>): Evaluator<T> =>
    (context: EffectContext<EffectTrigger>, values: T[]): boolean => {
      return !op(context, values)
    },

  contain:
    <T extends string>(tag: string): Evaluator<T> =>
    (context: EffectContext<EffectTrigger>, values: T[]) =>
      values.some(v => v === tag),

  //对任意元素均有百分比的筛选几率，亦能直接作为随机按几率触发效果的Condition。
  probability:
    <T>(dynamicPercent: ValueSource<number>): Evaluator<T> =>
    (context: EffectContext<EffectTrigger>) => {
      const percent = GetValueFromSource(context, dynamicPercent)[0]
      console.debug('testpercent', percent)
      return context.battle.random() < percent / 100
    },

  //如果至少存在一个元素，返回真
  exist:
    <T>(): Evaluator<T> =>
    (context: EffectContext<EffectTrigger>, values: T[]) => {
      return values.length > 0
    },
}

export const ConditionUtils = {
  fromEvaluator: <T>(selector: TargetSelector<T> | ChainableSelector<T>, evaluator: Evaluator<T>): Condition => {
    let _selector: TargetSelector<T>
    if (selector instanceof ChainableSelector) {
      _selector = selector.build()
    } else _selector = selector
    return context => {
      return evaluator(context, _selector(context))
    }
  },
}
