// battle/src/v2/phases/selection.handler.ts
// Interactive phase — waits for player selections.
import type { PhaseHandler, PhaseDef, PhaseResult } from '@arcadia-eternity/engine'
import type { EventBus } from '@arcadia-eternity/engine'
import type { BattleWorld } from '../types/battle-world.js'
import type { BattleState } from '../types/battle-state.js'
import type { BattleSystems } from '../types/battle-systems.js'

export interface SelectionData {
  playerIds: string[]
  selections: Record<string, unknown>
  timeout?: number
}

export type SelectionHandlerData = SelectionData
export type SelectionHandlerType = 'selection'

export class SelectionHandler implements PhaseHandler<SelectionData, BattleState, BattleSystems> {
  readonly type = 'selection'

  initialize(_world: BattleWorld, phase: PhaseDef): SelectionData {
    const init = phase.data as Partial<SelectionData> | undefined
    return {
      playerIds: init?.playerIds ?? [],
      selections: {},
      timeout: init?.timeout,
    }
  }

  async execute(world: BattleWorld, phase: PhaseDef, bus: EventBus): Promise<PhaseResult> {
    const data = phase.data as SelectionData

    bus.emit(world, 'selectionStart', { playerIds: data.playerIds })

    phase.state = 'waiting'
    phase.waitingFor = {
      inputType: 'playerSelection',
      timeout: data.timeout,
    }

    return { success: true, state: 'waiting', data }
  }

  async resume(world: BattleWorld, phase: PhaseDef, bus: EventBus): Promise<PhaseResult> {
    const data = phase.data as SelectionData

    const allSelected = data.playerIds.every(id => id in data.selections)
    if (!allSelected) {
      return { success: true, state: 'waiting', data }
    }

    bus.emit(world, 'selectionComplete', { selections: data.selections })

    return { success: true, state: 'completed', data }
  }
}
