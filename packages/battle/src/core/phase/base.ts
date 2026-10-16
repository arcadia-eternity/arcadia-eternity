import { ConfigModifier, ConfigDurationType, ConfigModifierType } from '../config.js'
import type { ConfigValue, ValueInput } from '../values.js'
import type { ContextNode } from '../context.js'

export enum PhaseState {
  Pending = 'pending',
  Ready = 'ready',
  Executing = 'executing',
  Waiting = 'waiting',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
}
export type PhaseResult<R> = { state: PhaseState.Completed; value: R } | { state: PhaseState.Waiting }
/** Runtime phase. Its context is a real typed parent graph, not a save DTO. */
export abstract class BattlePhaseBase<C extends ContextNode, R = void> {
  abstract readonly kind: string
  private configCounter = 0
  id: string | null = null
  parentPhaseId: string | null = null
  state = PhaseState.Pending
  constructor(readonly context: C) {}
  get battle() {
    return this.context.battle
  }
  initialize() {
    if (this.state !== PhaseState.Pending) throw new Error('Phase can only initialize once')
    this.onInitialize()
    this.state = PhaseState.Ready
  }
  execute(): PhaseResult<R> {
    if (this.state !== PhaseState.Ready && this.state !== PhaseState.Waiting) throw new Error('Phase is not ready')
    if (this.waiting()) {
      this.state = PhaseState.Waiting
      return { state: PhaseState.Waiting }
    }
    this.state = PhaseState.Executing
    try {
      const value = this.executeOperation()
      this.state = PhaseState.Completed
      this.onComplete()
      return { state: PhaseState.Completed, value }
    } catch (error) {
      this.state = PhaseState.Failed
      this.onError(error)
      throw error
    }
  }
  addConfigModifier(key: string, type: ConfigModifierType, value: ValueInput<ConfigValue>, priority = 0): () => void {
    if (!this.id) throw new Error('Config modifier requires an executing phase')
    return this.battle.configSystem.addConfigModifier(
      key,
      new ConfigModifier(
        ConfigDurationType.phase,
        `${this.id}/config/${this.configCounter++}`,
        value,
        type,
        priority,
        this,
      ),
    )
  }
  addDynamicConfigModifier(key: string, type: ConfigModifierType, value: ValueInput<ConfigValue>, priority = 0) {
    return this.addConfigModifier(key, type, value, priority)
  }
  cancel() {
    if ([PhaseState.Pending, PhaseState.Ready, PhaseState.Waiting].includes(this.state)) {
      this.state = PhaseState.Cancelled
      this.onCancel()
    }
  }
  cleanup() {
    this.onCleanup()
  }
  protected waiting(): boolean {
    return false
  }
  protected abstract executeOperation(): R
  protected onInitialize(): void {}
  protected onComplete(): void {}
  protected onError(_error: unknown): void {}
  protected onCancel(): void {}
  protected onCleanup(): void {}
}
export abstract class SynchronousPhase<C extends ContextNode, R = void> extends BattlePhaseBase<C, R> {}
/** Waiting is explicit; the Host supplies input and resumes, never a saved Promise/resolver. */
export abstract class InteractivePhase<C extends ContextNode, R = void> extends BattlePhaseBase<C, R> {
  protected abstract hasInput(): boolean
  protected waiting() {
    return !this.hasInput()
  }
}
