// battle/src/v2/phases/rage.handler.ts
import type { PhaseHandler, PhaseDef, PhaseResult, World, EffectPipeline } from '@arcadia-eternity/engine'
import type { EventBus } from '@arcadia-eternity/engine'
import { EffectTrigger } from '@arcadia-eternity/const'
import type { PlayerSystem } from '../systems/player.system.js'
import type { RageContextData } from '../schemas/context.schema.js'

export interface RagePhaseData {
  context: RageContextData
}

export class RageHandler implements PhaseHandler<RagePhaseData> {
  readonly type = 'rage'

  constructor(
    private playerSystem: PlayerSystem,
    private effectPipeline: EffectPipeline,
  ) {}

  initialize(_world: World, phase: PhaseDef): RagePhaseData {
    return phase.data as RagePhaseData
  }

  async execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult> {
    const data = phase.data as RagePhaseData
    const ctx = data.context

    if (!ctx.available) {
      return { success: true, state: 'completed', data }
    }

    // Fire before-rage effects based on direction
    if (ctx.modifiedType === 'add') {
      await this.effectPipeline.fire(world, EffectTrigger.BeforeRageGain, {
        trigger: EffectTrigger.BeforeRageGain,
        sourceEntityId: ctx.targetPlayerId,
        context: ctx,
      })
    } else if (ctx.modifiedType === 'reduce') {
      await this.effectPipeline.fire(world, EffectTrigger.BeforeRageLoss, {
        trigger: EffectTrigger.BeforeRageLoss,
        sourceEntityId: ctx.targetPlayerId,
        context: ctx,
      })
    }

    if (!ctx.available) {
      return { success: true, state: 'completed', data }
    }

    const percentMod = 1 + ctx.modified[0] / 100
    const deltaMod = ctx.modified[1]
    ctx.rageChangeResult = Math.floor(ctx.value * percentMod + deltaMod)

    const currentRage = this.playerSystem.getRage(world, ctx.targetPlayerId)
    let newRage: number

    switch (ctx.modifiedType) {
      case 'setting':
        newRage = ctx.rageChangeResult
        break
      case 'add':
        newRage = currentRage + ctx.rageChangeResult
        break
      case 'reduce':
        newRage = currentRage - ctx.rageChangeResult
        break
      default:
        newRage = currentRage
    }

    this.playerSystem.setRage(world, ctx.targetPlayerId, newRage)

    const actualNewRage = this.playerSystem.getRage(world, ctx.targetPlayerId)

    bus.emit(world, 'rageChange', {
      playerId: ctx.targetPlayerId,
      reason: ctx.reason,
      type: ctx.modifiedType,
      amount: ctx.rageChangeResult,
      before: currentRage,
      newRage: actualNewRage,
    })

    // Fire after-rage effects based on direction
    if (ctx.modifiedType === 'add') {
      await this.effectPipeline.fire(world, EffectTrigger.OnRageGain, {
        trigger: EffectTrigger.OnRageGain,
        sourceEntityId: ctx.targetPlayerId,
        context: ctx,
      })
    } else if (ctx.modifiedType === 'reduce') {
      await this.effectPipeline.fire(world, EffectTrigger.OnRageLoss, {
        trigger: EffectTrigger.OnRageLoss,
        sourceEntityId: ctx.targetPlayerId,
        context: ctx,
      })
    }

    return { success: true, state: 'completed', data }
  }
}
