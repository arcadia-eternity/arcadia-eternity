// battle/src/v2/phases/heal.handler.ts
import type { PhaseHandler, PhaseDef, PhaseResult, EffectPipeline } from '@arcadia-eternity/engine'
import type { EventBus } from '@arcadia-eternity/engine'
import { EffectTrigger } from '@arcadia-eternity/const'
import type { PetSystem } from '../systems/pet.system.js'
import type { HealContextData } from '../schemas/context.schema.js'
import type { BattleWorld } from '../types/battle-world.js'
import type { BattleState } from '../types/battle-state.js'
import type { BattleSystems } from '../types/battle-systems.js'
import { Phase } from '../phase-symbols.js'

export interface HealPhaseData {
  context: HealContextData
}

export type HealHandlerData = HealPhaseData
export type HealHandlerType = symbol

export class HealHandler implements PhaseHandler<HealPhaseData, BattleState, BattleSystems> {
  readonly type = Phase.heal

  constructor(
    private petSystem: PetSystem,
    private effectPipeline: EffectPipeline,
  ) {}

  initialize(_world: BattleWorld, initData?: unknown): HealPhaseData {
    return (initData ?? {}) as HealPhaseData
  }

  async execute(world: BattleWorld, phase: PhaseDef, bus: EventBus): Promise<PhaseResult> {
    const data = phase.data as HealPhaseData
    const ctx = data.context

    if (!ctx.available) {
      return { success: true, state: 'completed', data }
    }

    // Defeated pets cannot receive healing unless revive semantics are introduced explicitly.
    if (!this.petSystem.isAlive(world, ctx.targetId)) {
      ctx.healResult = 0
      return { success: true, state: 'completed', data }
    }

    await this.effectPipeline.fire(world, EffectTrigger.OnBeforeHeal, {
      trigger: EffectTrigger.OnBeforeHeal,
      sourceEntityId: ctx.sourceId,
      context: ctx,
    })

    if (!ctx.available) {
      return { success: true, state: 'completed', data }
    }

    const percentMod = 1 + ctx.modified[0] / 100
    const deltaMod = ctx.modified[1]
    ctx.healResult = Math.floor(Math.max(0, ctx.baseHeal * percentMod + deltaMod))

    const currentHp = this.petSystem.getCurrentHp(world, ctx.targetId)
    const maxHp = this.petSystem.getStatValue(world, ctx.targetId, 'maxHp')
    const newHp = Math.min(currentHp + ctx.healResult, maxHp)
    const actualHeal = newHp - currentHp
    this.petSystem.setCurrentHp(world, ctx.targetId, newHp)

    bus.emit(world, 'heal', {
      sourceId: ctx.sourceId,
      targetId: ctx.targetId,
      heal: actualHeal,
      currentHp: newHp,
      maxHp,
    })

    await this.effectPipeline.fire(world, EffectTrigger.OnHeal, {
      trigger: EffectTrigger.OnHeal,
      sourceEntityId: ctx.sourceId,
      context: ctx,
      actualHeal,
    })

    return { success: true, state: 'completed', data }
  }
}
