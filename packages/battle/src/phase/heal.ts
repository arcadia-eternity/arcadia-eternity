import { EffectTrigger, BattleMessageType } from '@arcadia-eternity/const'
import { SynchronousPhase } from './base'
import { HealContext } from '../context'
import type { Battle } from '../battle'
import type { Pet } from '../pet'
import type { MarkInstance } from '../mark'
import type { SkillInstance } from '../skill'

/**
 * HealPhase handles healing operations
 * Corresponds to HealContext and replaces healing logic
 */
export class HealPhase extends SynchronousPhase<HealContext> {
  constructor(
    battle: Battle,
    private readonly parentContext: any, // EffectContext
    private readonly source: MarkInstance | SkillInstance,
    private readonly target: Pet,
    private readonly value: number,
    private readonly ignoreEffect: boolean = false,
    private readonly modified: [number, number] = [0, 0],
    id?: string,
  ) {
    super(battle, id)
  }

  protected createContext(): HealContext {
    return new HealContext(this.parentContext, this.source, this.target, this.value, this.ignoreEffect, this.modified)
  }

  protected getEffectTriggers() {
    return {
      before: [], // OnBeforeHeal is handled in executeOperation
      during: [], // OnHeal is handled in executeOperation
      after: [],
    }
  }

  protected executeOperation(): void {
    const context = this._context!

    // Execute the heal operation logic (extracted from Pet.heal)
    executeHealOperation(context, this.battle)
  }
}

/**
 * Extracted heal operation logic from Pet.heal
 * This function contains the core healing logic
 */
export function executeHealOperation(context: HealContext, battle: Battle): void {
  // Apply OnBeforeHeal effects to modify healing value
  battle.applyEffects(context, EffectTrigger.OnBeforeHeal)
  context.updateHealResult()

  if (!context.available) {
    battle.emitMessage(BattleMessageType.HealFail, {
      target: context.target.id,
      reason: 'disabled',
    })
    return
  }

  if (!context.target.isActive || context.target.currentHp <= 0) {
    battle.emitMessage(BattleMessageType.HealFail, {
      target: context.target.id,
      reason: 'disactivated',
    })
    return
  }

  // Apply healing
  const newHp = Math.floor(Math.min(context.target.stat.maxHp!, context.target.currentHp + context.healResult))
  context.target.currentHp = newHp

  battle.emitMessage(BattleMessageType.Heal, {
    target: context.target.id,
    amount: context.healResult,
    source: 'effect',
  })

  // Apply OnHeal effects after healing is applied
  battle.applyEffects(context, EffectTrigger.OnHeal)
}
