// battle/src/v2/phases/mark-update.handler.ts
import type { PhaseHandler, PhaseDef, PhaseResult, World, EffectPipeline } from '@arcadia-eternity/engine'
import type { EventBus } from '@arcadia-eternity/engine'
import { EffectTrigger } from '@arcadia-eternity/const'
import type { MarkSystem } from '../systems/mark.system.js'

export interface MarkUpdatePhaseData {
  markId: string
}

export class MarkUpdateHandler implements PhaseHandler<MarkUpdatePhaseData> {
  readonly type = 'markUpdate'

  constructor(
    private markSystem: MarkSystem,
    private effectPipeline: EffectPipeline,
  ) {}

  initialize(_world: World, phase: PhaseDef): MarkUpdatePhaseData {
    return phase.data as MarkUpdatePhaseData
  }

  async execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult> {
    const data = phase.data as MarkUpdatePhaseData
    const mark = this.markSystem.get(world, data.markId)

    if (!mark || !this.markSystem.isActive(world, data.markId)) {
      return { success: true, state: 'completed', data }
    }

    // v1 semantics: persistent marks never tick/expire.
    if (this.markSystem.getConfig(world, data.markId).persistent) {
      return { success: true, state: 'completed', data }
    }

    const newDuration = this.markSystem.decrementDuration(world, data.markId)

    if (newDuration > 0) {
      bus.emit(world, 'markUpdate', {
        markId: data.markId,
        baseMarkId: mark.baseMarkId,
        ownerId: mark.ownerId,
        duration: newDuration,
        stack: this.markSystem.getStack(world, data.markId),
      })
    } else {
      await this.effectPipeline.fire(world, EffectTrigger.OnMarkDurationEnd, {
        trigger: EffectTrigger.OnMarkDurationEnd,
        sourceEntityId: data.markId,
        markId: data.markId,
        baseMarkId: mark.baseMarkId,
      }, [data.markId])

      bus.emit(world, 'markExpire', {
        markId: data.markId,
        baseMarkId: mark.baseMarkId,
        ownerId: mark.ownerId,
      })
    }

    return { success: true, state: 'completed', data }
  }
}
