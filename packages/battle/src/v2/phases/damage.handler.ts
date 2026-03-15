// battle/src/v2/phases/damage.handler.ts
import type { PhaseHandler, PhaseDef, PhaseResult, World, EffectPipeline } from '@arcadia-eternity/engine'
import type { EventBus } from '@arcadia-eternity/engine'
import { EffectTrigger } from '@arcadia-eternity/const'
import { updateDamageResult, type DamageContext } from '@arcadia-eternity/plugin-damage'
import type { PetSystem } from '../systems/pet.system.js'
import type { MarkSystem } from '../systems/mark.system.js'
import type { DamageContextData } from '../schemas/context.schema.js'

export interface DamagePhaseData {
  context: DamageContextData
}

export class DamageHandler implements PhaseHandler<DamagePhaseData> {
  readonly type = 'damage'

  constructor(
    private petSystem: PetSystem,
    private markSystem: MarkSystem,
    private effectPipeline: EffectPipeline,
  ) {}

  initialize(_world: World, phase: PhaseDef): DamagePhaseData {
    return phase.data as DamagePhaseData
  }

  async execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult> {
    const data = phase.data as DamagePhaseData
    const ctx = data.context

    await this.effectPipeline.fire(world, EffectTrigger.OnBeforeCalculateDamage, {
      trigger: EffectTrigger.OnBeforeCalculateDamage,
      sourceEntityId: ctx.sourceId,
      context: ctx,
    })

    if (!ctx.available) {
      bus.emit(world, 'damageFail', {
        sourceId: ctx.sourceId,
        targetId: ctx.targetId,
        reason: 'disabled',
      })
      return { success: true, state: 'completed', data }
    }

    const damageCtx: DamageContext = {
      type: 'damage',
      sourceId: ctx.sourceId,
      targetId: ctx.targetId,
      baseDamage: ctx.baseDamage,
      damageType: ctx.damageType,
      modified: [...ctx.modified] as [number, number],
      damageResult: ctx.damageResult,
      available: ctx.available,
      crit: ctx.crit,
      effectiveness: ctx.effectiveness,
      randomFactor: ctx.randomFactor,
      minThreshold: ctx.minThreshold,
      maxThreshold: ctx.maxThreshold,
      extra: {},
    }

    updateDamageResult(damageCtx)
    ctx.damageResult = damageCtx.damageResult

    // Shield handling
    if (!ctx.ignoreShield) {
      await this.effectPipeline.fire(world, EffectTrigger.Shield, {
        trigger: EffectTrigger.Shield,
        sourceEntityId: ctx.targetId,
        context: ctx,
      })

      const shields = this.markSystem.getShieldMarks(world, ctx.targetId)
      for (const shield of shields) {
        if (ctx.damageResult <= 0) break
        const consumed = this.markSystem.consumeStack(world, shield.id, ctx.damageResult)
        ctx.damageResult -= consumed
      }
      ctx.damageResult = Math.max(0, ctx.damageResult)
    }

    const currentHp = this.petSystem.getCurrentHp(world, ctx.targetId)
    const newHp = Math.max(0, currentHp - ctx.damageResult)
    this.petSystem.setCurrentHp(world, ctx.targetId, newHp)

    await this.effectPipeline.fire(world, EffectTrigger.OnDamage, {
      trigger: EffectTrigger.OnDamage,
      sourceEntityId: ctx.sourceId,
      context: ctx,
      targetId: ctx.targetId,
      damage: ctx.damageResult,
    })

    bus.emit(world, 'damage', {
      sourceId: ctx.sourceId,
      targetId: ctx.targetId,
      damage: ctx.damageResult,
      isCrit: ctx.crit,
      effectiveness: ctx.effectiveness,
      damageType: ctx.damageType,
      currentHp: newHp,
      maxHp: this.petSystem.getStatValue(world, ctx.targetId, 'maxHp'),
    })

    await this.effectPipeline.fire(world, EffectTrigger.PostDamage, {
      trigger: EffectTrigger.PostDamage,
      sourceEntityId: ctx.sourceId,
      context: ctx,
    })

    if (ctx.crit) {
      await this.effectPipeline.fire(world, EffectTrigger.OnCritPostDamage, {
        trigger: EffectTrigger.OnCritPostDamage,
        sourceEntityId: ctx.sourceId,
        context: ctx,
      })
    }

    return { success: true, state: 'completed', data }
  }
}
