import { BattleLoopContext, SelectionContext, BattleSwitchContext, TurnContext } from '../context.js'
import { SynchronousPhase, PhaseState } from './base.js'
import { SelectionPhase } from './selection.js'
import { BattleSwitchPhase } from './battleSwitch.js'
import { TurnPhase } from './turn.js'
export class BattleLoopPhase extends SynchronousPhase<BattleLoopContext> {
  readonly kind = 'battle-loop'
  protected executeOperation() {
    const battle = this.battle
    switch (battle.phase.kind) {
      case 'selection':
        battle.phaseManager.execute(new SelectionPhase(new SelectionContext(battle)))
        break
      case 'turn-start': {
        battle.activeTurn = new TurnContext(battle, {
          number: battle.turn + 1,
          petData: {},
          plannedPetIds: [],
          executedPetIds: [],
        })
        battle.phaseManager.executeSync(new TurnPhase(battle.activeTurn))
        break
      }
      case 'action':
        if (!battle.activeTurn) throw new Error('Missing active TurnContext')
        else battle.phaseManager.executeSync(new TurnPhase(battle.activeTurn))
        break
      case 'turn-end':
        if (!battle.activeTurn) throw new Error('Missing active TurnContext')
        else battle.phaseManager.executeSync(new TurnPhase(battle.activeTurn))
        break
      case 'switch': {
        const result = battle.phaseManager.execute(new BattleSwitchPhase(new BattleSwitchContext(battle)))
        if (result.state === PhaseState.Waiting) throw new Error('Loop scheduled a waiting switch')
        break
      }
      default:
        throw new Error('Cannot advance this battle phase')
    }
  }
}
