import { EffectTrigger } from '@arcadia-eternity/const'
import { ContextPhase } from './base'
import type { TransformContext } from '../context'

export class TransformPhase extends ContextPhase<TransformContext> {
  protected executeOperation(): void {
    const context = this.event
    const battle = this.battle

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
  }
}

export class TransformEndPhase extends ContextPhase<TransformContext> {
  protected executeOperation(): void {
    const context = this.event
    const battle = this.battle

    // Apply OnTransformEnd effects when transformation ends
    battle.applyEffects(context, EffectTrigger.OnTransformEnd)

    // Remove the transformation using the battle's transformation system
    battle.transformationSystem.removeTransformation(
      context.target as any, // Type assertion needed for the transformation system
      undefined, // transformationId - let the system determine which to remove
      'manual', // reason
    )
  }
}
