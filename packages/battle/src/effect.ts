import type { effectId } from '@arcadia-eternity/const'
import { EffectTrigger } from '@arcadia-eternity/const'
import { EffectContext } from './context'
import { type Prototype } from './entity'
import { MarkInstanceImpl } from './mark'

// EffectScheduler has been replaced by EffectExecutionPhase
// All effect scheduling and execution logic is now handled by the Phase system

export class Effect<T extends EffectTrigger> implements Prototype {
  constructor(
    public readonly id: effectId,
    public readonly triggers: T[],
    public readonly apply: ((context: EffectContext<T>) => void) | ((context: EffectContext<T>) => void)[],
    public readonly priority: number,
    public readonly condition?: (context: EffectContext<T>) => boolean,
    public readonly consumesStacks?: number,
    public readonly tags: string[] = [],
  ) {}

  // 为了向后兼容，保留trigger属性的getter
  get trigger(): T {
    return this.triggers[0]
  }

  public innerApply(context: EffectContext<T>) {
    // 先执行消耗逻辑
    if (context.source instanceof MarkInstanceImpl) {
      if (!context.source.isActive) return
    }

    // 执行实际效果
    if (Array.isArray(this.apply)) this.apply.forEach(a => a.call(this, context))
    else this.apply.call(this, context)

    if (context.source instanceof MarkInstanceImpl) {
      if (this.consumesStacks) {
        context.source.consumeStack(context, this.consumesStacks)
      }
    }
  }
}

export interface EffectContainer {
  effects: Effect<EffectTrigger>[]
}

export class TemporaryEffect {
  constructor(
    public readonly effect: Effect<EffectTrigger>,
    public readonly phaseId: string,
  ) {}
}
