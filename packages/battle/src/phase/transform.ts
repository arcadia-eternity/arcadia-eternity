import { EffectTrigger } from '@arcadia-eternity/const'
import { SynchronousPhase } from './base'
import { TransformContext } from '../context'
import type { Battle } from '../battle'
import type { Pet } from '../pet'
import type { SkillInstance } from '../skill'
import type { MarkInstance } from '../mark'
import type { Effect } from '../effect'
import type { EffectContext } from '../context'

/**
 * TransformPhase handles transformation/shapeshifting operations
 * Corresponds to TransformContext and replaces transformation logic
 */
export class TransformPhase extends SynchronousPhase<TransformContext> {
  constructor(
    battle: Battle,
    private readonly parentContext: EffectContext<EffectTrigger> | Battle,
    private readonly target: Pet | SkillInstance | MarkInstance,
    private readonly targetType: 'pet' | 'skill' | 'mark',
    private readonly fromBase: any, // Species | BaseSkill | BaseMark
    private readonly toBase: any, // Species | BaseSkill | BaseMark
    private readonly transformType: 'temporary' | 'permanent',
    private readonly priority: number,
    private readonly causedBy?: MarkInstance | SkillInstance | Effect<EffectTrigger>,
    id?: string,
  ) {
    super(battle, id)
  }

  protected createContext(): TransformContext {
    return new TransformContext(
      this.parentContext,
      this.target,
      this.targetType,
      this.fromBase,
      this.toBase,
      this.transformType,
      this.priority,
      this.causedBy,
    )
  }

  protected getEffectTriggers() {
    return {
      before: [EffectTrigger.BeforeTransform],
      during: [EffectTrigger.OnTransform],
      after: [EffectTrigger.AfterTransform],
    }
  }

  protected executeOperation(): void {
    const context = this._context!

    // Execute the transformation operation logic
    executeTransformOperation(context, this.battle)
  }
}

/**
 * Extracted transformation operation logic from TransformationSystem.applyTransformation
 * This function contains the core transformation logic
 */
export function executeTransformOperation(context: TransformContext, battle: Battle): void {
  // Apply BeforeTransform effects to potentially prevent transformation
  battle.applyEffects(context, EffectTrigger.BeforeTransform)

  if (!context.available) {
    return
  }

  // Apply the transformation using the battle's transformation system
  const success = battle.transformationSystem.applyTransformation(
    context.target as any, // Type assertion needed for the transformation system
    context.toBase,
    context.transformType,
    context.priority,
    context.causedBy,
  )

  if (!success) {
    context.available = false
    return
  }

  // Apply OnTransform effects during transformation
  battle.applyEffects(context, EffectTrigger.OnTransform)

  // Apply AfterTransform effects after transformation is complete
  battle.applyEffects(context, EffectTrigger.AfterTransform)
}

/**
 * TransformEndPhase handles transformation ending operations
 * Used when transformations are removed or expire
 */
export class TransformEndPhase extends SynchronousPhase<TransformContext> {
  constructor(
    battle: Battle,
    private readonly parentContext: EffectContext<EffectTrigger> | Battle,
    private readonly target: Pet | SkillInstance | MarkInstance,
    private readonly targetType: 'pet' | 'skill' | 'mark',
    private readonly fromBase: any, // The base being transformed from (current)
    private readonly toBase: any, // The base being transformed to (original or new)
    private readonly transformType: 'temporary' | 'permanent',
    private readonly priority: number,
    private readonly causedBy?: MarkInstance | SkillInstance | Effect<EffectTrigger>,
    id?: string,
  ) {
    super(battle, id)
  }

  protected createContext(): TransformContext {
    return new TransformContext(
      this.parentContext,
      this.target,
      this.targetType,
      this.fromBase,
      this.toBase,
      this.transformType,
      this.priority,
      this.causedBy,
    )
  }

  protected getEffectTriggers() {
    return {
      before: [],
      during: [EffectTrigger.OnTransformEnd],
      after: [],
    }
  }

  protected executeOperation(): void {
    const context = this._context!

    // Execute the transformation end operation logic
    executeTransformEndOperation(context, this.battle)
  }
}

/**
 * Extracted transformation end operation logic
 * This function handles the end of transformations
 */
export function executeTransformEndOperation(context: TransformContext, battle: Battle): void {
  // Apply OnTransformEnd effects when transformation ends
  battle.applyEffects(context, EffectTrigger.OnTransformEnd)

  // Remove the transformation using the battle's transformation system
  battle.transformationSystem.removeTransformation(
    context.target as any, // Type assertion needed for the transformation system
    undefined, // transformationId - let the system determine which to remove
    'manual', // reason
  )
}
