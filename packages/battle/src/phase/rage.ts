import { EffectTrigger, BattleMessageType } from '@arcadia-eternity/const'
import { BattlePhaseBase } from './base'
import { RageContext } from '../context'
import type { Battle } from '../battle'
import type { Player } from '../player'

/**
 * RagePhase handles rage modification operations
 * Corresponds to RageContext and replaces rage modification logic
 */
export class RagePhase extends BattlePhaseBase<RageContext> {
  constructor(
    battle: Battle,
    private readonly parentContext: any, // UseSkillContext, EffectContext, or TurnContext
    private readonly target: Player,
    private readonly reason: 'turn' | 'damage' | 'skill' | 'skillHit' | 'switch' | 'effect',
    private readonly modifiedType: 'setting' | 'add' | 'reduce',
    private readonly value: number,
    private readonly ignoreRageObtainEfficiency: boolean = false,
    private readonly modified: [number, number] = [0, 0],
    id?: string,
  ) {
    super(battle, id)
  }

  protected createContext(): RageContext {
    return new RageContext(
      this.parentContext,
      this.target,
      this.reason,
      this.modifiedType,
      this.value,
      this.ignoreRageObtainEfficiency,
      this.modified,
    )
  }

  protected getEffectTriggers() {
    return {
      before: [],
      during: [EffectTrigger.OnRageGain, EffectTrigger.OnRageLoss],
      after: [],
    }
  }

  protected async executeOperation(): Promise<void> {
    const context = this._context!

    // Execute the rage operation logic (extracted from Player.addRage)
    await executeRageOperation(context, this.battle)
  }
}

/**
 * Extracted rage operation logic from Player.addRage
 * This function contains the core rage modification logic
 */
export async function executeRageOperation(context: RageContext, battle: Battle): Promise<void> {
  const before = context.target.currentRage

  switch (context.modifiedType) {
    case 'setting':
      context.target.settingRage(context.value)
      break
    case 'add':
      battle.applyEffects(context, EffectTrigger.OnRageGain)
      context.updateRageChangeResult()
      context.target.settingRage(context.target.currentRage + context.rageChangeResult)
      break
    case 'reduce':
      battle.applyEffects(context, EffectTrigger.OnRageLoss)
      context.updateRageChangeResult()
      context.target.settingRage(context.target.currentRage - context.rageChangeResult)
      break
  }

  battle.emitMessage(BattleMessageType.RageChange, {
    player: context.target.id,
    pet: context.target.activePet.id,
    before: before,
    after: context.target.currentRage,
    reason: context.reason,
  })
}
