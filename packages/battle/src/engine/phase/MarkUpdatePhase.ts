import { resolveDeferredDamage } from '../deferredDamage'
import { EffectTrigger, BattleMessageType } from '@arcadia-eternity/const'
import type { Battle } from '../battle'
import { RemoveMarkContext, type TurnContext } from '../context'
import type { MarkInstance } from '../mark'
import { Pet } from '../pet'
import { SynchronousPhase } from './base'

export class MarkUpdatePhase extends SynchronousPhase<TurnContext> {
  constructor(
    battle: Battle,
    turnContext: TurnContext,
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
    const mark = this.mark
    const battle = this.battle

    if (!mark.isActive) return
    if (mark.config.persistent) return

    mark.duration--
    const expired = mark.duration <= 0

    if (expired) {
      const pending = mark.deferredDamage
      mark.deferredDamage = undefined
      if (pending) resolveDeferredDamage(context, mark, pending)
      battle.applyEffects(context, EffectTrigger.OnMarkDurationEnd, mark)
      battle.emitMessage(BattleMessageType.MarkExpire, {
        mark: mark.id,
        target: mark.owner instanceof Pet ? mark.owner.id : 'battle',
      })
      battle.removeMark(new RemoveMarkContext(context, mark))
      return
    }

    battle.emitMessage(BattleMessageType.MarkUpdate, {
      target: mark.owner instanceof Pet ? mark.owner.id : 'battle',
      mark: mark.toMessage(),
    })
  }
}
