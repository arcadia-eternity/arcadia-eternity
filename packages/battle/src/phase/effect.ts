import { EffectTrigger, BattleMessageType } from '@arcadia-eternity/const'
import { SynchronousPhase } from './base'
import { EffectContext, type TriggerContextMap } from '../context'
import type { Battle } from '../battle'
import type { SkillInstance } from '../skill'
import type { MarkInstance } from '../mark'
import type { Effect } from '../effect'

/**
 * EffectPhase handles effect execution operations
 * Corresponds to EffectContext and replaces effect execution logic
 */
export class EffectPhase<T extends EffectTrigger> extends SynchronousPhase<EffectContext<T>> {
  constructor(
    battle: Battle,
    private readonly parentContext: TriggerContextMap[T],
    private readonly trigger: T,
    private readonly source: SkillInstance | MarkInstance,
    private readonly effect?: Effect<EffectTrigger>,
    id?: string,
  ) {
    super(battle, id)
  }

  protected createContext(): EffectContext<T> {
    return new EffectContext<T>(this.parentContext, this.trigger, this.source, this.effect)
  }

  protected getEffectTriggers() {
    return {
      before: [], // BeforeEffect is handled in executeOperation
      during: [], // The actual effect execution happens in executeOperation
      after: [], // AfterEffect is handled in executeOperation
    }
  }

  protected executeOperation(): void {
    const context = this._context!

    // Execute the effect operation logic
    executeEffectOperation(context, this.battle)
  }
}

/**
 * Extracted effect operation logic from EffectScheduler.flushEffects
 * This function contains the core effect execution logic
 */
export function executeEffectOperation<T extends EffectTrigger>(context: EffectContext<T>, battle: Battle): void {
  // Apply BeforeEffect effects to potentially prevent effect execution
  battle.applyEffects(context, EffectTrigger.BeforeEffect)

  if (!context.available) {
    if (context.effect) {
      battle.emitMessage(BattleMessageType.EffectApplyFail, {
        source: context.source.id,
        effect: context.effect.id,
        reason: 'disabled',
      })
    }
    return
  }

  // Emit effect apply message
  if (context.effect) {
    battle.emitMessage(BattleMessageType.EffectApply, {
      source: context.source.id,
      effect: context.effect.id,
    })
  }

  // Execute the actual effect if it exists
  if (context.effect) {
    try {
      context.effect.innerApply(context)
      context.success = true
    } catch (error) {
      console.error('Effect execution failed:', error)
      context.success = false

      battle.emitMessage(BattleMessageType.EffectApplyFail, {
        source: context.source.id,
        effect: context.effect.id,
        reason: 'disabled',
      })
      return
    }
  }

  // Apply AfterEffect effects after effect execution
  battle.applyEffects(context, EffectTrigger.AfterEffect)
}

/**
 * BatchEffectPhase handles multiple effect executions in sequence
 * Used when multiple effects need to be executed together
 */
export class BatchEffectPhase<T extends EffectTrigger> extends SynchronousPhase<EffectContext<T>> {
  constructor(
    battle: Battle,
    private readonly effects: Array<{
      parentContext: TriggerContextMap[T]
      trigger: T
      source: SkillInstance | MarkInstance
      effect?: Effect<EffectTrigger>
    }>,
    id?: string,
  ) {
    super(battle, id)
  }

  protected createContext(): EffectContext<T> {
    // For batch effects, we use the first effect's context as the primary context
    const firstEffect = this.effects[0]
    if (!firstEffect) {
      throw new Error('BatchEffectPhase requires at least one effect')
    }

    return new EffectContext<T>(firstEffect.parentContext, firstEffect.trigger, firstEffect.source, firstEffect.effect)
  }

  protected getEffectTriggers() {
    return {
      before: [], // BeforeEffect is handled in executeOperation
      during: [], // The actual effect execution happens in executeOperation
      after: [], // AfterEffect is handled in executeOperation
    }
  }

  protected executeOperation(): void {
    // Execute all effects in sequence
    for (const effectData of this.effects) {
      const context = new EffectContext<T>(
        effectData.parentContext,
        effectData.trigger,
        effectData.source,
        effectData.effect,
      )

      executeEffectOperation(context, this.battle)

      // If any effect fails and marks the context as unavailable, stop execution
      if (!context.available) {
        break
      }
    }
  }
}
