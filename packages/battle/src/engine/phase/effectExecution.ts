import { EffectTrigger, BattleMessageType } from '@arcadia-eternity/const'
import { SynchronousPhase } from './base'
import { DamageContext, EffectContext, type TriggerContextMap } from '../context'
import type { Battle } from '../battle'
import { Effect, type EffectContainer } from '../effect'

import { damageRuleId, isReplacementTrigger, runReplacementSample } from '../replacementSampling'
import { evaluationSavepoint, getDamageEvaluation, runDamageAuthor } from '../damageEvaluation'
import { createChildLogger } from '../logger'

export class EffectExecutionPhase<T extends EffectTrigger> extends SynchronousPhase<TriggerContextMap[T]> {
  constructor(
    battle: Battle,
    parentContext: TriggerContextMap[T],
    private readonly trigger: T,
    private readonly effectContainers: EffectContainer[],
    id?: string,
  ) {
    super(battle, id)
    this._context = parentContext
  }

  protected createContext(): TriggerContextMap[T] {
    return this._context!
  }

  protected executeOperation(): void {
    const parentContext = this._context!
    const trigger = this.trigger
    const effectContainers = this.effectContainers
    const battle = this.battle

    const logger = createChildLogger('EffectExecution')

    const effectQueue = collectEffectsFromContainers(trigger, parentContext, effectContainers)
    effectQueue.sort((a, b) => b.effect.priority - a.effect.priority)

    for (const { effect, context } of effectQueue) {
      // Apply BeforeEffect effects
      runReplacementSample(context, 'before', () => battle.applyEffects(context, EffectTrigger.BeforeEffect))

      if (!context.available) {
        battle.emitMessage(BattleMessageType.EffectApplyFail, {
          source: context.source.id,
          effect: effect.id,
          reason: 'disabled',
        })
        continue
      }

      // Emit effect apply message
      battle.emitMessage(BattleMessageType.EffectApply, {
        source: context.source.id,
        effect: effect.id,
      })

      try {
        // Execute the effect
        effect.innerApply(context)
        context.success = true

        // Apply AfterEffect effects
        runReplacementSample(context, 'after', () => battle.applyEffects(context, EffectTrigger.AfterEffect))
      } catch (error) {
        battle.executionBudget.assertActive()
        logger.error(`Effect Error ${effect.id}:`, error)
        context.success = false

        battle.emitMessage(BattleMessageType.EffectApplyFail, {
          source: context.source.id,
          effect: effect.id,
          reason: 'disabled',
        })
      }
    }
  }
}

/**
 * Helper function to collect effects from containers
 * This replaces the direct effect collection logic
 */
function collectEffectsFromContainers<T extends EffectTrigger>(
  trigger: T,
  parentContext: TriggerContextMap[T],
  effectContainers: EffectContainer[],
): Array<{
  effect: Effect<EffectTrigger>
  context: EffectContext<EffectTrigger>
}> {
  const effects: Array<{
    effect: Effect<EffectTrigger>
    context: EffectContext<EffectTrigger>
  }> = []

  const addedEffects = new Set<string>()

  effectContainers.forEach(container => {
    if ('isActive' in container && (!container.isActive || ('isSuppressed' in container && container.isSuppressed)))
      return
    if ('effects' in container && Array.isArray((container as any).effects)) {
      const containerEffects = container.getEffects ? container.getEffects(trigger) : container.effects

      containerEffects
        .filter(effect => effect.triggers.includes(trigger))
        .forEach(effect => {
          const effectContext = new EffectContext(parentContext, trigger, container as any, effect)

          if (
            isReplacementTrigger(trigger) &&
            parentContext instanceof DamageContext &&
            parentContext.resolution.applied.has(damageRuleId(effectContext))
          )
            return

          try {
            if (effect.condition && !matchesCondition(effectContext, effect.condition)) return
            const effectKey = `${(container as any).id || 'unknown'}_${effect.id}_${container.constructor.name}`

            if (!addedEffects.has(effectKey)) {
              addedEffects.add(effectKey)
              effects.push({ effect, context: effectContext })
            }
          } catch (err) {
            parentContext.battle.executionBudget.assertActive()
            console.error('Error in effect condition:', err)
          }
        })
    }
  })

  return effects
}

function matchesCondition(
  context: EffectContext<EffectTrigger>,
  predicate: (context: EffectContext<EffectTrigger>) => boolean,
): boolean {
  const evaluation = getDamageEvaluation()
  if (!evaluation) return predicate(context)
  // A native predicate can see the proposal. Only its return value survives candidate discovery.
  const rollback = evaluationSavepoint(evaluation, context.parent)
  try {
    return runDamageAuthor(undefined, () => runReplacementSample(context, 'when', () => predicate(context)))
  } finally {
    rollback()
  }
}
