// battle/src/v2/phases/mark-cleanup.handler.ts
import type { PhaseHandler, PhaseDef, PhaseResult } from '@arcadia-eternity/engine'
import type { EventBus } from '@arcadia-eternity/engine'
import { queryByTag } from '@arcadia-eternity/engine'
import type { MarkSystem } from '../systems/mark.system.js'
import type { BattleState } from '../types/battle-state.js'
import type { BattleSystems } from '../types/battle-systems.js'
import type { BattleWorld } from '../types/battle-world.js'

export interface MarkCleanupPhaseData {
  removedMarkIds: string[]
}

export type MarkCleanupHandlerData = MarkCleanupPhaseData
export type MarkCleanupHandlerType = 'markCleanup'

export class MarkCleanupHandler implements PhaseHandler<MarkCleanupPhaseData, BattleState, BattleSystems> {
  readonly type = 'markCleanup'

  constructor(private markSystem: MarkSystem) {}

  initialize(world: BattleWorld, initData?: unknown): MarkCleanupPhaseData {
    void world
    void initData
    return { removedMarkIds: [] }
  }

  execute(world: BattleWorld, phase: PhaseDef, bus: EventBus): PhaseResult {
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
