// battle/src/v2/phases/switch.handler.ts
import type { PhaseHandler, PhaseDef, PhaseResult, World, PhaseManager, EffectPipeline } from '@arcadia-eternity/engine'
import type { EventBus } from '@arcadia-eternity/engine'
import { EffectTrigger } from '@arcadia-eternity/const'
import type { PlayerSystem } from '../systems/player.system.js'
import type { PetSystem } from '../systems/pet.system.js'
import type { MarkSystem } from '../systems/mark.system.js'
import type { SwitchPetContextData } from '../schemas/context.schema.js'

export interface SwitchPhaseData {
  context: SwitchPetContextData
}

export class SwitchHandler implements PhaseHandler<SwitchPhaseData> {
  readonly type = 'switch'

  constructor(
    private playerSystem: PlayerSystem,
    private petSystem: PetSystem,
    private markSystem: MarkSystem,
    private phaseManager: PhaseManager,
    private effectPipeline: EffectPipeline,
  ) {}

  initialize(_world: World, phase: PhaseDef): SwitchPhaseData {
    return phase.data as SwitchPhaseData
  }

  async execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult> {
    const data = phase.data as SwitchPhaseData
    const ctx = data.context

    const switchInPet = this.petSystem.get(world, ctx.switchInPetId)
    if (!switchInPet || !this.petSystem.isAlive(world, ctx.switchInPetId)) {
      return { success: true, state: 'completed', data }
    }

    // If switching to same pet, skip
    const player = this.playerSystem.getOrThrow(world, ctx.originPlayerId)
    if (player.activePetId === ctx.switchInPetId) {
      return { success: true, state: 'completed', data }
    }

    const oldPetId = ctx.switchOutPetId ?? player.activePetId

    // Fire OnSwitchOut effects on the old pet
    await this.effectPipeline.fire(world, EffectTrigger.OnSwitchOut, {
      trigger: EffectTrigger.OnSwitchOut,
      sourceEntityId: oldPetId,
      context: ctx,
    })

    // Handle marks on the old pet during switch out
    if (oldPetId) {
      // Fire OnOwnerSwitchOut on old pet's marks
      const oldPetMarks = this.markSystem.getMarksOnEntity(world, oldPetId)
      await this.effectPipeline.fire(world, EffectTrigger.OnOwnerSwitchOut, {
        trigger: EffectTrigger.OnOwnerSwitchOut,
        sourceEntityId: oldPetId,
        context: ctx,
      }, oldPetMarks.map(m => m.id))

      // Process marks: transfer / keep / remove
      for (const mark of oldPetMarks) {
        const config = this.markSystem.getConfig(world, mark.id)
        if (config.transferOnSwitch) {
          this.markSystem.detach(world, mark.id)
          this.markSystem.attach(world, mark.id, ctx.switchInPetId, 'pet')
        } else if (config.keepOnSwitchOut) {
          // Keep mark on old pet
        } else {
          await this.phaseManager.execute(world, 'removeMark', bus, {
            context: {
              type: 'remove-mark',
              parentId: phase.id,
              markId: mark.id,
              available: true,
            },
          })
        }
      }
    }

    bus.emit(world, 'switchOut', {
      playerId: ctx.originPlayerId,
      petId: oldPetId,
    })

    // Switch active pet
    this.playerSystem.setActivePet(world, ctx.originPlayerId, ctx.switchInPetId)
    this.petSystem.setAppeared(world, ctx.switchInPetId, true)

    bus.emit(world, 'switchIn', {
      playerId: ctx.originPlayerId,
      petId: ctx.switchInPetId,
    })

    // Fire OnSwitchIn effects on the new pet
    await this.effectPipeline.fire(world, EffectTrigger.OnSwitchIn, {
      trigger: EffectTrigger.OnSwitchIn,
      sourceEntityId: ctx.switchInPetId,
      context: ctx,
    })

    // Fire OnOwnerSwitchIn on new pet's marks
    const newPetMarks = this.markSystem.getMarksOnEntity(world, ctx.switchInPetId)
    if (newPetMarks.length > 0) {
      await this.effectPipeline.fire(world, EffectTrigger.OnOwnerSwitchIn, {
        trigger: EffectTrigger.OnOwnerSwitchIn,
        sourceEntityId: ctx.switchInPetId,
        context: ctx,
      }, newPetMarks.map(m => m.id))
    }

    // Reduce rage by 20% on switch
    const currentRage = this.playerSystem.getRage(world, ctx.originPlayerId)
    const rageLoss = Math.floor(currentRage * 0.2)
    if (rageLoss > 0) {
      await this.phaseManager.execute(world, 'rage', bus, {
        context: {
          type: 'rage',
          parentId: phase.id,
          targetPlayerId: ctx.originPlayerId,
          reason: 'switch',
          modifiedType: 'reduce',
          value: rageLoss,
          ignoreRageObtainEfficiency: false,
          modified: [0, 0],
          rageChangeResult: 0,
          available: true,
        },
      })
    }

    return { success: true, state: 'completed', data }
  }
}
