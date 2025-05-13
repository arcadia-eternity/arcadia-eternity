import { ConfigSystem, Effect, EffectContext } from '@arcadia-eternity/battle'
import { EffectTrigger, type effectId } from '@arcadia-eternity/const'
import { type ChainableSelector } from './selector'
import { nanoid } from 'nanoid'

export type ValueExtractor<T, U> = (target: T) => U

export type Action = (context: EffectContext<EffectTrigger>) => void

export type Condition = (context: EffectContext<EffectTrigger>) => boolean

export type Evaluator<U> = (context: EffectContext<EffectTrigger>, values: U[]) => boolean

export type Operator<U> = (context: EffectContext<EffectTrigger>, values: U[]) => void

export type TargetSelector<T> = (context: EffectContext<EffectTrigger>) => T[]

export type ConfigValueSource<T> = {
  configId: string
  defaultValue: T
}

export type ValueSource<T> =
  | T
  | TargetSelector<T>
  | ChainableSelector<T>
  | Array<ValueSource<T>>
  | ConfigValueSource<T>
  | ConditionalValueSource<T>

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
  const fullKey = `${effectId}.${finalConfigId}`

  configSystem.set(fullKey, value)
  return fullKey
}

export class EffectBuilder<T extends EffectTrigger> {
  private constructor(
    private readonly trigger: T,
    private id: effectId = `effect_${nanoid(8)}` as effectId,
    private apply: Action | Action[] = () => {},
    private priority: number = 0,
    private condition?: Condition,
    private consumesStacks?: number,
  ) {}

  static create<T extends EffectTrigger>(trigger: T): EffectBuilder<T> {
    return new EffectBuilder(trigger)
  }

  setId(id: string): this {
    this.id = id as effectId
    return this
  }

  setApply(action: Action | Action[]): this {
    this.apply = action
    return this
  }

  setPriority(priority: number): this {
    this.priority = priority
    return this
  }

  setCondition(condition: Condition): this {
    this.condition = condition
    return this
  }

  setConsumesStacks(consumesStacks: number): this {
    this.consumesStacks = consumesStacks
    return this
  }

  createConfigValue<U>(value: U, configId?: string): ConfigValueSource<U> {
    return {
      configId: registerLiteralValue(this.id, value, configId),
      defaultValue: value,
    }
  }

  build(): Effect<T> {
    return new Effect(this.id, this.trigger, this.apply, this.priority, this.condition, this.consumesStacks)
  }
}

export type ConditionalValueSource<T> = {
  condition: Condition
  trueValue: ValueSource<T>
  falseValue?: ValueSource<T>
}
