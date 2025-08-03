import { EffectTrigger, StackStrategy, BattleMessageType } from '@arcadia-eternity/const'
import type { Battle } from '../battle'
import { AddMarkContext, StackContext } from '../context'
import type { Instance, MarkOwner } from '../entity'
import { type BaseMark, type MarkInstance, StatLevelMarkInstanceImpl, BaseStatLevelMark } from '../mark'
import { Pet } from '../pet'
import { SynchronousPhase } from './base'
import { MarkStackPhase } from './MarkStackPhase'
import { RemoveMarkPhase } from './RemoveMarkPhase'

/**
 * AddMarkPhase handles mark addition operations
 * Corresponds to AddMarkContext and replaces mark addition logic
 */

export class AddMarkPhase extends SynchronousPhase<AddMarkContext> {
  constructor(
    battle: Battle,
    private readonly parentContext: any, // EffectContext
    private readonly target: MarkOwner,
    private readonly baseMark: BaseMark,
    private readonly stack?: number,
    private readonly duration?: number,
    private readonly config?: Partial<MarkInstance['config']>,
    id?: string,
    creator?: Instance,
  ) {
    super(battle, id)
  }

  protected createContext(): AddMarkContext {
    return new AddMarkContext(this.parentContext, this.target, this.baseMark, this.stack, this.duration, this.config)
  }

  protected executeOperation(): void {
    const context = this._context!

    // Execute the add mark operation logic
    executeAddMarkOperation(context, this.battle)
  }
}
/**
 * Extracted add mark operation logic
 * This function contains the core mark addition logic, replacing MarkSystem.addMark
 */

export function executeAddMarkOperation(context: AddMarkContext, battle: Battle): void {
  // Apply OnBeforeAddMark effects
  battle.applyEffects(context, EffectTrigger.OnBeforeAddMark)
  if (!context.available) {
    return
  }

  // Handle mutex group conflicts
  if (context.baseMark.config.mutexGroup) {
    // Get existing marks in the same mutex group
    const existingMarks = context.target.marks.filter(m => m.config.mutexGroup === context.baseMark.config.mutexGroup)

    // Remove conflicting marks, but skip marks of the same type (they should stack instead)
    existingMarks.forEach(mark => {
      // Skip if it's the same mark type - let stacking logic handle it
      if (mark.base.id === context.baseMark.id) {
        return
      }

      // For stat level marks, also check if they're the same stat type
      if (
        mark instanceof StatLevelMarkInstanceImpl &&
        context.baseMark instanceof BaseStatLevelMark &&
        mark.base instanceof BaseStatLevelMark &&
        mark.base.statType === context.baseMark.statType
      ) {
        return
      }

      // Remove conflicting marks using RemoveMarkPhase
      const removeMarkPhase = new RemoveMarkPhase(battle, context, mark)
      battle.phaseManager.registerPhase(removeMarkPhase)
      battle.phaseManager.executePhase(removeMarkPhase.id)
    })
  }

  // Create new mark instance
  const config = {
    config: context.config,
    duration: context.duration ?? context.config?.duration,
    stack: context.stack ?? context.config?.maxStacks,
  }
  const newMark = context.baseMark.createInstance(config)

  // Check for existing stat level mark of the same stat type
  let existingStatLevelMark: StatLevelMarkInstanceImpl | undefined
  let existingOppositeMark: StatLevelMarkInstanceImpl | undefined

  if (newMark instanceof StatLevelMarkInstanceImpl && context.baseMark instanceof BaseStatLevelMark) {
    // For stat level marks, find by stat type instead of base id
    const baseStatLevelMark = context.baseMark as BaseStatLevelMark
    existingStatLevelMark = context.target.marks.find(
      mark =>
        mark instanceof StatLevelMarkInstanceImpl &&
        mark.base instanceof BaseStatLevelMark &&
        mark.base.statType === baseStatLevelMark.statType &&
        mark.isActive, // Only consider active marks
    ) as StatLevelMarkInstanceImpl | undefined

    // Check if it's an opposite mark (different sign)
    if (existingStatLevelMark && existingStatLevelMark.isOppositeMark(newMark)) {
      existingOppositeMark = existingStatLevelMark
      existingStatLevelMark = undefined
    }
  }

  // Check for existing mark of the same type (for non-stat level marks)
  const existingMark =
    existingStatLevelMark || context.target.marks.find(mark => mark.base.id === context.baseMark.id && mark.isActive)

  if (existingMark || existingOppositeMark) {
    const targetMark = existingMark || existingOppositeMark!
    const strategy = targetMark.config.stackStrategy || StackStrategy.extend

    // Create StackContext with initial values (calculation will be done in MarkStackPhase)
    const stackPhase = new MarkStackPhase(
      battle,
      new StackContext(
        context,
        targetMark,
        newMark,
        targetMark.stack,
        targetMark.duration,
        newMark.stack, // Initial values, will be calculated in MarkStackPhase
        newMark.duration,
        strategy,
      ),
    )
    battle.phaseManager.registerPhase(stackPhase)
    battle.phaseManager.executePhase(stackPhase.id)
    return
  } else {
    // Create new mark
    newMark.OnMarkCreated(context.target as any, context)
    battle.emitMessage(BattleMessageType.MarkApply, {
      baseMarkId: context.baseMark.id,
      target: context.target instanceof Pet ? context.target.id : 'battle',
      mark: newMark.toMessage(),
    })
    return
  }
}
