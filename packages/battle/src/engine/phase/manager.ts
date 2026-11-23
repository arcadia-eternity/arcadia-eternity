import { getDamageEvaluation } from '../damageEvaluation'
import { EffectExecutionPhase } from './effectExecution'
import { type BattlePhaseBase, PhaseState, type PhaseResult, InteractivePhase } from './base'
import type { Battle } from '../battle'

/**
 * Phase execution options
 */
export interface PhaseExecutionOptions {
  timeout?: number
  retryCount?: number
  skipOnError?: boolean
}

function assertPermittedPhase(phase: BattlePhaseBase): void {
  if (getDamageEvaluation() && !(phase instanceof EffectExecutionPhase))
    throw new Error('Cannot start a state-changing phase during damage evaluation')
}

export class PhaseManager {
  private phases: Map<string, BattlePhaseBase> = new Map()
  private currentPhase?: BattlePhaseBase

  constructor(private readonly battle: Battle) {}

  /**
   * Register a phase for management
   */
  public registerPhase(phase: BattlePhaseBase): void {
    assertPermittedPhase(phase)
    if (this.phases.has(phase.id)) {
      throw new Error(`Phase with id ${phase.id} already registered`)
    }

    this.phases.set(phase.id, phase)
  }

  /**
   * Execute a specific phase synchronously (for regular phases only)
   */
  public executePhase(phaseId: string, options: PhaseExecutionOptions = {}): PhaseResult {
    this.battle.assertRunning()
    const phase = this.phases.get(phaseId)
    if (!phase) {
      throw new Error(`Phase ${phaseId} not found`)
    }
    assertPermittedPhase(phase)

    // Check if this is an interactive phase - these must use executePhaseAsync
    if (phase instanceof InteractivePhase) {
      throw new Error(`Interactive phase ${phaseId} must be executed with executePhaseAsync()`)
    }

    if (options.retryCount) throw new Error('Automatic phase retry requires a rollback boundary')
    if (options.timeout) throw new Error('Phase timeout requires a cooperative cancellation boundary')

    const previousPhase = this.currentPhase
    this.currentPhase = phase

    // Push phase to config system stack for level tracking
    const configSystem = this.battle.configSystem
    configSystem.pushPhase(phase)

    try {
      // Initialize phase if needed
      if (phase.state === PhaseState.Pending && !phase.context) {
        phase.initialize()
      }

      return phase.execute()
    } catch (error) {
      this.battle.executionBudget.assertActive()
      const errorResult: PhaseResult = {
        success: false,
        state: PhaseState.Failed,
        error: error instanceof Error ? error : new Error(String(error)),
      }

      if (!options.skipOnError) throw errorResult.error
      return errorResult
    } finally {
      // Always pop phase from stack when execution completes (success or failure)
      configSystem.popPhase(phase)
      this.battle.cleanupPhaseEffects(phase.id)
      if (phase.isFinished()) phase.cleanupConfigModifiers()
      this.currentPhase = previousPhase
    }
  }

  /**
   * Execute a specific phase asynchronously (supports both sync and async phases)
   */
  public async executePhaseAsync(phaseId: string, options: PhaseExecutionOptions = {}): Promise<PhaseResult> {
    this.battle.assertRunning()
    const phase = this.phases.get(phaseId)
    if (!phase) {
      throw new Error(`Phase ${phaseId} not found`)
    }
    assertPermittedPhase(phase)

    if (options.retryCount) throw new Error('Automatic phase retry requires a rollback boundary')
    if (options.timeout) throw new Error('Phase timeout requires a cooperative cancellation boundary')

    const previousPhase = this.currentPhase
    this.currentPhase = phase

    // Push phase to config system stack for level tracking
    const configSystem = this.battle.configSystem
    configSystem.pushPhase(phase)

    try {
      // Initialize phase if needed
      if (phase.state === PhaseState.Pending && !phase.context) {
        if (phase instanceof InteractivePhase) {
          await phase.initializeAsync()
        } else {
          phase.initialize()
        }
      }

      if (phase instanceof InteractivePhase) return await phase.executeAsync()
      return phase.execute()
    } catch (error) {
      this.battle.executionBudget.assertActive()
      const errorResult: PhaseResult = {
        success: false,
        state: PhaseState.Failed,
        error: error instanceof Error ? error : new Error(String(error)),
      }

      if (!options.skipOnError) throw errorResult.error
      return errorResult
    } finally {
      // Always pop phase from stack when execution completes (success or failure)
      configSystem.popPhase(phase)
      this.battle.cleanupPhaseEffects(phase.id)
      if (phase.isFinished()) phase.cleanupConfigModifiers()
      this.currentPhase = previousPhase
    }
  }

  /**
   * Cancel all phases
   */
  public async cancelAll(): Promise<void> {
    if (this.currentPhase) {
      if (this.currentPhase instanceof InteractivePhase) {
        await this.currentPhase.cancelAsync()
      } else {
        this.currentPhase.cancel()
      }
    }

    for (const phase of this.phases.values()) {
      if (!phase.isFinished()) {
        if (phase instanceof InteractivePhase) {
          await phase.cancelAsync()
        } else {
          phase.cancel()
        }
      }
    }

    this.currentPhase = undefined
  }

  /**
   * Cleanup all phases and reset manager state
   */
  public async cleanup(): Promise<void> {
    await this.cancelAll()

    for (const phase of this.phases.values()) {
      if (phase instanceof InteractivePhase) {
        await phase.cleanupAsync()
      } else {
        phase.cleanup()
      }
    }

    this.phases.clear()
  }

  /**
   * Get current executing phase
   */
  public getCurrentPhase(): BattlePhaseBase | undefined {
    return this.currentPhase
  }

  /**
   * Get phase by id
   */
  public getPhase(phaseId: string): BattlePhaseBase | undefined {
    return this.phases.get(phaseId)
  }

  /**
   * Check if a phase is registered
   */
  public hasPhase(phaseId: string): boolean {
    return this.phases.has(phaseId)
  }

  /**
   * Provide input to current interactive phase
   */
  public provideInput<T = any>(input: T): void {
    if (this.currentPhase instanceof InteractivePhase) {
      this.currentPhase.provideInput(input)
    }
  }

  /**
   * Get all registered phases
   */
  public getAllPhases(): BattlePhaseBase[] {
    return Array.from(this.phases.values())
  }

  /**
   * Get phases by state
   */
  public getPhasesByState(state: PhaseState): BattlePhaseBase[] {
    return Array.from(this.phases.values()).filter(phase => phase.state === state)
  }
}
