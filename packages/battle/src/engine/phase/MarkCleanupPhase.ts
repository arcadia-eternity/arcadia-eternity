import type { Battle } from '../battle'
import type { TurnContext } from '../context'
import type { Pet } from '../pet'
import { SynchronousPhase } from './base'

export class MarkCleanupPhase extends SynchronousPhase<TurnContext> {
  constructor(battle: Battle, turnContext: TurnContext, id?: string) {
    super(battle, id)
    this._context = turnContext
  }

  protected createContext(): TurnContext {
    return this._context!
  }

  protected executeOperation(): void {
    const battle = this.battle

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
}
