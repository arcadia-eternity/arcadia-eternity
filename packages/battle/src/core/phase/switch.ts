import { EffectTrigger } from '@arcadia-eternity/const'
import { SwitchPetContext, RageContext } from '../context.js'
import { SynchronousPhase } from './base.js'
import { MarkSwitchOutPhase } from './mark.js'
export class SwitchPetPhase extends SynchronousPhase<SwitchPetContext> {
  readonly kind = 'switch-pet'
  protected executeOperation() {
    const ctx = this.context,
      { player, outgoing, incoming } = ctx,
      battle = this.battle
    if (!incoming.isAlive || incoming === outgoing || incoming.owner !== player) return
    battle.applyEffects(ctx, EffectTrigger.OnSwitchOut)
    battle.phaseManager.executeSync(new MarkSwitchOutPhase(ctx))
    battle.emitEvent('switchOut', { playerId: player.id, petId: outgoing.id })
    player.activePet = incoming
    incoming.appeared = true
    battle.emitEvent('switchIn', { playerId: player.id, petId: incoming.id })
    battle.applyEffects(ctx, EffectTrigger.OnSwitchIn)
    battle.applyEffects(ctx, EffectTrigger.OnOwnerSwitchIn, [...incoming.marks])
    battle.changeRage(
      new RageContext(ctx, player, player.currentRage - Math.floor(player.currentRage * 0.8), 'reduce', 'switch'),
    )
  }
}
