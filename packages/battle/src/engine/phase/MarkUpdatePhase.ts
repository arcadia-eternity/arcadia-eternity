import { calculateSkillDamage, makeSkillDamageContext, type DeferredDamage } from './skill'
import { DamagePhase } from './damage'
import { EffectTrigger, BattleMessageType } from '@arcadia-eternity/const'
import type { Battle } from '../battle'
import { EffectContext, RemoveMarkContext, type TurnContext } from '../context'
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
      if (pending) this.resolveDeferredDamage(context, pending)
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

  private resolveDeferredDamage(turn: TurnContext, pending: DeferredDamage): void {
    const holder = this.mark
    if (!holder.isActive || holder.isSuppressed) return
    const battle = turn.battle
    const attacker = battle.petMap.get(pending.origin.petId)
    const skill = battle.skillMap.get(pending.origin.skillInstanceId)
    const side = [battle.playerA, battle.playerB].find(player => player.id === pending.target.playerId)
    if (!attacker || !skill || !side) return
    if (pending.sourcePolicy !== 'any' && (!attacker.isAlive || attacker.currentHp <= 0)) return
    if (pending.sourcePolicy === 'active' && attacker.owner?.activePet !== attacker) return

    const target = side.activePet
    const formula = pending.formula
    const power =
      formula.capturedPower ?? (skill.baseId === pending.origin.skillId ? skill.power : formula.definitionPower)
    const crit = formula.sureCrit || battle.random() * 100 < attacker.stat.critRate
    const hit = calculateSkillDamage(battle, attacker, target, {
      ...formula,
      power,
      crit,
      stabMultiplier: 1.5,
      critMultiplier: 2,
    })
    const expiry = new EffectContext(turn, EffectTrigger.OnMarkDurationEnd, holder)
    const event = makeSkillDamageContext(
      expiry,
      skill,
      target,
      { ...hit, crit, element: formula.element, ignoreShield: formula.ignoreShield },
      {
        ...pending.origin,
        skillCategory: formula.category,
        skillElement: formula.element,
        skillTags: formula.tags,
        hitCount: 1,
        executorId: holder.id,
        holderId: holder.id,
        trigger: 'deferred',
        causeId: pending.id,
      },
    )
    battle.phaseManager.run(new DamagePhase(event))
  }
}
