import { EffectTrigger } from '@arcadia-eternity/const'
import { BattlePhaseBase } from './base'
import { AddMarkContext, RemoveMarkContext } from '../context'
import type { Battle } from '../battle'
import type { MarkOwner } from '../entity'
import type { BaseMark, MarkInstance } from '../mark'

/**
 * AddMarkPhase handles mark addition operations
 * Corresponds to AddMarkContext and replaces mark addition logic
 */
export class AddMarkPhase extends BattlePhaseBase<AddMarkContext> {
  constructor(
    battle: Battle,
    private readonly parentContext: any, // EffectContext
    private readonly target: MarkOwner,
    private readonly baseMark: BaseMark,
    private readonly stack?: number,
    private readonly duration?: number,
    private readonly config?: Partial<MarkInstance['config']>,
    id?: string,
  ) {
    super(battle, id)
  }

  protected createContext(): AddMarkContext {
    return new AddMarkContext(this.parentContext, this.target, this.baseMark, this.stack, this.duration, this.config)
  }

  protected getEffectTriggers() {
    return {
      before: [],
      during: [], // Mark system handles its own effects
      after: [],
    }
  }

  protected async executeOperation(): Promise<void> {
    const context = this._context!

    // Execute the add mark operation logic
    await executeAddMarkOperation(context, this.battle)
  }
}

/**
 * RemoveMarkPhase handles mark removal operations
 * Corresponds to RemoveMarkContext and replaces mark removal logic
 */
export class RemoveMarkPhase extends BattlePhaseBase<RemoveMarkContext> {
  constructor(
    battle: Battle,
    private readonly parentContext: any, // EffectContext, DamageContext, AddMarkContext, or TurnContext
    private readonly mark: MarkInstance,
    id?: string,
  ) {
    super(battle, id)
  }

  protected createContext(): RemoveMarkContext {
    return new RemoveMarkContext(this.parentContext, this.mark)
  }

  protected getEffectTriggers() {
    return {
      before: [],
      during: [], // Mark system handles its own effects
      after: [],
    }
  }

  protected async executeOperation(): Promise<void> {
    const context = this._context!

    // Execute the remove mark operation logic
    await executeRemoveMarkOperation(context, this.battle)
  }
}

/**
 * Extracted add mark operation logic
 * This function contains the core mark addition logic
 */
export async function executeAddMarkOperation(context: AddMarkContext, battle: Battle): Promise<void> {
  battle.markSystem.addMark(context.target as any, context)
}

/**
 * Extracted remove mark operation logic
 * This function contains the core mark removal logic
 */
export async function executeRemoveMarkOperation(context: RemoveMarkContext, battle: Battle): Promise<void> {
  if (context.mark.owner) {
    battle.markSystem.removeMark(context.mark.owner as any, context)
  }
}
