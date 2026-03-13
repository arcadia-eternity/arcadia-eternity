// engine/src/phase.ts
// Phase scheduler — manages the lifecycle of game phases.
//
// The engine defines the state machine and execution framework.
// Game layers register PhaseHandlers for specific phase types.

import type { World } from './world.js'
import type { EventBus } from './events.js'
import { generateId } from './world.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PhaseState =
  | 'pending'
  | 'initializing'
  | 'executing'
  | 'waiting'      // waiting for user interaction, can be persisted
  | 'completed'
  | 'failed'
  | 'cancelled'

/**
 * Serializable phase definition — pure data.
 */
export interface PhaseDef {
  id: string
  type: string
  state: PhaseState
  data: unknown
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

export type PhaseExecutionObserver = (
  world: World,
  event: PhaseExecutionEvent,
) => void | Promise<void>

/**
 * Game layers implement PhaseHandler for each phase type.
 */
export interface PhaseHandler<TData = unknown> {
  type: string
  /** Create initial data for this phase */
  initialize(world: World, phase: PhaseDef): TData
  /** Execute the phase logic */
  execute(world: World, phase: PhaseDef, bus: EventBus): PhaseResult | Promise<PhaseResult>
  /** Optional: resume from persisted waiting state */
  resume?(world: World, phase: PhaseDef, bus: EventBus): PhaseResult | Promise<PhaseResult>
  /** Optional: cleanup when phase completes or is cancelled */
  cleanup?(world: World, phase: PhaseDef): void
}

// ---------------------------------------------------------------------------
// PhaseManager
// ---------------------------------------------------------------------------

export class PhaseManager {
  private handlers = new Map<string, PhaseHandler>()
  private executionObservers = new Set<PhaseExecutionObserver>()

  /**
   * Register a phase handler for a given type.
   */
  register(handler: PhaseHandler): void {
    if (this.handlers.has(handler.type)) {
      throw new Error(`PhaseHandler for type '${handler.type}' already registered`)
    }
    this.handlers.set(handler.type, handler)
  }

  /**
   * Get a registered handler.
   */
  getHandler(type: string): PhaseHandler | undefined {
    return this.handlers.get(type)
  }

  /**
   * Check if a handler is registered.
   */
  hasHandler(type: string): boolean {
    return this.handlers.has(type)
  }

  onExecutionEvent(observer: PhaseExecutionObserver): () => void {
    this.executionObservers.add(observer)
    return () => {
      this.executionObservers.delete(observer)
    }
  }

  /**
   * Create a new phase definition and push it onto the world's phase stack.
   */
  createPhase(world: World, type: string, initData?: unknown): PhaseDef {
    const handler = this.handlers.get(type)
    if (!handler) {
      throw new Error(`No PhaseHandler registered for type '${type}'`)
    }

    const phase: PhaseDef = {
      id: generateId(type),
      type,
      state: 'pending',
      data: initData ?? null,
    }

    // Initialize phase data via handler
    phase.state = 'initializing'
    phase.data = handler.initialize(world, phase)
    phase.state = 'pending'

    return phase
  }

  /**
   * Execute a phase. Pushes it onto the stack, runs the handler,
   * and pops it when done.
   */
  async execute(
    world: World,
    phaseType: string,
    bus: EventBus,
    initData?: unknown,
  ): Promise<PhaseResult> {
    const phase = this.createPhase(world, phaseType, initData)
    return this.executePhase(world, phase, bus)
  }

  /**
   * Execute an already-created phase definition.
   */
  async executePhase(
    world: World,
    phase: PhaseDef,
    bus: EventBus,
  ): Promise<PhaseResult> {
    const handler = this.handlers.get(phase.type)
    if (!handler) {
      return { success: false, state: 'failed', error: `No handler for '${phase.type}'` }
    }

    // Push onto stack
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
      phase.data = result.data ?? phase.data
      await this.emitExecutionEvent(world, {
        transition: 'commit',
        phase,
        stackDepth: world.phaseStack.length,
      })
      return result
    } catch (err) {
      phase.state = 'failed'
      const error = err instanceof Error ? err.message : String(err)
      await this.emitExecutionEvent(world, {
        transition: 'fail',
        phase,
        stackDepth: world.phaseStack.length,
        error,
      })
      return { success: false, state: 'failed', error }
    } finally {
      // Pop from stack
      const idx = world.phaseStack.lastIndexOf(phase)
      if (idx !== -1) {
        world.phaseStack.splice(idx, 1)
      }
      // Cleanup
      handler.cleanup?.(world, phase)
    }
  }

  /**
   * Resume a phase that was in 'waiting' state (e.g. after deserialization).
   */
  async resumePhase(
    world: World,
    phase: PhaseDef,
    bus: EventBus,
  ): Promise<PhaseResult> {
    if (phase.state !== 'waiting') {
      return { success: false, state: 'failed', error: `Cannot resume phase in state '${phase.state}'` }
    }

    const handler = this.handlers.get(phase.type)
    if (!handler) {
      return { success: false, state: 'failed', error: `No handler for '${phase.type}'` }
    }

    if (!handler.resume) {
      return { success: false, state: 'failed', error: `Handler '${phase.type}' does not support resume` }
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
      phase.data = result.data ?? phase.data
      await this.emitExecutionEvent(world, {
        transition: 'commit',
        phase,
        stackDepth: world.phaseStack.length,
      })
      return result
    } catch (err) {
      phase.state = 'failed'
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

  /**
   * Mark a phase as waiting for input.
   */
  setWaiting(phase: PhaseDef, inputType: string, playerId?: string, timeout?: number): void {
    phase.state = 'waiting'
    phase.waitingFor = { inputType, playerId, timeout }
  }

  /**
   * Get the current active phase types from the world's phase stack.
   * Useful for PhaseContext in attribute evaluation.
   */
  getActivePhaseTypes(world: World): Set<string> {
    const types = new Set<string>()
    for (const phase of world.phaseStack) {
      if (phase.state === 'executing' || phase.state === 'waiting') {
        types.add(phase.type)
      }
    }
    return types
  }

  /**
   * Get current phase IDs by type from the world's phase stack.
   */
  getCurrentPhaseIds(world: World): Map<string, string> {
    const ids = new Map<string, string>()
    // Last one wins (most recent phase of each type)
    for (const phase of world.phaseStack) {
      if (phase.state === 'executing' || phase.state === 'waiting') {
        ids.set(phase.type, phase.id)
      }
    }
    return ids
  }

  /**
   * Build a PhaseContext for attribute evaluation from the current world state.
   */
  buildPhaseContext(world: World): import('./attribute.js').PhaseContext {
    return {
      activePhaseTypes: this.getActivePhaseTypes(world),
      currentPhaseIds: this.getCurrentPhaseIds(world),
    }
  }

  private async emitExecutionEvent(world: World, event: PhaseExecutionEvent): Promise<void> {
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
