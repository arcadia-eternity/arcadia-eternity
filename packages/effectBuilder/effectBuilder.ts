import { EffectContext } from '@test-battle/battle'
import { EffectTrigger } from '@test-battle/const'
import type { SelectorOpinion, ChainableSelector } from 'selector'

export type ValueExtractor<T, U> = (target: T) => U

export type Action = (context: EffectContext<EffectTrigger>) => void

export type Condition = (context: EffectContext<EffectTrigger>) => boolean

export type Evaluator<U> = (context: EffectContext<EffectTrigger>, values: U[]) => boolean

export type Operator<U> = (context: EffectContext<EffectTrigger>, values: U[]) => void

export type TargetSelector<T> = (context: EffectContext<EffectTrigger>) => T[]

export type ValueSource<T extends SelectorOpinion> =
  | T
  | TargetSelector<T> // 选择器系统产生的值
  | ChainableSelector<T> // 链式选择器
