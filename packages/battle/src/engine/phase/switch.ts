import { changeRage } from './rage'
import { EffectTrigger, BattleMessageType } from '@arcadia-eternity/const'
import { ContextPhase } from './base'
import { SwitchPetContext, TurnContext, RageContext } from '../context'
import { MarkSwitchOutPhase } from './MarkSwitchOutPhase'

export class SwitchPetPhase extends ContextPhase<SwitchPetContext> {
  protected executeOperation(): void {
    const context = this.event
    const battle = this.battle
    if (context.parent instanceof TurnContext) context.parent.appledContexts.push(context)

    const player = context.origin

    // Check if new pet is available
    if (!player.team.includes(context.switchInPet) || !context.switchInPet.isAlive) {
      battle.emitMessage(BattleMessageType.Error, {
        message: `${context.switchInPet.name} 无法出战！`,
      })
      return
    }

    // If switching to the same pet, do nothing
    if (player.activePet === context.switchInPet) {
      return
    }

    // Execute switch
    const oldPet = player.activePet
    context.switchInPet.appeared = true

    // Apply switch out effects
    battle.applyEffects(context, EffectTrigger.OnSwitchOut)
    battle.phaseManager.run(new MarkSwitchOutPhase(context.battle, context, oldPet))

    // Apply switch in effects
    player.activePet = context.switchInPet

    // Emit switch message
    battle.emitMessage(BattleMessageType.PetSwitch, {
      player: player.id,
      fromPet: oldPet.id,
      toPet: context.switchInPet.id,
      currentHp: context.switchInPet.currentHp,
    })

    battle.applyEffects(context, EffectTrigger.OnSwitchIn)
    context.battle.applyEffects(context, EffectTrigger.OnOwnerSwitchIn, ...context.switchInPet.marks)

    // Reduce rage to 80% after switching
    const loss = player.currentRage - Math.floor(player.currentRage * 0.8)
    if (loss > 0) {
      // Preserve the exact old balance even if a prior effect assigned fractional rage.
      changeRage(new RageContext(context, player, 'switch', 'reduce', loss, false, [0, 0], 'none'))
    }
  }
}
