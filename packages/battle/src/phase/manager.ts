import { BattlePhaseBase, PhaseState, type PhaseResult, InteractivePhase } from './base'
import type { Battle } from '../battle'

/**
 * Phase execution options
 */
export interface PhaseExecutionOptions {
  timeout?: number
  retryCount?: number
  skipOnError?: boolean
}

/**
 * Phase dependency definition
 */
export interface PhaseDependency {
  phaseId: string
  required: boolean
}

/**
 * PhaseManager handles the complete lifecycle of battle phases
 * Manages phase creation, execution, dependencies, and cleanup
 */
export class PhaseManager {
  private phases: Map<string, BattlePhaseBase> = new Map()
  private executionQueue: string[] = []
  private dependencies: Map<string, PhaseDependency[]> = new Map()
  private executionHistory: string[] = []
  private currentPhase?: BattlePhaseBase
  private isExecuting: boolean = false

  constructor(private readonly battle: Battle) {}

  /**
   * Register a phase for management
   */
  public registerPhase(phase: BattlePhaseBase, dependencies: PhaseDependency[] = []): void {
    if (this.phases.has(phase.id)) {
      throw new Error(`Phase with id ${phase.id} already registered`)
    }

    this.phases.set(phase.id, phase)
    if (dependencies.length > 0) {
      this.dependencies.set(phase.id, dependencies)
    }
  }

  /**
   * Queue a phase for execution
   */
  public queuePhase(phaseId: string): void {
    if (!this.phases.has(phaseId)) {
      throw new Error(`Phase ${phaseId} not registered`)
    }

    if (!this.executionQueue.includes(phaseId)) {
      this.executionQueue.push(phaseId)
    }
  }

  /**
   * Execute all queued phases in order
   */
  public async executeQueuedPhases(options: PhaseExecutionOptions = {}): Promise<PhaseResult[]> {
    if (this.isExecuting) {
      throw new Error('PhaseManager is already executing phases')
    }

    this.isExecuting = true
    const results: PhaseResult[] = []

    try {
      while (this.executionQueue.length > 0) {
        const phaseId = this.executionQueue.shift()!
        const result = await this.executePhase(phaseId, options)
        results.push(result)

        // Stop execution if phase failed and skipOnError is false
        if (!result.success && !options.skipOnError) {
          break
        }
      }
    } finally {
      this.isExecuting = false
      this.currentPhase = undefined
    }

    return results
  }

  /**
   * Execute a specific phase
   */
  public async executePhase(phaseId: string, options: PhaseExecutionOptions = {}): Promise<PhaseResult> {
    const phase = this.phases.get(phaseId)
    if (!phase) {
      throw new Error(`Phase ${phaseId} not found`)
    }

    // Check dependencies
    await this.checkDependencies(phaseId)

    this.currentPhase = phase

    try {
      // Initialize phase if needed
      if (phase.state === PhaseState.Pending && !phase.context) {
        await phase.initialize()
      }

      // Execute with timeout if specified
      let result: PhaseResult
      if (options.timeout) {
        result = await this.executeWithTimeout(phase, options.timeout)
      } else {
        result = await phase.execute()
      }

      this.executionHistory.push(phaseId)
      return result
    } catch (error) {
      const errorResult: PhaseResult = {
        success: false,
        state: PhaseState.Failed,
        error: error instanceof Error ? error : new Error(String(error)),
      }

      // Retry logic
      if (options.retryCount && options.retryCount > 0) {
        console.warn(`Phase ${phaseId} failed, retrying... (${options.retryCount} attempts left)`)
        return this.executePhase(phaseId, { ...options, retryCount: options.retryCount - 1 })
      }

      return errorResult
    }
  }

  /**
   * Execute phase with timeout
   */
  private async executeWithTimeout(phase: BattlePhaseBase, timeout: number): Promise<PhaseResult> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        phase.cancel().then(() => {
          reject(new Error(`Phase ${phase.id} timed out after ${timeout}ms`))
        })
      }, timeout)

      phase
        .execute()
        .then(result => {
          clearTimeout(timeoutId)
          resolve(result)
        })
        .catch(error => {
          clearTimeout(timeoutId)
          reject(error)
        })
    })
  }

  /**
   * Check if all dependencies for a phase are satisfied
   */
  private async checkDependencies(phaseId: string): Promise<void> {
    const deps = this.dependencies.get(phaseId)
    if (!deps) return

    for (const dep of deps) {
      const depPhase = this.phases.get(dep.phaseId)

      if (!depPhase) {
        if (dep.required) {
          throw new Error(`Required dependency ${dep.phaseId} not found for phase ${phaseId}`)
        }
        continue
      }

      if (dep.required && !this.executionHistory.includes(dep.phaseId)) {
        throw new Error(`Required dependency ${dep.phaseId} not executed for phase ${phaseId}`)
      }

      if (depPhase.state === PhaseState.Failed && dep.required) {
        throw new Error(`Required dependency ${dep.phaseId} failed for phase ${phaseId}`)
      }
    }
  }

  /**
   * Cancel all phases
   */
  public async cancelAll(): Promise<void> {
    this.executionQueue.length = 0

    if (this.currentPhase) {
      await this.currentPhase.cancel()
    }

    for (const phase of this.phases.values()) {
      if (!phase.isFinished()) {
        await phase.cancel()
      }
    }

    this.isExecuting = false
    this.currentPhase = undefined
  }

  /**
   * Cleanup all phases and reset manager state
   */
  public async cleanup(): Promise<void> {
    await this.cancelAll()

    for (const phase of this.phases.values()) {
      await phase.cleanup()
    }

    this.phases.clear()
    this.dependencies.clear()
    this.executionHistory.length = 0
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
   * Get execution history
   */
  public getExecutionHistory(): string[] {
    return [...this.executionHistory]
  }

  /**
   * Check if manager is currently executing phases
   */
  public isCurrentlyExecuting(): boolean {
    return this.isExecuting
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
