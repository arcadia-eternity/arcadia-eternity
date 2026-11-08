import { StackStrategy, EffectTrigger, BattleMessageType } from '@arcadia-eternity/const'
import type { Battle } from '../battle'
import type { StackContext } from '../context'
import { StatLevelMarkInstanceImpl } from '../mark'
import { Pet } from '../pet'
import { SynchronousPhase } from './base'
import { executeStatLevelMarkStacking } from './mark'
import { RemoveMarkPhase } from './RemoveMarkPhase'

/**
 * MarkStackPhase handles mark stacking operations
 * Replaces MarkInstance.tryStack logic with proper phase-based execution
 */

export class MarkStackPhase extends SynchronousPhase<StackContext> {
  constructor(
    battle: Battle,
    private readonly stackContext: StackContext,
    id?: string,
  ) {
    super(battle, id)
    this._context = stackContext
  }

  protected createContext(): StackContext {
    return this._context!
  }

  protected executeOperation(): void {
    const context = this._context!

    // Execute the mark stack operation logic
    executeMarkStackOperation(context, this.battle)
  }
}
/**
 * Extracted mark stack operation logic
 * This function contains the core mark stacking logic, replacing MarkInstance.tryStack
 */

export function executeMarkStackOperation(context: StackContext, battle: Battle): void {
  const existingMark = context.existingMark
  const newMark = context.incomingMark
  const strategy = context.stackStrategy

  // Handle special strategies that don't modify values
  if (strategy === StackStrategy.remove) {
    const removePhase = new RemoveMarkPhase(battle, context, existingMark)
    battle.phaseManager.registerPhase(removePhase)
    battle.phaseManager.executePhase(removePhase.id)
    return
  }

  if (strategy === StackStrategy.none) {
    return
  }

  // Handle StatLevel marks with special logic
  if (existingMark instanceof StatLevelMarkInstanceImpl && newMark instanceof StatLevelMarkInstanceImpl) {
    executeStatLevelMarkStacking(existingMark, newMark, context, battle)
    return
  }

  // Handle regular marks with standard stacking strategies
  const maxStacks = existingMark.config.maxStacks ?? Infinity
  let newStacks = existingMark.stack
  let newDuration = existingMark.duration

  // Apply stacking strategy
  switch (strategy) {
    case StackStrategy.stack:
      newStacks = Math.min(newStacks + newMark.stack, maxStacks)
      newDuration = Math.max(newDuration, newMark.duration)
      break

    case StackStrategy.refresh:
      newDuration = Math.max(newDuration, newMark.duration)
      break

    case StackStrategy.extend:
      newStacks = Math.min(newStacks + newMark.stack, maxStacks)
      newDuration += newMark.duration
      break

    case StackStrategy.max:
      newStacks = Math.min(Math.max(newStacks, newMark.stack), maxStacks)
      newDuration = Math.max(newDuration, newMark.duration)
      break

    case StackStrategy.replace:
      newStacks = Math.min(newMark.stack, maxStacks)
      newDuration = newMark.duration
      break

    default:
      return
  }

  // Update context with calculated values
  context.stacksAfter = newStacks
  context.durationAfter = newDuration

  // Apply OnStackBefore effects (allows effects to modify the calculated values)
  battle.applyEffects(context, EffectTrigger.OnStackBefore)

  // Use potentially modified values from OnStackBefore effects
  const finalStacks = context.stacksAfter
  const finalDuration = context.durationAfter

  // Apply final results
  existingMark.attributeSystem.setStack(finalStacks)
  existingMark.attributeSystem.setDuration(finalDuration)
  existingMark.isActive = true

  // Apply OnStack effects
  battle.applyEffects(context, EffectTrigger.OnStack)

  // Check if mark should be destroyed (when stacks reach 0)
  if (existingMark.stack <= 0) {
    const removePhase = new RemoveMarkPhase(battle, context, existingMark)
    battle.phaseManager.registerPhase(removePhase)
    battle.phaseManager.executePhase(removePhase.id)
    return
  }

  // Emit mark update message
  battle.emitMessage(BattleMessageType.MarkUpdate, {
    target: existingMark.owner instanceof Pet ? existingMark.owner.id : 'battle',
    mark: existingMark.toMessage(),
  })
}
