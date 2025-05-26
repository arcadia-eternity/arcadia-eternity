import { EffectTrigger } from '@arcadia-eternity/const'
import { Context, type TriggerContextMap } from '../context'
import type { Battle } from '../battle'
import { ConfigSystem, ConfigModifier, ConfigDurationType, ConfigModifierType, type ConfigValue } from '../config'

/**
 * Phase execution state
 */
export enum PhaseState {
  Pending = 'pending',
  Initializing = 'initializing',
  Executing = 'executing',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

/**
 * Phase execution result
 */
export interface PhaseResult {
  success: boolean
  state: PhaseState
  error?: Error
  data?: any
}

/**
 * Interface establishing Phase-Context relationship
 */
export interface PhaseContext<TContext extends Context = Context> {
  context: TContext
  phase: BattlePhaseBase<TContext>
}

/**
 * Abstract base class for all battle phases
 * Implements the core lifecycle and integration with the existing effect system
 */
export abstract class BattlePhaseBase<TContext extends Context = Context> {
  public state: PhaseState = PhaseState.Pending
  public result?: PhaseResult
  protected _context?: TContext
  private configModifierCleanups: (() => void)[] = []

  constructor(
    public readonly battle: Battle,
    public readonly id: string = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  ) {}

  /**
   * Get the context associated with this phase
   */
  get context(): TContext | undefined {
    return this._context
  }

  /**
   * Abstract method to create the context for this phase
   */
  protected abstract createContext(): TContext

  /**
   * Abstract method to execute the core operation logic
   */
  protected abstract executeOperation(): Promise<void> | void

  /**
   * Get the effect triggers that should be applied during this phase
   */
  protected abstract getEffectTriggers(): {
    before?: EffectTrigger[]
    during?: EffectTrigger[]
    after?: EffectTrigger[]
  }

  /**
   * Initialize the phase - create context and prepare for execution
   */
  public async initialize(): Promise<void> {
    if (this.state !== PhaseState.Pending) {
      throw new Error(`Cannot initialize phase in state: ${this.state}`)
    }

    this.state = PhaseState.Initializing

    try {
      this._context = this.createContext()
      await this.onInitialize()
      this.state = PhaseState.Pending // Ready for execution
    } catch (error) {
      this.state = PhaseState.Failed
      this.result = {
        success: false,
        state: this.state,
        error: error instanceof Error ? error : new Error(String(error)),
      }
      throw error
    }
  }

  /**
   * Execute the phase
   */
  public async execute(): Promise<PhaseResult> {
    if (this.state !== PhaseState.Pending) {
      throw new Error(`Cannot execute phase in state: ${this.state}`)
    }

    if (!this._context) {
      throw new Error('Phase not initialized - context is missing')
    }

    this.state = PhaseState.Executing

    try {
      // Apply before effects
      await this.applyEffects('before')

      // Execute the core operation
      await this.executeOperation()

      // Apply after effects
      await this.applyEffects('after')

      this.state = PhaseState.Completed
      this.result = {
        success: true,
        state: this.state,
      }

      await this.onComplete()

      return this.result
    } catch (error) {
      this.state = PhaseState.Failed
      this.result = {
        success: false,
        state: this.state,
        error: error instanceof Error ? error : new Error(String(error)),
      }

      await this.onError(this.result.error!)
      throw error
    }
  }

  /**
   * Cancel the phase execution
   */
  public async cancel(): Promise<void> {
    if (this.state === PhaseState.Completed || this.state === PhaseState.Failed) {
      return // Already finished
    }

    this.state = PhaseState.Cancelled
    this.result = {
      success: false,
      state: this.state,
    }

    await this.onCancel()
  }

  /**
   * Cleanup phase resources
   */
  public async cleanup(): Promise<void> {
    // Cleanup all config modifiers
    this.cleanupConfigModifiers()

    await this.onCleanup()
    this._context = undefined
  }

  /**
   * Add a config modifier that will be automatically cleaned up when the phase ends
   */
  public addConfigModifier(
    configKey: string,
    modifierType: ConfigModifierType,
    value: ConfigValue,
    priority: number = 0,
  ): void {
    const configSystem = ConfigSystem.getInstance()

    // Create a unique modifier ID
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 11)
    const modifierId = `${this.id}_config_${configKey}_${modifierType}_${timestamp}_${random}`

