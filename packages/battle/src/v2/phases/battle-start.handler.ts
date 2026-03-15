// battle/src/v2/phases/battle-start.handler.ts
import type { PhaseHandler, PhaseDef, PhaseResult, World, EffectPipeline } from '@arcadia-eternity/engine'
import type { EventBus } from '@arcadia-eternity/engine'
import { EffectTrigger } from '@arcadia-eternity/const'
import type { PlayerSystem } from '../systems/player.system.js'
import type { PetSystem } from '../systems/pet.system.js'

export interface BattleStartData {
  playerAId: string
  playerBId: string
}

export class BattleStartHandler implements PhaseHandler<BattleStartData> {
  readonly type = 'battleStart'

  constructor(
    private effectPipeline: EffectPipeline,
    private playerSystem: PlayerSystem,
    private petSystem: PetSystem,
  ) {}

  initialize(_world: World, phase: PhaseDef): BattleStartData {
    return (phase.data as BattleStartData) ?? { playerAId: '', playerBId: '' }
  }

  async execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult> {
    const data = phase.data as BattleStartData

    world.state.status = 'active'
    world.state.currentTurn = 0

    // v1 visibility semantics: both starters are visible from battle start.
    for (const playerId of [data.playerAId, data.playerBId]) {
      const activePet = this.playerSystem.getActivePet(world, playerId)
      this.petSystem.setAppeared(world, activePet.id, true)
    }

    bus.emit(world, 'battleStart', {
      playerAId: data.playerAId,
      playerBId: data.playerBId,
    })

    await this.effectPipeline.fire(world, EffectTrigger.OnBattleStart, {
      trigger: EffectTrigger.OnBattleStart,
      sourceEntityId: '',
      playerAId: data.playerAId,
      playerBId: data.playerBId,
    })

    return { success: true, state: 'completed' }
  }
}
