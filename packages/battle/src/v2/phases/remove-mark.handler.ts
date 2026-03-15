// battle/src/v2/phases/remove-mark.handler.ts
import type { PhaseHandler, PhaseDef, PhaseResult, World, EffectPipeline } from '@arcadia-eternity/engine'
import type { EventBus } from '@arcadia-eternity/engine'
import { EffectTrigger } from '@arcadia-eternity/const'
import type { MarkSystem } from '../systems/mark.system.js'
import type { RemoveMarkContextData } from '../schemas/context.schema.js'

export interface RemoveMarkPhaseData {
  context: RemoveMarkContextData
}

export class RemoveMarkHandler implements PhaseHandler<RemoveMarkPhaseData> {
  readonly type = 'removeMark'

  constructor(
    private markSystem: MarkSystem,
    private effectPipeline: EffectPipeline,
  ) {}

  initialize(_world: World, phase: PhaseDef): RemoveMarkPhaseData {
    return phase.data as RemoveMarkPhaseData
  }

  async execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult> {
    const data = phase.data as RemoveMarkPhaseData
    const ctx = data.context

    if (!ctx.available) {
      return { success: true, state: 'completed', data }
    }

    const mark = this.markSystem.get(world, ctx.markId)
    if (!mark) {
      return { success: true, state: 'completed', data }
    }

    await this.effectPipeline.fire(world, EffectTrigger.OnRemoveMark, {
      trigger: EffectTrigger.OnRemoveMark,
      sourceEntityId: ctx.markId,
      context: ctx,
      markId: ctx.markId,
      baseMarkId: mark.baseMarkId,
    })

    if (!ctx.available) {
      return { success: true, state: 'completed', data }
    }

    await this.effectPipeline.fire(world, EffectTrigger.OnMarkDestroy, {
      trigger: EffectTrigger.OnMarkDestroy,
      sourceEntityId: ctx.markId,
      markId: ctx.markId,
      baseMarkId: mark.baseMarkId,
    }, [ctx.markId])

    const ownerId = mark.ownerId
    this.markSystem.destroy(world, ctx.markId)

    bus.emit(world, 'markRemove', {
      markId: ctx.markId,
      baseMarkId: mark.baseMarkId,
      ownerId,
    })

    return { success: true, state: 'completed', data }
  }
}
