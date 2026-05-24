// engine/src/phase.ts
// Phase scheduler — manages the lifecycle of game phases.
//
// The engine defines the state machine and execution framework.
// Game layers register PhaseHandlers for specific phase types.

import type { World, WorldState, WorldSystems, WorldPlugins } from './world.js'
import type { EventBus } from './events.js'
import { generateId } from './world.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PhaseState =
  | 'pending'
  | 'initializing'
  | 'executing'
  | 'waiting' // waiting for user interaction, can be persisted
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface PhaseDef<TData = unknown> {
  id: string
  type: symbol
  state: PhaseState
  data: TData
  waitingFor?: {
    inputType: string
    playerId?: string
    timeout?: number
  }
}

export interface PhaseResult {
  success: boolean
  state: PhaseState
  error?: string
  data?: unknown
}

export type PhaseExecutionTransition = 'begin' | 'commit' | 'fail'

export interface PhaseExecutionEvent {
  transition: PhaseExecutionTransition
  phase: PhaseDef
  stackDepth: number
  error?: string
}

export type PhaseExecutionObserver = (world: World, event: PhaseExecutionEvent) => void | Promise<void>

export interface PhaseHandler<
  TData = unknown,
  TState extends WorldState = WorldState,
  TSystems extends WorldSystems = WorldSystems,
  TPlugins extends WorldPlugins = WorldPlugins,
> {
  readonly type: symbol
  initialize(world: World<TState, TSystems, TPlugins>, initData?: unknown): TData
  execute(
    world: World<TState, TSystems, TPlugins>,
    phase: PhaseDef<TData>,
    bus: EventBus,
  ): PhaseResult | Promise<PhaseResult>
  resume?(
    world: World<TState, TSystems, TPlugins>,
    phase: PhaseDef<TData>,
    bus: EventBus,
  ): PhaseResult | Promise<PhaseResult>
  cleanup?(world: World<TState, TSystems, TPlugins>, phase: PhaseDef<TData>): void
}

// ---------------------------------------------------------------------------
// PhaseManager
// ---------------------------------------------------------------------------

export class PhaseManager<
  TState extends WorldState = WorldState,
  TSystems extends WorldSystems = WorldSystems,
  TPlugins extends WorldPlugins = WorldPlugins,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  TRegistry extends Record<symbol, unknown> = Record<symbol, unknown>,
