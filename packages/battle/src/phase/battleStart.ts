import { EffectTrigger, BattleMessageType, BattleStatus, BattlePhase } from '@arcadia-eternity/const'
import { SynchronousPhase } from './base'
import type { Battle } from '../battle'
import type { BattleState } from '@arcadia-eternity/const'

/**
 * BattleStartPhase handles battle initialization operations
 * This phase replaces the initialization logic in startBattle method
 * Uses Battle itself as the context for OnBattleStart effects
 */
export class BattleStartPhase extends SynchronousPhase<Battle> {
  constructor(battle: Battle, id?: string) {
    super(battle, id)
  }

  protected createContext(): Battle {
    return this.battle
  }

  protected getEffectTriggers() {
    return {
      before: [],
      during: [],
      after: [EffectTrigger.OnBattleStart],
    }
  }

  protected executeOperation(): void {
    const battle = this.battle

    // Check if battle has already started
    if (battle.status !== BattleStatus.Unstarted) {
      throw new Error('战斗已经开始过了！')
    }

    // Set battle status to active
    battle.status = BattleStatus.OnBattle

    // Initialize lastStateMessage to empty state to ensure first message contains complete state diff
    battle['lastStateMessage'] = {} as BattleState

    // Initialize all listeners' lastState to empty state
    battle['messageCallbacks'].forEach(cb => {
      cb.lastState = {} as BattleState
    })

    // OnBattleStart effects are applied automatically by the phase system
    // in the 'during' stage defined in getEffectTriggers()

    // Emit battle start message
    battle.emitMessage(BattleMessageType.BattleStart, {})
  }
}