    // Create the config modifier
    const modifier = new ConfigModifier(ConfigDurationType.phase, modifierId, value, modifierType, priority, this)

    // Add the modifier to the config system
    const cleanup = configSystem.addConfigModifier(configKey, modifier)
    this.configModifierCleanups.push(cleanup)
  }

  /**
   * Add a dynamic config modifier with Observable value
   */
  public addDynamicConfigModifier(
    configKey: string,
    modifierType: ConfigModifierType,
    observableValue: any, // Observable<ConfigValue>
    priority: number = 0,
  ): void {
    const configSystem = ConfigSystem.getInstance()

    // Create a unique modifier ID
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 11)
    const modifierId = `${this.id}_config_${configKey}_${modifierType}_dynamic_${timestamp}_${random}`

    // Create the config modifier with Observable value
    const modifier = new ConfigModifier(
      ConfigDurationType.phase,
      modifierId,
      observableValue,
      modifierType,
      priority,
      this,
    )

    // Add the modifier to the config system
    const cleanup = configSystem.addConfigModifier(configKey, modifier)
    this.configModifierCleanups.push(cleanup)
  }

  /**
   * Cleanup all config modifiers associated with this phase
   */
  private cleanupConfigModifiers(): void {
    this.configModifierCleanups.forEach(cleanup => cleanup())
    this.configModifierCleanups.length = 0
  }

  /**
   * Apply effects for the given stage
   */
  protected async applyEffects(stage: 'before' | 'during' | 'after'): Promise<void> {
    if (!this._context) return

    const triggers = this.getEffectTriggers()
    const stageTriggers = triggers[stage]

    if (stageTriggers) {
      for (const trigger of stageTriggers) {
        this.battle.applyEffects(this._context as any, trigger)
      }
    }
  }

  // Lifecycle hooks - can be overridden by subclasses
  protected async onInitialize(): Promise<void> {}
  protected async onComplete(): Promise<void> {}
  protected async onError(error: Error): Promise<void> {}
  protected async onCancel(): Promise<void> {}
  protected async onCleanup(): Promise<void> {}

  /**
   * Check if the phase can be executed
   */
  public canExecute(): boolean {
    return this.state === PhaseState.Pending && this._context !== undefined
  }

  /**
   * Check if the phase is finished (completed, failed, or cancelled)
   */
  public isFinished(): boolean {
    return [PhaseState.Completed, PhaseState.Failed, PhaseState.Cancelled].includes(this.state)
  }

  /**
   * Get a string representation of the phase for debugging
   */
  public toString(): string {
    return `${this.constructor.name}[${this.id}](${this.state})`
  }
}

/**
 * Base class for phases that need to wait for external input (like player selections)
 */
export abstract class InteractivePhase<TContext extends Context = Context> extends BattlePhaseBase<TContext> {
  protected waitingForInput: boolean = false
  protected inputResolver?: (value: any) => void
  protected inputRejecter?: (reason: any) => void

  /**
   * Wait for external input
   */
  protected async waitForInput<T = any>(): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waitingForInput = true
      this.inputResolver = resolve
      this.inputRejecter = reject
    })
  }

  /**
   * Provide input to resolve waiting
   */
  public provideInput<T = any>(input: T): void {
    if (this.waitingForInput && this.inputResolver) {
      this.waitingForInput = false
      this.inputResolver(input)
      this.inputResolver = undefined
      this.inputRejecter = undefined
    }
  }

  /**
   * Reject waiting input
   */
  public rejectInput(reason: any): void {
    if (this.waitingForInput && this.inputRejecter) {
      this.waitingForInput = false
      this.inputRejecter(reason)
      this.inputResolver = undefined
      this.inputRejecter = undefined
    }
  }

  public override async cancel(): Promise<void> {
    if (this.waitingForInput) {
      this.rejectInput(new Error('Phase cancelled'))
    }
    await super.cancel()
  }
}