> {
  private handlers = new Map<symbol, PhaseHandler<unknown, TState, TSystems, TPlugins>>()
  private executionObservers = new Set<PhaseExecutionObserver>()

  register<THandler extends PhaseHandler<unknown, TState, TSystems, TPlugins>>(handler: THandler): void {
    this.handlers.set(handler.type, handler)
  }

  getHandler(type: symbol): PhaseHandler<unknown, TState, TSystems, TPlugins> | undefined {
    return this.handlers.get(type)
  }

  onExecutionEvent(observer: PhaseExecutionObserver): () => void {
    this.executionObservers.add(observer)
    return () => {
      this.executionObservers.delete(observer)
    }
  }

  createPhase<TData>(
    _world: World<TState, TSystems, TPlugins>,
    handler: PhaseHandler<TData, TState, TSystems, TPlugins>,
    initData?: unknown,
  ): PhaseDef<TData> {
    const data = handler.initialize(_world, initData)
    const typeKey = Symbol.keyFor(handler.type) ?? 'unknown'
    return {
      id: generateId(typeKey),
      type: handler.type,
      state: 'pending',
      data,
    }
  }

  async execute<TData>(
    world: World<TState, TSystems, TPlugins>,
    handler: PhaseHandler<TData, TState, TSystems, TPlugins>,
    bus: EventBus,
    initData?: unknown,
  ): Promise<PhaseResult>
  async execute(
    world: World<TState, TSystems, TPlugins>,
    type: symbol,
    bus: EventBus,
    initData?: unknown,
  ): Promise<PhaseResult>
  async execute<TData>(
    world: World<TState, TSystems, TPlugins>,
    handlerOrType: PhaseHandler<TData, TState, TSystems, TPlugins> | symbol,
    bus: EventBus,
    initData?: unknown,
  ): Promise<PhaseResult> {
    const handler = typeof handlerOrType === 'symbol' ? this.handlers.get(handlerOrType) : handlerOrType
    if (!handler) {
      const label =
        typeof handlerOrType === 'symbol'
          ? (Symbol.keyFor(handlerOrType) ?? String(handlerOrType))
          : (handlerOrType.type.description ?? String(handlerOrType.type))
      throw new Error(`Unknown phase handler: ${label}`)
    }
    const phase = this.createPhase(world, handler, initData)
    return this.executePhase(world, handler, phase, bus)
  }

  async executePhase<TData>(
    world: World<TState, TSystems, TPlugins>,
    handler: PhaseHandler<TData, TState, TSystems, TPlugins>,
    phase: PhaseDef<TData>,
    bus: EventBus,
  ): Promise<PhaseResult> {
    world.phaseStack.push(phase)
    phase.state = 'executing'
    await this.emitExecutionEvent(world, {
      transition: 'begin',
      phase,
      stackDepth: world.phaseStack.length,
    })

    try {
      const result = await handler.execute(world, phase, bus)
      phase.state = result.state
      if (result.data !== undefined) {
        phase.data = result.data as TData
      }
      await this.emitExecutionEvent(world, {
        transition: 'commit',
        phase,
        stackDepth: world.phaseStack.length,
      })
      return result
    } catch (err) {
      phase.state = 'failed'
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const error = err instanceof Error ? err.message : String(err)
      await this.emitExecutionEvent(world, {
        transition: 'fail',
        phase,
        stackDepth: world.phaseStack.length,
        error,
      })
      return { success: false, state: 'failed', error }
    } finally {
      const idx = world.phaseStack.lastIndexOf(phase)
      if (idx !== -1) {
        world.phaseStack.splice(idx, 1)
      }
      handler.cleanup?.(world, phase)
    }
  }

  async resumePhase<TData>(
    world: World<TState, TSystems, TPlugins>,
    handler: PhaseHandler<TData, TState, TSystems, TPlugins>,
    phase: PhaseDef<TData>,
    bus: EventBus,
  ): Promise<PhaseResult> {
    if (phase.state !== 'waiting') {
      return { success: false, state: 'failed', error: `Cannot resume phase in state '${phase.state}'` }
    }
    if (!handler.resume) {
      const label = Symbol.keyFor(handler.type) ?? String(handler.type)
      return { success: false, state: 'failed', error: `Handler '${label}' does not support resume` }
    }

    world.phaseStack.push(phase)
    phase.state = 'executing'
    await this.emitExecutionEvent(world, {
      transition: 'begin',
      phase,
      stackDepth: world.phaseStack.length,
    })

    try {
      const result = await handler.resume(world, phase, bus)
      phase.state = result.state
      if (result.data !== undefined) {
        phase.data = result.data as TData
      }
      await this.emitExecutionEvent(world, {
        transition: 'commit',
        phase,
        stackDepth: world.phaseStack.length,
      })
      return result
    } catch (err) {
      phase.state = 'failed'
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const error = err instanceof Error ? err.message : String(err)
      await this.emitExecutionEvent(world, {
        transition: 'fail',
        phase,
        stackDepth: world.phaseStack.length,
        error,
      })
      return { success: false, state: 'failed', error }
    } finally {
      const idx = world.phaseStack.lastIndexOf(phase)
      if (idx !== -1) {
        world.phaseStack.splice(idx, 1)
      }
      handler.cleanup?.(world, phase)
    }
  }

  setWaiting(phase: PhaseDef, inputType: string, playerId?: string, timeout?: number): void {
    phase.state = 'waiting'
    phase.waitingFor = { inputType, playerId, timeout }
  }

  getActivePhaseTypes(world: World<TState, TSystems, TPlugins>): Set<symbol> {
    const types = new Set<symbol>()
    for (const phase of world.phaseStack) {
      if (phase.state === 'executing' || phase.state === 'waiting') {
        types.add(phase.type)
      }
    }
    return types
  }

  getCurrentPhaseIds(world: World<TState, TSystems, TPlugins>): Map<symbol, string> {
    const ids = new Map<symbol, string>()
    for (const phase of world.phaseStack) {
      if (phase.state === 'executing' || phase.state === 'waiting') {
        ids.set(phase.type, phase.id)
      }
    }
    return ids
  }

  buildPhaseContext(world: World<TState, TSystems, TPlugins>): import('./attribute.js').PhaseContext {
    return {
      activePhaseTypes: this.getActivePhaseTypes(world),
      currentPhaseIds: this.getCurrentPhaseIds(world),
    }
  }

  private async emitExecutionEvent(
    world: World<TState, TSystems, TPlugins>,
    event: PhaseExecutionEvent,
  ): Promise<void> {
    if (this.executionObservers.size === 0) return
    for (const observer of this.executionObservers) {
      try {
        await observer(world, event)
      } catch {
        // Observer failures must not break phase execution.
      }
    }
  }
}
