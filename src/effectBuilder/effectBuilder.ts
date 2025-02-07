import { EffectContext } from '../simulation/context'
import { SelectorOpinion } from './selector'

export type ValueExtractor<T, U> = (target: T) => U | U[]

export type ConditionOperator<U> = (ctx: EffectContext, values: U[]) => boolean // 判断逻辑

export type Operator<U> = (ctx: EffectContext, values: U[]) => void

export type DynamicValue<T, U extends SelectorOpinion> = T | ((target: U, context: EffectContext) => T[])
