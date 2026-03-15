// battle/src/v2/phases/selection.handler.ts
// Interactive phase — waits for player selections.
import type { PhaseHandler, PhaseDef, PhaseResult, World } from '@arcadia-eternity/engine'
import type { EventBus } from '@arcadia-eternity/engine'

export interface SelectionData {
  playerIds: string[]
  selections: Record<string, unknown>
  timeout?: number
}

export class SelectionHandler implements PhaseHandler<SelectionData> {
  readonly type = 'selection'

  initialize(_world: World, phase: PhaseDef): SelectionData {
    const init = phase.data as Partial<SelectionData> | undefined
    return {
      playerIds: init?.playerIds ?? [],
      selections: {},
      timeout: init?.timeout,
    }
  }

  async execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult> {
    const data = phase.data as SelectionData

    bus.emit(world, 'selectionStart', { playerIds: data.playerIds })

    phase.state = 'waiting'
    phase.waitingFor = {
      inputType: 'playerSelection',
      timeout: data.timeout,
    }

    return { success: true, state: 'waiting', data }
  }

  async resume(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult> {
    const data = phase.data as SelectionData

    const allSelected = data.playerIds.every(id => id in data.selections)
    if (!allSelected) {
      return { success: true, state: 'waiting', data }
    }

    bus.emit(world, 'selectionComplete', { selections: data.selections })

    return { success: true, state: 'completed', data }
  }
}
