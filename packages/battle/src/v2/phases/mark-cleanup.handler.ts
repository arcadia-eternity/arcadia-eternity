// battle/src/v2/phases/mark-cleanup.handler.ts
import type { PhaseHandler, PhaseDef, PhaseResult, World } from '@arcadia-eternity/engine'
import type { EventBus } from '@arcadia-eternity/engine'
import { queryByTag } from '@arcadia-eternity/engine'
import type { MarkSystem } from '../systems/mark.system.js'

export interface MarkCleanupPhaseData {
  removedMarkIds: string[]
}

export class MarkCleanupHandler implements PhaseHandler<MarkCleanupPhaseData> {
  readonly type = 'markCleanup'

  constructor(private markSystem: MarkSystem) {}

  initialize(_world: World, _phase: PhaseDef): MarkCleanupPhaseData {
    return { removedMarkIds: [] }
  }

  execute(world: World, phase: PhaseDef, bus: EventBus): PhaseResult {
    const data = phase.data as MarkCleanupPhaseData

    const markIds = queryByTag(world, 'mark')
    for (const markId of markIds) {
      const mark = this.markSystem.get(world, markId)
      if (mark && !this.markSystem.isActive(world, markId)) {
        data.removedMarkIds.push(markId)
        this.markSystem.destroy(world, markId)
      }
    }

    if (data.removedMarkIds.length > 0) {
      bus.emit(world, 'markCleanup', { removedMarkIds: data.removedMarkIds })
    }

    return { success: true, state: 'completed', data }
  }
}
