// battle/src/v2/phases/stat-stage.handler.ts
import type { PhaseHandler, PhaseDef, PhaseResult } from '@arcadia-eternity/engine'
import type { EventBus } from '@arcadia-eternity/engine'
import type { StatStageMarkSystem, CleanStageStrategy } from '../systems/stat-stage-mark.system.js'
import type { BattleState } from '../types/battle-state.js'
import type { BattleSystems } from '../types/battle-systems.js'
import type { BattleWorld } from '../types/battle-world.js'

export type StatStageOperation = 'add' | 'set' | 'clear' | 'reverse' | 'transfer'

export interface StatStagePhaseData {
  operation?: StatStageOperation
  entityId: string
  stat?: string
  delta?: number
  value?: number
  stats?: string[]
  cleanStageStrategy?: CleanStageStrategy
  sourceEntityId?: string
  targetEntityId?: string
}

export type StatStageHandlerData = StatStagePhaseData
export type StatStageHandlerType = 'statStage'

export class StatStageHandler implements PhaseHandler<StatStagePhaseData, BattleState, BattleSystems> {
  readonly type = 'statStage'

  constructor(private statStageSystem: StatStageMarkSystem) {}

  initialize(_world: BattleWorld, initData?: unknown): StatStagePhaseData {
    return (initData ?? {}) as StatStagePhaseData
  }

  execute(world: BattleWorld, phase: PhaseDef, bus: EventBus): PhaseResult {
    const data = phase.data as StatStagePhaseData
    const operation = data.operation ?? 'add'

    switch (operation) {
      case 'add':
        return this.executeAdd(world, data, bus)
      case 'set':
        return this.executeSet(world, data, bus)
      case 'clear':
        return this.executeClear(world, data, bus)
      case 'reverse':
        return this.executeReverse(world, data, bus)
      case 'transfer':
        return this.executeTransfer(world, data, bus)
      default:
        return { success: false, state: 'completed', data }
    }
  }

  private executeAdd(world: BattleWorld, data: StatStagePhaseData, bus: EventBus): PhaseResult {
    if (!data.stat || data.delta === undefined) {
      return { success: false, state: 'completed', data }
    }

    const actualDelta = this.statStageSystem.applyStage(world, data.entityId, data.stat, data.delta)
    const newStage = this.statStageSystem.getStage(world, data.entityId, data.stat)

    bus.emit(world, 'statStageChange', {
      entityId: data.entityId,
      stat: data.stat,
      delta: actualDelta,
      newStage,
    })

    return { success: true, state: 'completed', data: { ...data, actualDelta } }
  }

  private executeSet(world: BattleWorld, data: StatStagePhaseData, bus: EventBus): PhaseResult {
    if (!data.stat || data.value === undefined) {
      return { success: false, state: 'completed', data }
    }

    this.statStageSystem.setStage(world, data.entityId, data.stat, data.value)
    const newStage = this.statStageSystem.getStage(world, data.entityId, data.stat)

    bus.emit(world, 'statStageChange', {
      entityId: data.entityId,
      stat: data.stat,
      delta: 0,
      newStage,
    })

    return { success: true, state: 'completed', data }
  }

  private executeClear(world: BattleWorld, data: StatStagePhaseData, bus: EventBus): PhaseResult {
    const strategy = data.cleanStageStrategy ?? 'all'
    const stats = data.stats ?? this.statStageSystem.getTrackedStats(world, data.entityId)
    this.statStageSystem.clearStages(world, data.entityId, strategy, stats)

    bus.emit(world, 'statStageCleared', {
      entityId: data.entityId,
      stats,
      strategy,
    })

    return { success: true, state: 'completed', data }
  }

  private executeReverse(world: BattleWorld, data: StatStagePhaseData, bus: EventBus): PhaseResult {
    const strategy = data.cleanStageStrategy ?? 'all'
    const stats = data.stats ?? this.statStageSystem.getTrackedStats(world, data.entityId)
    this.statStageSystem.reverseStages(world, data.entityId, strategy, stats)

    bus.emit(world, 'statStageReversed', {
      entityId: data.entityId,
      stats,
      strategy,
    })

    return { success: true, state: 'completed', data }
  }

  private executeTransfer(world: BattleWorld, data: StatStagePhaseData, bus: EventBus): PhaseResult {
    if (!data.sourceEntityId || !data.targetEntityId) {
      return { success: false, state: 'completed', data }
    }

    const strategy = data.cleanStageStrategy ?? 'negative'
    const stats = data.stats ?? this.statStageSystem.getTrackedStats(world, data.sourceEntityId)
    const moved = this.statStageSystem.transferStages(world, data.sourceEntityId, data.targetEntityId, strategy, stats)

    for (const { stat, stage } of moved) {
      bus.emit(world, 'statStageTransferred', {
        sourceEntityId: data.sourceEntityId,
        targetEntityId: data.targetEntityId,
        stat,
        stage,
      })
    }

    return { success: true, state: 'completed', data }
  }
}
