import type { Battle } from '../battle.js'
import { BattleContinuation } from '../continuation.js'
import { BattleSwitchContext, SwitchPetContext } from '../context.js'
import { InteractivePhase } from './base.js'
import { SwitchPetPhase } from './switch.js'

export function prepareNextDecision(battle: Battle, reward = true) {
  const dead = battle.players.filter(player => player.team.every(pet => !pet.isAlive))
  if (dead.length) {
    battle.finish(
      dead.length === 2 ? null : battle.getOpponent(dead[0]).id,
      dead.length === 2 ? 'draw' : 'all_pet_fainted',
    )
    return
  }
  const forced = battle.players.filter(player => !player.activePet.isAlive).map(player => player.id)
  const killer = battle.lastKillerId ? battle.getPetByID(battle.lastKillerId).owner : null
  const bonus =
    reward &&
    forced.length &&
    battle.initial.allowFaintSwitch &&
    killer?.activePet.isAlive &&
    !forced.includes(killer.id)
      ? killer.id
      : null
  battle.phase = new BattleContinuation(forced.length ? 'switch' : 'selection', [], [], forced, bonus)
  battle.lastKillerId = null
  if (forced.length) battle.emitEvent('switchPrompt', { forced, reward: bonus })
  else battle.emitEvent('turnAction', { players: battle.players.map(player => player.id) })
}
export class BattleSwitchPhase extends InteractivePhase<BattleSwitchContext> {
  readonly kind = 'battle-switch'
  private get participants() {
    return [...this.battle.phase.forced, ...(this.battle.phase.reward ? [this.battle.phase.reward] : [])]
  }
  protected hasInput() {
    return this.participants.every(id => this.battle.phase.pending.some(action => action.player === id))
  }
  protected executeOperation() {
    const battle = this.battle
    for (const id of this.participants) {
      const action = battle.phase.pending.find(action => action.player === id)!
      if (action.type === 'switch-pet')
        battle.phaseManager.executeSync(
          new SwitchPetPhase(
            new SwitchPetContext(this.context, battle.getPlayerByID(id), battle.getPetByID(action.pet)),
          ),
        )
    }
    battle.phase.pending = []
    prepareNextDecision(battle, false)
  }
}
