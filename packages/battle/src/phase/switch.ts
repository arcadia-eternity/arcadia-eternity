import { EffectTrigger, BattleMessageType } from '@arcadia-eternity/const'
import { BattlePhaseBase } from './base'
import { SwitchPetContext } from '../context'
import type { Battle } from '../battle'
import type { Player } from '../player'
import type { Pet } from '../pet'

/**
 * SwitchPetPhase handles pet switching operations
 * Corresponds to SwitchPetContext and replaces performSwitchPet logic
 */
export class SwitchPetPhase extends BattlePhaseBase<SwitchPetContext> {
  constructor(
    battle: Battle,
    private readonly origin: Player,
    private readonly target: Pet,
    private readonly parentContext: any, // TurnContext or other parent
    id?: string,
  ) {
    super(battle, id)
  }

  protected createContext(): SwitchPetContext {
    return new SwitchPetContext(this.parentContext, this.origin, this.target)
  }

  protected getEffectTriggers() {
    return {
      before: [],
      during: [EffectTrigger.OnSwitchOut, EffectTrigger.OnSwitchIn],
      after: [],
    }
  }

  protected async executeOperation(): Promise<void> {
    const context = this._context!

    // Execute the switch operation logic (extracted from performSwitchPet)
    await executeSwitchPetOperation(context, this.battle)
  }
}

/**
 * Extracted switch pet operation logic from Player.performSwitchPet
 * This function contains the core pet switching logic
 */
export async function executeSwitchPetOperation(context: SwitchPetContext, battle: Battle): Promise<void> {
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

  // Apply switch out effects
  battle.applyEffects(context, EffectTrigger.OnSwitchOut)
  oldPet.switchOut(context)

  // Switch the active pet
  player.activePet = context.switchInPet

  // Apply switch in effects
  battle.applyEffects(context, EffectTrigger.OnSwitchIn)
  player.activePet.switchIn(context)

  // Emit switch message
  battle.emitMessage(BattleMessageType.PetSwitch, {
    player: player.id,
    fromPet: oldPet.id,
    toPet: context.switchInPet.id,
    currentHp: context.switchInPet.currentHp,
  })

  // Reduce rage to 80% after switching
  player.settingRage(Math.floor(player.currentRage * 0.8))
}
