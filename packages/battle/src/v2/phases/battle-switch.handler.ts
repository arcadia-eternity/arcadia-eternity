// battle/src/v2/phases/battle-switch.handler.ts
// BattleSwitchHandler — handles forced switches (faint) and faint-reward switches.

import type { PhaseHandler, PhaseDef, PhaseResult, World, PhaseManager } from '@arcadia-eternity/engine'
import type { EventBus } from '@arcadia-eternity/engine'
import type { PlayerSystem } from '../systems/player.system.js'
import type { PetSystem } from '../systems/pet.system.js'
import type { SelectionSystem } from '../systems/selection.system.js'
import type { DecisionManager } from '../decision/manager.js'

export interface BattleSwitchPhaseData {
  selectionSystem: SelectionSystem
  decisionManager: DecisionManager
}

export class BattleSwitchHandler implements PhaseHandler<BattleSwitchPhaseData> {
  readonly type = 'battleSwitch'

  constructor(
    private playerSystem: PlayerSystem,
    private petSystem: PetSystem,
    private phaseManager: PhaseManager,
  ) {}

  initialize(_world: World, phase: PhaseDef): BattleSwitchPhaseData {
    return phase.data as BattleSwitchPhaseData
  }

  async execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult> {
    const data = phase.data as BattleSwitchPhaseData
    const selectionSystem = data.selectionSystem
    const decisionManager = data.decisionManager

    const playerAId = world.state.playerAId as string
    const playerBId = world.state.playerBId as string
    const allowFaintSwitch = world.state.allowFaintSwitch !== false

    // Loop until no more switches needed (cascade kills)
    while (true) {
      // Collect players whose active pet is dead
      const forcedSwitchPlayerIds: string[] = []
      for (const pid of [playerAId, playerBId]) {
        const activePet = this.playerSystem.getActivePet(world, pid)
        if (!this.petSystem.isAlive(world, activePet.id)) {
          // Check if player has any alive pets to switch to
          const available = this.playerSystem.getAvailableSwitchPets(world, pid)
          if (available.length === 0) {
            // No pets left — battle should end
            return { success: true, state: 'completed', data }
          }
          forcedSwitchPlayerIds.push(pid)
        }
      }

      // Determine faint switch (kill reward)
      let faintSwitchPlayerId: string | undefined
      if (allowFaintSwitch && world.state.lastKillerId && forcedSwitchPlayerIds.length < 2) {
        const killerPetId = world.state.lastKillerId as string
        const killerOwner = this.petSystem.getOwner(world, killerPetId)
        // Only grant faint switch if the killer's owner doesn't need a forced switch
        if (!forcedSwitchPlayerIds.includes(killerOwner)) {
          faintSwitchPlayerId = killerOwner
        }
      }

      // No switches needed — exit loop
      if (forcedSwitchPlayerIds.length === 0 && !faintSwitchPlayerId) {
        break
      }

      // Check if battle ended (e.g. no available switches)
      if (world.state.status === 'ended' || world.state.victor) {
        return { success: true, state: 'completed', data }
      }

      // Set meta for selection system to know what kind of switch is needed
      world.state.currentPhase = 'switch'
      world.state.pendingForcedSwitchPlayerIds = forcedSwitchPlayerIds
      world.state.pendingFaintSwitchPlayerId = faintSwitchPlayerId

      // Emit messages
      if (forcedSwitchPlayerIds.length > 0) {
        bus.emit(world, 'forcedSwitch', { playerIds: forcedSwitchPlayerIds })
      }
      if (faintSwitchPlayerId) {
        bus.emit(world, 'faintSwitch', { playerId: faintSwitchPlayerId })
      }

      // Collect all players that need to make a selection
      const playersNeedingSelection = [...forcedSwitchPlayerIds]
      if (faintSwitchPlayerId && !playersNeedingSelection.includes(faintSwitchPlayerId)) {
        playersNeedingSelection.push(faintSwitchPlayerId)
      }

      // Wait for selections
      selectionSystem.clearSelections(world)
      const selections = await decisionManager.collectDecisions(playersNeedingSelection, 'switch')

      // Execute switches
      for (const playerId of playersNeedingSelection) {
        const sel = selections[playerId]
        if (!sel) continue

        if (sel.type === 'surrender') {
          const opponentId = playerId === playerAId ? playerBId : playerAId
          const reason = decisionManager.consumeTimeoutSurrender(playerId) ? 'timeout' : 'surrender'
          world.state.victor = opponentId
          world.state.endReason = reason
          world.state.status = 'ended'
          return { success: true, state: 'completed', data }
        }

        if (sel.type === 'switch-pet') {
          const activePet = this.playerSystem.getActivePet(world, playerId)
          await this.phaseManager.execute(world, 'switch', bus, {
            context: {
              type: 'switch-pet',
              parentId: phase.id,
              originPlayerId: playerId,
              switchInPetId: sel.pet,
              switchOutPetId: activePet.id,
            },
          })
        }
        // 'do-nothing' for faint switch reward — skip
      }

      // Reset state for next iteration
      world.state.pendingForcedSwitchPlayerIds = []
      world.state.pendingFaintSwitchPlayerId = undefined
      world.state.lastKillerId = undefined
    }

    return { success: true, state: 'completed', data }
  }
}
