import { EffectContext } from '@test-battle/battle'
import { EffectTrigger } from '@test-battle/const'
import type { ChainableSelector, PropertyRef } from './selector'
import type { SelectorOpinion, PrimitiveOpinion } from './SelectorOpinion'

export type ValueExtractor<T, U> = (target: T) => U

export type Action = (context: EffectContext<EffectTrigger>) => void

export type Condition = (context: EffectContext<EffectTrigger>) => boolean

export type Evaluator<U> = (context: EffectContext<EffectTrigger>, values: U[]) => boolean

export type Operator<U> = (context: EffectContext<EffectTrigger>, values: U[]) => void

export type TargetSelector<T> = (context: EffectContext<EffectTrigger>) => T[]

export type ValueSource<T extends SelectorOpinion> =
  | T
  | TargetSelector<T>
  | ChainableSelector<T>
  | (T extends PrimitiveOpinion ? ChainableSelector<PropertyRef<SelectorOpinion, T>> : never)

export type WidenLiteral<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends null
        ? null
        : T
