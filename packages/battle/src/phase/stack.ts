import { EffectTrigger, BattleMessageType, StackStrategy } from '@arcadia-eternity/const'
import { SynchronousPhase } from './base'
import { StackContext, type AddMarkContext, RemoveMarkContext } from '../context'
import type { Battle } from '../battle'
import type { MarkInstance } from '../mark'
import { Pet } from '../pet'

/**
 * StackPhase handles mark stacking operations
 * Corresponds to StackContext and replaces mark stacking logic
 */
export class StackPhase extends SynchronousPhase<StackContext> {
  constructor(
    battle: Battle,
    private readonly parentContext: AddMarkContext,
    private readonly existingMark: MarkInstance,
    private readonly incomingMark: MarkInstance,
    private readonly stacksBefore: number,
    private readonly durationBefore: number,
    private readonly stacksAfter: number,
    private readonly durationAfter: number,
    private readonly stackStrategy: StackStrategy,
    id?: string,
  ) {
    super(battle, id)
  }

  protected createContext(): StackContext {
    return new StackContext(
      this.parentContext,
      this.existingMark,
      this.incomingMark,
      this.stacksBefore,
      this.durationBefore,
      this.stacksAfter,
      this.durationAfter,
      this.stackStrategy,
    )
  }

  protected getEffectTriggers() {
    return {
      before: [], // OnStackBefore is handled in executeOperation
      during: [], // OnStack is handled in executeOperation
      after: [],
    }
  }

  protected executeOperation(): void {
    const context = this._context!

    // Execute the stack operation logic (extracted from MarkInstance.tryStack)
    executeStackOperation(context, this.battle)
  }
}

/**
 * Extracted stack operation logic from MarkInstance.tryStack
 * This function contains the core mark stacking logic
 */
export function executeStackOperation(context: StackContext, battle: Battle): void {
  // Apply OnStackBefore effects to modify stacking values
  battle.applyEffects(context, EffectTrigger.OnStackBefore)

  // Use potentially modified values from OnStackBefore effects
  const finalStacks = context.stacksAfter
  const finalDuration = context.durationAfter

  // Apply the final stacking result to the existing mark
  const changed = finalStacks !== context.existingMark.stack || finalDuration !== context.existingMark.duration
  context.existingMark.stack = finalStacks
  context.existingMark.duration = finalDuration
  context.existingMark.isActive = true

  // Apply OnStack effects for side effects based on final result
  battle.applyEffects(context, EffectTrigger.OnStack)

  // Check if mark should be destroyed (when stacks reach 0)
  if (context.existingMark.stack <= 0) {
    const removeContext = new RemoveMarkContext(context.parent as AddMarkContext, context.existingMark)
    context.existingMark.destroy(removeContext)
    return
  }

  // Emit mark update message if there were changes
  if (changed) {
    battle.emitMessage(BattleMessageType.MarkUpdate, {
      target: context.existingMark.owner instanceof Pet ? context.existingMark.owner.id : 'battle',
      mark: context.existingMark.toMessage(),
    })
  }
}
