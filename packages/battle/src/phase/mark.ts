import { EffectTrigger, BattleMessageType, StackStrategy } from '@arcadia-eternity/const'
import { SynchronousPhase } from './base'
import {
  AddMarkContext,
  RemoveMarkContext,
  StackContext,
  TurnContext,
  EffectContext,
  SwitchPetContext,
} from '../context'
import type { Battle } from '../battle'
import { Pet } from '../pet'
import type { MarkOwner } from '../entity'
import {
  StatLevelMarkInstanceImpl,
  BaseStatLevelMark,
  CreateStatStageMark,
  type BaseMark,
  type MarkInstance,
} from '../mark'

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
 * RemoveMarkPhase handles mark removal operations
 * Corresponds to RemoveMarkContext and replaces mark removal logic
 */
export class RemoveMarkPhase extends SynchronousPhase<RemoveMarkContext> {
  constructor(
    battle: Battle,
    private readonly parentContext: any, // EffectContext, DamageContext, AddMarkContext, or TurnContext
    private readonly mark: MarkInstance,
    id?: string,
  ) {
    super(battle, id)
  }

  protected createContext(): RemoveMarkContext {
    return new RemoveMarkContext(this.parentContext, this.mark)
  }

  protected executeOperation(): void {
    const context = this._context!

    // Execute the remove mark operation logic
    executeRemoveMarkOperation(context, this.battle)
  }
}

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
 * MarkUpdatePhase handles mark update operations
 * Replaces MarkInstance.update logic with proper phase-based execution
 */
export class MarkUpdatePhase extends SynchronousPhase<TurnContext> {
  constructor(
    battle: Battle,
    private readonly turnContext: TurnContext,
    private readonly mark: MarkInstance,
    id?: string,
  ) {
    super(battle, id)
    this._context = turnContext
  }

  protected createContext(): TurnContext {
    return this._context!
  }

  protected executeOperation(): void {
    const context = this._context!

    // Execute the mark update operation logic
    executeMarkUpdateOperation(context, this.mark, this.battle)
  }
}

/**
 * MarkCleanupPhase handles mark cleanup operations
 * Replaces Battle.cleanupMarks logic with proper phase-based execution
 */
export class MarkCleanupPhase extends SynchronousPhase<TurnContext> {
  constructor(
    battle: Battle,
    private readonly turnContext: TurnContext,
    id?: string,
  ) {
    super(battle, id)
    this._context = turnContext
  }

  protected createContext(): TurnContext {
    return this._context!
  }

  protected executeOperation(): void {
    const context = this._context!

    // Execute the mark cleanup operation logic
    executeMarkCleanupOperation(context, this.battle)
  }
}

/**
 * MarkTransferPhase handles mark transfer operations
 * Replaces MarkSystem.transferMarks logic with proper phase-based execution
 */
export class MarkTransferPhase extends SynchronousPhase<SwitchPetContext> {
  constructor(
    battle: Battle,
    private readonly transferContext: SwitchPetContext,
    private readonly target: Pet | Battle,
    private readonly marks: MarkInstance[],
    id?: string,
  ) {
    super(battle, id)
    this._context = transferContext
  }

  protected createContext(): SwitchPetContext {
    return this._context!
  }

  protected executeOperation(): void {
    const context = this._context!

    // Execute the mark transfer operation logic
    executeMarkTransferOperation(context, this.target, this.marks, this.battle)
  }
}

/**
 * MarkSwitchOutPhase handles mark switch out operations
 * Replaces MarkSystem.handleSwitchOut logic with proper phase-based execution
 */
export class MarkSwitchOutPhase extends SynchronousPhase<SwitchPetContext> {
  constructor(
    battle: Battle,
    private readonly switchContext: SwitchPetContext,
    private readonly pet: Pet,
    id?: string,
  ) {
    super(battle, id)
    this._context = switchContext
  }

  protected createContext(): SwitchPetContext {
    return this._context!
  }

  protected executeOperation(): void {
    const context = this._context!

    // Execute the mark switch out operation logic
    executeMarkSwitchOutOperation(context, this.pet, this.battle)
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

    // Remove all conflicting marks
    existingMarks.forEach(mark => mark.destroy(context))
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
        mark.base.statType === baseStatLevelMark.statType,
    ) as StatLevelMarkInstanceImpl | undefined

