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
import { StatLevelMarkInstanceImpl, type BaseMark, type MarkInstance } from '../mark'

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

  protected getEffectTriggers() {
    return {
      before: [],
      during: [], // Mark system handles its own effects
      after: [],
    }
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

  protected getEffectTriggers() {
    return {
      before: [],
      during: [], // Mark system handles its own effects
      after: [],
    }
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

  protected getEffectTriggers() {
    return {
      before: [EffectTrigger.OnStackBefore],
      during: [EffectTrigger.OnStack],
      after: [],
    }
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

  protected getEffectTriggers() {
    return {
      before: [],
      during: [EffectTrigger.OnMarkDurationEnd],
      after: [],
    }
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

  protected getEffectTriggers() {
    return {
      before: [],
      during: [],
      after: [],
    }
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

  protected getEffectTriggers() {
    return {
      before: [],
      during: [EffectTrigger.OnOwnerSwitchOut],
      after: [],
    }
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

  protected getEffectTriggers() {
    return {
      before: [],
      during: [EffectTrigger.OnOwnerSwitchOut],
      after: [],
    }
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

  // Check for existing opposite mark (for stat level marks)
  const existingOppositeMark = context.target.marks.find(
    mark =>
      mark instanceof StatLevelMarkInstanceImpl &&
      newMark instanceof StatLevelMarkInstanceImpl &&
      mark.isOppositeMark(newMark),
  )

  // Check for existing mark of the same type
  const existingMark = context.target.marks.find(mark => mark.base.id === context.baseMark.id)

  if (existingMark || existingOppositeMark) {
    if (existingMark) {
      // Stack with existing mark
      const stackPhase = new MarkStackPhase(
        battle,
        new StackContext(
          context,
          existingMark,
          newMark,
          existingMark.stack,
          existingMark.duration,
          newMark.stack,
          newMark.duration,
          existingMark.config.stackStrategy || StackStrategy.extend,
        ),
      )
      stackPhase.initialize()
      stackPhase.execute()
      return
    } else if (existingOppositeMark) {
      // Stack with opposite mark
      const stackPhase = new MarkStackPhase(
        battle,
        new StackContext(
          context,
          existingOppositeMark,
          newMark,
          existingOppositeMark.stack,
          existingOppositeMark.duration,
          newMark.stack,
          newMark.duration,
          existingOppositeMark.config.stackStrategy || StackStrategy.extend,
        ),
      )
      stackPhase.initialize()
      stackPhase.execute()
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
  const newMark = context.incomingMark
  const strategy = context.stackStrategy
  const maxStacks = existingMark.config.maxStacks ?? Infinity

  let newStacks = context.stacksAfter
  let newDuration = context.durationAfter

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

    case StackStrategy.remove:
      const removePhase = new RemoveMarkPhase(battle, context, existingMark)
      removePhase.initialize()
      removePhase.execute()
      return

    case StackStrategy.none:
      return

    default:
      return
  }

  // Update context with new values
  context.stacksAfter = newStacks
  context.durationAfter = newDuration

  // Apply OnStackBefore effects
  battle.applyEffects(context, EffectTrigger.OnStackBefore)

  // Use potentially modified values from OnStackBefore effects
  newStacks = context.stacksAfter
  newDuration = context.durationAfter

  // Apply final results
  const changed = newStacks !== existingMark.stack || newDuration !== existingMark.duration
  existingMark.stack = newStacks
  existingMark.duration = newDuration
  existingMark.isActive = true

  // Apply OnStack effects
  battle.applyEffects(context, EffectTrigger.OnStack)

  // Check if mark should be destroyed (when stacks reach 0)
  if (existingMark.stack <= 0) {
    const removePhase = new RemoveMarkPhase(battle, context, existingMark)
    removePhase.initialize()
    removePhase.execute()
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
    removePhase.initialize()
    removePhase.execute()
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

      // Use MarkStackPhase for stacking
      const stackPhase = new MarkStackPhase(
        battle,
        new StackContext(
          addMarkContext,
          existingMark,
          mark,
          existingMark.stack,
          existingMark.duration,
          mark.stack,
          mark.duration,
          existingMark.config.stackStrategy || StackStrategy.extend,
        ),
      )
      stackPhase.initialize()
      stackPhase.execute()
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
      transferPhase.initialize()
      transferPhase.execute()
      // Mark should be removed from original pet after transfer
      return false
    } else if (!shouldKeep) {
      const removePhase = new RemoveMarkPhase(battle, context, mark)
      removePhase.initialize()
      removePhase.execute()
      return false
    }

    return shouldKeep
  })
}
