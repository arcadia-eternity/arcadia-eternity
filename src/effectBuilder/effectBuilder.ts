import { EffectContext } from '@core/context'
import { EffectTrigger } from '@/core/effect'

export type ValueExtractor<T, U> = (target: T) => U

export type ConditionOperator<U> = (ctx: EffectContext<EffectTrigger>, values: U[]) => boolean // 判断逻辑

export type Operator<U> = (ctx: EffectContext<EffectTrigger>, values: U[]) => void

export type TargetSelector<T> = (context: EffectContext<EffectTrigger>) => T[]
