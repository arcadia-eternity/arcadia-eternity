import { getDamageEvaluation } from './damage'
import { EffectExecutionPhase } from './effectExecution'
import { type BattlePhaseBase, PhaseState, type PhaseResult, InteractivePhase } from './base'
import type { Battle } from '../battle'

function assertPermittedPhase(phase: BattlePhaseBase): void {
  if (getDamageEvaluation() && !(phase instanceof EffectExecutionPhase))
    throw new Error('Cannot start a state-changing phase during damage evaluation')
}

export class PhaseManager {
  private phases: Map<string, BattlePhaseBase> = new Map()
  private currentPhase?: BattlePhaseBase

  constructor(private readonly battle: Battle) {}

  public run(phase: BattlePhaseBase): PhaseResult {
    if (phase instanceof InteractivePhase) throw new Error('Interactive phases require runAsync()')
    const previous = this.enter(phase)
    try {
      if (!phase.context) phase.initialize()
      return phase.execute()
    } catch (error) {
      this.battle.executionBudget.assertActive()
      throw error instanceof Error ? error : new Error(String(error))
    } finally {
      this.leave(phase, previous)
    }
  }

  public async runAsync(phase: BattlePhaseBase): Promise<PhaseResult> {
    if (!(phase instanceof InteractivePhase)) return this.run(phase)
    const previous = this.enter(phase)
    try {
      if (!phase.context) await phase.initializeAsync()
      return await phase.executeAsync()
    } catch (error) {
      this.battle.executionBudget.assertActive()
      throw error instanceof Error ? error : new Error(String(error))
    } finally {
      this.leave(phase, previous)
    }
  }

  private enter(phase: BattlePhaseBase): BattlePhaseBase | undefined {
    this.battle.assertRunning()
    assertPermittedPhase(phase)
    if (phase.battle !== this.battle) throw new Error('Phase belongs to another battle')
    if (this.phases.has(phase.id)) throw new Error(`Phase ${phase.id} already registered`)
    const previous = this.currentPhase
    this.phases.set(phase.id, phase)
    this.currentPhase = phase
    this.battle.configSystem.pushPhase(phase)
    return previous
  }

  private leave(phase: BattlePhaseBase, previous: BattlePhaseBase | undefined): void {
    this.battle.configSystem.popPhase(phase)
    this.battle.cleanupPhaseEffects(phase.id)
    if (phase.isFinished()) phase.cleanupConfigModifiers()
    this.currentPhase = previous
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