    // Check if it's an opposite mark (different sign)
    if (existingStatLevelMark && existingStatLevelMark.isOppositeMark(newMark)) {
      existingOppositeMark = existingStatLevelMark
      existingStatLevelMark = undefined
    }
  }

  // Check for existing mark of the same type (for non-stat level marks)
  const existingMark = existingStatLevelMark || context.target.marks.find(mark => mark.base.id === context.baseMark.id)

  if (existingMark || existingOppositeMark) {
    if (existingMark) {
      // Handle StatLevel marks specially
      if (existingMark instanceof StatLevelMarkInstanceImpl && newMark instanceof StatLevelMarkInstanceImpl) {
        handleStatLevelMarkStacking(existingMark, newMark, context, battle)
        return
      }

      // Calculate stacking result for regular marks
      const strategy = existingMark.config.stackStrategy || StackStrategy.extend
      const maxStacks = existingMark.config.maxStacks ?? Infinity
      let stacksAfter = existingMark.stack
      let durationAfter = existingMark.duration

      // Apply stacking strategy to calculate initial values
      switch (strategy) {
        case StackStrategy.stack:
          stacksAfter = Math.min(stacksAfter + newMark.stack, maxStacks)
          durationAfter = Math.max(durationAfter, newMark.duration)
          break
        case StackStrategy.refresh:
          durationAfter = Math.max(durationAfter, newMark.duration)
          break
        case StackStrategy.extend:
          stacksAfter = Math.min(stacksAfter + newMark.stack, maxStacks)
          durationAfter += newMark.duration
          break
        case StackStrategy.max:
          stacksAfter = Math.min(Math.max(stacksAfter, newMark.stack), maxStacks)
          durationAfter = Math.max(durationAfter, newMark.duration)
          break
        case StackStrategy.replace:
          stacksAfter = Math.min(newMark.stack, maxStacks)
          durationAfter = newMark.duration
          break
        default:
          // For remove, none, etc., use original values
          break
      }

      const stackPhase = new MarkStackPhase(
        battle,
        new StackContext(
          context,
          existingMark,
          newMark,
          existingMark.stack,
          existingMark.duration,
          stacksAfter,
          durationAfter,
          strategy,
        ),
      )
      battle.phaseManager.registerPhase(stackPhase)
      battle.phaseManager.executePhase(stackPhase.id)
      return
    } else if (existingOppositeMark) {
      // Handle StatLevel opposite marks specially
      if (existingOppositeMark instanceof StatLevelMarkInstanceImpl && newMark instanceof StatLevelMarkInstanceImpl) {
        handleStatLevelMarkStacking(existingOppositeMark, newMark, context, battle)
        return
      }

      // Calculate stacking result for regular opposite marks
      const strategy = existingOppositeMark.config.stackStrategy || StackStrategy.extend
      const maxStacks = existingOppositeMark.config.maxStacks ?? Infinity
      let stacksAfter = existingOppositeMark.stack
      let durationAfter = existingOppositeMark.duration

      // Apply stacking strategy to calculate initial values
      switch (strategy) {
        case StackStrategy.stack:
          stacksAfter = Math.min(stacksAfter + newMark.stack, maxStacks)
          durationAfter = Math.max(durationAfter, newMark.duration)
          break
        case StackStrategy.refresh:
          durationAfter = Math.max(durationAfter, newMark.duration)
          break
        case StackStrategy.extend:
          stacksAfter = Math.min(stacksAfter + newMark.stack, maxStacks)
          durationAfter += newMark.duration
          break
        case StackStrategy.max:
          stacksAfter = Math.min(Math.max(stacksAfter, newMark.stack), maxStacks)
          durationAfter = Math.max(durationAfter, newMark.duration)
          break
        case StackStrategy.replace:
          stacksAfter = Math.min(newMark.stack, maxStacks)
          durationAfter = newMark.duration
          break
        default:
          // For remove, none, etc., use original values
          break
      }

      const stackPhase = new MarkStackPhase(
        battle,
        new StackContext(
          context,
          existingOppositeMark,
          newMark,
          existingOppositeMark.stack,
          existingOppositeMark.duration,
          stacksAfter,
          durationAfter,
          strategy,
        ),
      )
      battle.phaseManager.registerPhase(stackPhase)
      battle.phaseManager.executePhase(stackPhase.id)
      return
    }
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

/**
 * Extracted remove mark operation logic
 * This function contains the core mark removal logic, replacing MarkSystem.removeMark
 */
export function executeRemoveMarkOperation(context: RemoveMarkContext, battle: Battle): void {
  if (context.mark.owner) {
    context.mark.owner.marks.forEach(mark => {
      const filtered = mark.id !== context.mark.id
      if (!filtered) mark.destroy(context)
    })
  }
}

/**
 * Extracted mark stack operation logic
 * This function contains the core mark stacking logic, replacing MarkInstance.tryStack
 */
export function executeMarkStackOperation(context: StackContext, battle: Battle): void {
  const existingMark = context.existingMark
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

  // Apply OnStackBefore effects (allows effects to modify the calculated values)
  battle.applyEffects(context, EffectTrigger.OnStackBefore)

  // Use potentially modified values from OnStackBefore effects
  const newStacks = context.stacksAfter
  const newDuration = context.durationAfter

  // Apply final results
  existingMark.stack = newStacks
  existingMark.duration = newDuration
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

/**
 * Extracted mark update operation logic
 * This function contains the core mark update logic, replacing MarkInstance.update
 */
export function executeMarkUpdateOperation(context: TurnContext, mark: MarkInstance, battle: Battle): boolean {
  if (!mark.isActive) return true
  if (mark.config.persistent) return false

  mark.duration--
  const expired = mark.duration <= 0

  if (expired) {
    battle.applyEffects(context, EffectTrigger.OnMarkDurationEnd, mark)
    battle.emitMessage(BattleMessageType.MarkExpire, {
      mark: mark.id,
      target: mark.owner instanceof Pet ? mark.owner.id : 'battle',
    })
    const removePhase = new RemoveMarkPhase(battle, context, mark)
    battle.phaseManager.registerPhase(removePhase)
    battle.phaseManager.executePhase(removePhase.id)
    return expired
  }

  battle.emitMessage(BattleMessageType.MarkUpdate, {
    target: mark.owner instanceof Pet ? mark.owner.id : 'battle',
    mark: mark.toMessage(),
  })

  return expired
}

/**
 * Extracted mark cleanup operation logic
 * This function contains the core mark cleanup logic, replacing Battle.cleanupMarks
 */
export function executeMarkCleanupOperation(context: TurnContext, battle: Battle): void {
  // Clean up battle marks
  battle.marks = battle.marks.filter(mark => {
    return mark.isActive
  })

  // Clean up player pet marks
  const cleanPetMarks = (pet: Pet) => {
    pet.marks = pet.marks.filter(mark => {
      return mark.isActive || mark.owner !== pet
    })
  }

  cleanPetMarks(battle.playerA.activePet)
  cleanPetMarks(battle.playerB.activePet)
}

/**
 * Extracted mark transfer operation logic
 * This function contains the core mark transfer logic, replacing MarkSystem.transferMarks
 */
export function executeMarkTransferOperation(
  context: SwitchPetContext | EffectContext<EffectTrigger>,
  target: Pet | Battle,
  marks: MarkInstance[],
  battle: Battle,
): void {
  marks.forEach(mark => {
    mark.detach()
    const existingMark = target.marks.find(m => m.base.id === mark.base.id)
    if (existingMark) {
      // Create EffectContext for stacking
      const effectContext =
        context instanceof EffectContext
          ? context
          : new EffectContext(context, EffectTrigger.OnOwnerSwitchOut, mark, undefined)
      const addMarkContext = new AddMarkContext(
        effectContext,
        target,
        mark.base,
        mark.stack,
        mark.duration,
        mark.config,
      )

      // Calculate stacking result for transfer
      const strategy = existingMark.config.stackStrategy || StackStrategy.extend
      const maxStacks = existingMark.config.maxStacks ?? Infinity
      let stacksAfter = existingMark.stack
      let durationAfter = existingMark.duration

      // Apply stacking strategy to calculate initial values
      switch (strategy) {
        case StackStrategy.stack:
          stacksAfter = Math.min(stacksAfter + mark.stack, maxStacks)
          durationAfter = Math.max(durationAfter, mark.duration)
          break
        case StackStrategy.refresh:
          durationAfter = Math.max(durationAfter, mark.duration)
          break
        case StackStrategy.extend:
          stacksAfter = Math.min(stacksAfter + mark.stack, maxStacks)
          durationAfter += mark.duration
          break
        case StackStrategy.max:
          stacksAfter = Math.min(Math.max(stacksAfter, mark.stack), maxStacks)
          durationAfter = Math.max(durationAfter, mark.duration)
          break
        case StackStrategy.replace:
          stacksAfter = Math.min(mark.stack, maxStacks)
          durationAfter = mark.duration
          break
        default:
          // For remove, none, etc., use original values
          break
      }

      // Use MarkStackPhase for stacking
      const stackPhase = new MarkStackPhase(
        battle,
        new StackContext(
          addMarkContext,
          existingMark,
          mark,
          existingMark.stack,
          existingMark.duration,
          stacksAfter,
          durationAfter,
          strategy,
        ),
      )
      battle.phaseManager.registerPhase(stackPhase)
      battle.phaseManager.executePhase(stackPhase.id)
    } else {
      // Transfer mark directly
      mark.transfer(context, target)
    }
  })
}

/**
 * Extracted mark switch out operation logic
 * This function contains the core mark switch out logic, replacing MarkSystem.handleSwitchOut
 */
export function executeMarkSwitchOutOperation(context: SwitchPetContext, pet: Pet, battle: Battle): void {
  battle.applyEffects(context, EffectTrigger.OnOwnerSwitchOut, ...pet.marks)
  pet.marks = pet.marks.filter(mark => {
    const shouldKeep = mark.config.keepOnSwitchOut ?? false

    // Handle marks that need to be transferred
    if (mark.config.transferOnSwitch && (context as any).switchInPet) {
      const transferPhase = new MarkTransferPhase(battle, context, (context as any).switchInPet, [mark])
      battle.phaseManager.registerPhase(transferPhase)
      battle.phaseManager.executePhase(transferPhase.id)
      // Mark should be removed from original pet after transfer
      return false
    } else if (!shouldKeep) {
      const removePhase = new RemoveMarkPhase(battle, context, mark)
      battle.phaseManager.registerPhase(removePhase)
      battle.phaseManager.executePhase(removePhase.id)
      return false
    }

    return shouldKeep
  })
}

/**
 * Handle StatLevel mark stacking with special level-based logic
 */
function handleStatLevelMarkStacking(
  existingMark: StatLevelMarkInstanceImpl,
  newMark: StatLevelMarkInstanceImpl,
  context: AddMarkContext,
  battle: Battle,
): void {
  // Calculate new level by adding the levels
  const STAT_STAGE_MULTIPLIER = [0.25, 0.28, 0.33, 0.4, 0.5, 0.66, 1, 1.5, 2, 2.5, 3, 3.5, 4] as const
  const maxLevel = (STAT_STAGE_MULTIPLIER.length - 1) / 2
  const newLevel = Math.max(-maxLevel, Math.min(maxLevel, existingMark.level + newMark.level))

  // If new level is 0, destroy the mark
  if (newLevel === 0) {
    const removePhase = new RemoveMarkPhase(battle, context, existingMark)
    battle.phaseManager.registerPhase(removePhase)
    battle.phaseManager.executePhase(removePhase.id)
    return
  }

  // Check if we need to replace the mark (sign change)
  if (Math.sign(existingMark.level) !== Math.sign(newLevel)) {
    // Sign changed, need to replace with new mark with correct baseId
    replaceStatLevelMark(existingMark, newLevel, context, battle)
  } else {
    // Sign unchanged, just update the level
    existingMark.level = newLevel

    // Emit mark update message
    battle.emitMessage(BattleMessageType.MarkUpdate, {
      target: existingMark.owner instanceof Pet ? existingMark.owner.id : 'battle',
      mark: existingMark.toMessage(),
    })
  }
}

/**
 * Replace a StatLevel mark with a new one that has the correct baseId
 */
function replaceStatLevelMark(
  existingMark: StatLevelMarkInstanceImpl,
  newLevel: number,
  context: AddMarkContext,
  battle: Battle,
): void {
  if (!existingMark.owner) return

  // Create new BaseMark with correct baseId
  const newBaseMark = CreateStatStageMark(existingMark.base.statType, newLevel)

  // Save current mark properties
  const currentDuration = existingMark.duration
  const currentConfig = { ...existingMark.config }

  // Create new mark instance
  const newMarkInstance = newBaseMark.createInstance()

  // Set correct level
  newMarkInstance.level = newLevel

  // Set other properties
  newMarkInstance.duration = currentDuration
  newMarkInstance.config = currentConfig

  // Set owner and emitter
  if (existingMark.emitter) {
    newMarkInstance.setOwner(existingMark.owner, existingMark.emitter)
  }

  // Replace in marks array
  const markIndex = existingMark.owner.marks.indexOf(existingMark)
  if (markIndex !== -1) {
    existingMark.owner.marks[markIndex] = newMarkInstance
  }

  // Clean up existing mark's modifier
  existingMark.detach()

  // Add modifier for new mark by attaching to target
  newMarkInstance.attachTo(existingMark.owner)

  // Set existing mark as inactive
  existingMark.isActive = false

  // Emit mark update message
  battle.emitMessage(BattleMessageType.MarkUpdate, {
    target: existingMark.owner instanceof Pet ? existingMark.owner.id : 'battle',
    mark: newMarkInstance.toMessage(),
  })
}
