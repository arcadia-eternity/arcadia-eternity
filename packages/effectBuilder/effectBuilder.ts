import { ConfigSystem, Effect, EffectContext } from '@test-battle/battle'
import { EffectTrigger, type effectId } from '@test-battle/const'
import type { ChainableSelector } from './selector'
import { nanoid } from 'nanoid'
import { Operators } from 'operator'

export type ValueExtractor<T, U> = (target: T) => U

export type Action = (context: EffectContext<EffectTrigger>) => void

export type Condition = (context: EffectContext<EffectTrigger>) => boolean

export type Evaluator<U> = (context: EffectContext<EffectTrigger>, values: U[]) => boolean

export type Operator<U> = (context: EffectContext<EffectTrigger>, values: U[]) => void

export type TargetSelector<T> = (context: EffectContext<EffectTrigger>) => T[]

export type ConfigValue<T> = {
  configId: string
  defaultValue: T
}

export type ValueSource<T> = T | TargetSelector<T> | ChainableSelector<T> | Array<ValueSource<T>> | ConfigValue<T>

export type WidenLiteral<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends null
        ? null
        : T

export function registerLiteralValue(effectId: string, value: any, configId?: string): string {
  const configSystem = ConfigSystem.getInstance()
  const finalConfigId = configId || nanoid() // 自动生成唯一ID如果未提供
  const fullKey = `effect.${effectId}.${finalConfigId}`

  configSystem.set(fullKey, value)
  return fullKey
}
