import { SelectionContext } from '../context.js'
import { InteractivePhase } from './base.js'
export class SelectionPhase extends InteractivePhase<SelectionContext> {
  readonly kind = 'selection'
  protected hasInput() {
    return this.battle.phase.pending.length === 2
  }
  protected executeOperation() {
    const battle = this.battle
    battle.phase.queue = battle.players.map(player => ({
      action: battle.phase.pending.find(action => action.player === player.id)!,
      actorPetId: player.activePet.id,
    }))
    battle.phase.pending = []
    battle.phase.kind = 'turn-start'
  }
}
