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

export function registerLiteralValue(effectId: string, value: any, configId?: string, tags?: string[]): string {
  const configSystem = ConfigSystem.getInstance()
  const finalConfigId = configId || nanoid() // 自动生成唯一ID如果未提供
  const fullKey = `${effectId}.${finalConfigId}`

  // 首先注册配置键以支持modifier系统
  if (!configSystem.isRegistered(fullKey)) {
    if (tags === undefined) {
      configSystem.registerConfig(fullKey, value)
    } else {
      configSystem.registerTaggedConfig(fullKey, value, tags)
    }
  } else {
    // 如果已经注册，只更新值
    configSystem.set(fullKey, value)
  }
  return fullKey
}

export class EffectBuilder<T extends EffectTrigger> {
  private constructor(
    private readonly triggers: T[],
    private id: effectId = `effect_${nanoid(8)}` as effectId,
    private apply: Action | Action[] = () => {},
    private priority: number = 0,
    private condition?: Condition,
    private consumesStacks?: number,
  ) {}

  static create<T extends EffectTrigger>(trigger: T | T[]): EffectBuilder<T> {
    const triggers = Array.isArray(trigger) ? trigger : [trigger]
    return new EffectBuilder(triggers)
  }

  // 为了向后兼容，保留trigger属性的getter
  get trigger(): T {
    return this.triggers[0]
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
    return new Effect(this.id, this.triggers, this.apply, this.priority, this.condition, this.consumesStacks)
  }
}

export type ConditionalValueSource<T> = {
  condition: Condition
  trueValue: ValueSource<T>
  falseValue?: ValueSource<T>
}
