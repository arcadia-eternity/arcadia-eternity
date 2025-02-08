import { Prototype } from '@core/const'
import { EffectContext } from '@core/context'
import { ValueExtractor, ConditionOperator } from './effectBuilder'
import { SelectorOpinion, ChainableSelector } from './selector'
import { EffectTrigger } from '@core/effect'

export function createDynamicCondition<T extends SelectorOpinion, U>(
  selector: ChainableSelector<T>,
  extractor: ValueExtractor<T, U>,
  operator: ConditionOperator<U>,
): (ctx: EffectContext<EffectTrigger>) => boolean {
  return (ctx: EffectContext<EffectTrigger>) => {
    try {
      const targets = selector.build()(ctx)
      const values = targets.flatMap(t => {
        const extracted = extractor(t)
        return Array.isArray(extracted) ? extracted : [extracted]
      })
      return operator(ctx, values)
    } catch (error) {
      console.error('Condition evaluation failed:', error)
      return false
    }
  }
}

export const Conditions = {
  compare:
    <T extends number>(operator: '>' | '<' | '>=' | '<=' | '==') =>
    (values: T[], ctx: EffectContext<EffectTrigger>, compareValue: T): boolean => {
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

  hasId:
    <T extends Prototype>(id: string) =>
    (values: T[]): boolean => {
      return values.some(v => v.id === id)
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
    (percent: number): ConditionOperator<unknown> =>
    (ctx: EffectContext<EffectTrigger>) =>
      ctx.battle.random() < percent / 100,

  turnCount:
    (predicate: (n: number) => boolean): ConditionOperator<unknown> =>
    (ctx: EffectContext<EffectTrigger>) =>
      predicate(ctx.battle.currentTurn),
}
