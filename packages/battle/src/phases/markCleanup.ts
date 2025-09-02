import type { Battle } from '../battle'
import type { TurnContext } from '../context'
import type { Pet } from '../pet'
import { SynchronousPhase } from '../phase'

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
