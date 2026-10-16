import { EffectTrigger } from '@arcadia-eternity/const'
import type { Battle } from '../battle.js'
import { AddMarkContext } from '../context.js'
import { SynchronousPhase } from './base.js'
import { prepareNextDecision } from './battleSwitch.js'
export class BattleStartPhase extends SynchronousPhase<Battle> {
  readonly kind = 'battle-start'
  protected executeOperation() {
    const battle = this.battle
    if (battle.status !== 'unstarted') throw new Error('Battle already started')
    battle.status = 'active'
    for (const player of battle.players)
      for (const pet of player.team)
        for (const id of [pet.ability, pet.emblem])
          if (id) battle.addMark(new AddMarkContext(battle, pet, battle.content.mark(id)))
    battle.emitEvent('battleStart', { playerAId: battle.playerA.id, playerBId: battle.playerB.id })
    battle.applyEffects(battle, EffectTrigger.OnBattleStart)
    prepareNextDecision(battle)
  }
}
