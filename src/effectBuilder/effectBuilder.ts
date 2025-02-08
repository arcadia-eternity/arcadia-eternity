import { EffectContext } from '@core/context'
import { SelectorOpinion } from './selector'
import { EffectTrigger } from '@/core/effect'

export type ValueExtractor<T, U> = (target: T) => U | U[]

export type ConditionOperator<U> = (ctx: EffectContext<EffectTrigger>, values: U[]) => boolean // 判断逻辑

export type Operator<U> = (ctx: EffectContext<EffectTrigger>, values: U[]) => void

export type DynamicValue<T, U extends SelectorOpinion> = T | ((target: U, context: EffectContext<EffectTrigger>) => T[])
