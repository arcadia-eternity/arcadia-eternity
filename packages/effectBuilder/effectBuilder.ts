import { EffectContext } from 'packages/core/context'
import { EffectTrigger } from 'packages/core/effect'

export type ValueExtractor<T, U> = (target: T) => U

export type Action = (context: EffectContext<EffectTrigger>) => void

export type Condition = (context: EffectContext<EffectTrigger>) => boolean

export type Evaluator<U> = (context: EffectContext<EffectTrigger>, values: U[]) => boolean

export type Operator<U> = (context: EffectContext<EffectTrigger>, values: U[]) => void

export type TargetSelector<T> = (context: EffectContext<EffectTrigger>) => T[]
