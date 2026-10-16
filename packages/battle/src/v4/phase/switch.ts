import { EffectTrigger, BattleMessageType } from '@arcadia-eternity/const'
import { SynchronousPhase } from './base'
import { SwitchPetContext } from '../context'
import type { Battle } from '../battle'
import type { Player } from '../player'
import type { Pet } from '../pet'
import { MarkSwitchOutPhase } from './MarkSwitchOutPhase'

/**
 * SwitchPetPhase handles pet switching operations
 * Corresponds to SwitchPetContext and replaces performSwitchPet logic
 */
export class SwitchPetPhase extends SynchronousPhase<SwitchPetContext> {
  constructor(
    battle: Battle,
    private readonly origin: Player,
    private readonly target: Pet,
    private readonly parentContext: any, // TurnContext or other parent
    private readonly existingContext?: SwitchPetContext, // Optional existing context
    id?: string,
  ) {
    super(battle, id)
  }

  protected createContext(): SwitchPetContext {
    // Use existing context if provided, otherwise create new one
    return this.existingContext || new SwitchPetContext(this.parentContext, this.origin, this.target)
  }

  protected executeOperation(): void {
    const context = this._context!

    // Execute the switch operation logic (extracted from performSwitchPet)
    executeSwitchPetOperation(context, this.battle)
  }
}

/**
 * Extracted switch pet operation logic from Player.performSwitchPet
 * This function contains the core pet switching logic
 */
export function executeSwitchPetOperation(context: SwitchPetContext, battle: Battle): void {
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
  const switchOutPhase = new MarkSwitchOutPhase(context.battle, context, oldPet)
  switchOutPhase.initialize()
  switchOutPhase.execute()

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
  player.settingRage(Math.floor(player.currentRage * 0.8))
}
