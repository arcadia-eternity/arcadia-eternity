import { EffectTrigger, BattleMessageType } from '@arcadia-eternity/const'
import type { Battle } from '../battle'
import type { TurnContext } from '../context'
import type { MarkInstance } from '../mark'
import { Pet } from '../pet'
import { SynchronousPhase } from '../phase'
import { RemoveMarkPhase } from './removeMark'

/**
 * MarkUpdatePhase handles mark update operations
 * Replaces MarkInstance.update logic with proper phase-based execution
 */

export class MarkUpdatePhase extends SynchronousPhase<TurnContext> {
  constructor(
    battle: Battle,
    private readonly turnContext: TurnContext,
    private readonly mark: MarkInstance,
    id?: string,
  ) {
    super(battle, id)
    this._context = turnContext
  }

  protected createContext(): TurnContext {
    return this._context!
  }

  protected executeOperation(): void {
    const context = this._context!

    // Execute the mark update operation logic
    executeMarkUpdateOperation(context, this.mark, this.battle)
  }
}
/**
 * Extracted mark update operation logic
 * This function contains the core mark update logic, replacing MarkInstance.update
 */

export function executeMarkUpdateOperation(context: TurnContext, mark: MarkInstance, battle: Battle): boolean {
  if (!mark.isActive) return true
  if (mark.config.persistent) return false

  mark.duration--
  const expired = mark.duration <= 0

  if (expired) {
    battle.applyEffects(context, EffectTrigger.OnMarkDurationEnd, mark)
    battle.emitMessage(BattleMessageType.MarkExpire, {
      mark: mark.id,
      target: mark.owner instanceof Pet ? mark.owner.id : 'battle',
    })
    const removePhase = new RemoveMarkPhase(battle, context, mark)
    battle.phaseManager.registerPhase(removePhase)
    battle.phaseManager.executePhase(removePhase.id)
    return expired
  }

  battle.emitMessage(BattleMessageType.MarkUpdate, {
    target: mark.owner instanceof Pet ? mark.owner.id : 'battle',
    mark: mark.toMessage(),
  })

  return expired
}
