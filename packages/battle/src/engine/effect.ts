import { EffectTrigger } from '@arcadia-eternity/const'
import type { EffectContext } from './context'
import { type Prototype } from './entity'
import type { effectId } from '@arcadia-eternity/const'

// EffectScheduler has been replaced by EffectExecutionPhase
// All effect scheduling and execution logic is now handled by the Phase system

export class Effect<T extends EffectTrigger> implements Prototype {
  constructor(
    public readonly id: effectId,
    public readonly triggers: T[],
    public readonly apply: ((context: EffectContext<T>) => void) | ((context: EffectContext<T>) => void)[],
    public readonly priority: number,
    public readonly condition?: (context: EffectContext<T>) => boolean,
    public readonly consumesStacks?: number | 'all',
    public readonly tags: string[] = [],
  ) {}

  // 为了向后兼容，保留trigger属性的getter
  get trigger(): T {
    return this.triggers[0]
  }
}

export interface EffectContainer {
  effects: Effect<EffectTrigger>[]
  /** Effective list; mutable permanent effects remain separate from phase-scoped additions. */
  getEffects?(trigger: EffectTrigger): Effect<EffectTrigger>[]
}

export interface TemporaryEffect {
  readonly effect: Effect<EffectTrigger>
  readonly phaseId: string
}
