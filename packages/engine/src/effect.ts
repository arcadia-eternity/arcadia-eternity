// engine/src/effect.ts
// Effect pipeline — trigger → condition → operator framework.
//
// EffectDef[] is stored as a component on entities.
// EffectPipeline is a class that operates on these components.

import type { World } from './world.js'
import { getComponent, setComponent, queryByComponent } from './world.js'

// ---------------------------------------------------------------------------
// Component name
// ---------------------------------------------------------------------------

export const EFFECTS = 'effects' as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EffectDef {
  id: string
  triggers: string[]
  priority: number
  condition?: unknown
  apply: unknown
  consumesStacks?: number
  tags?: string[]
}

export interface EffectInterpreter {
  evaluateCondition(world: World, condition: unknown, context: unknown): boolean
  executeOperator(world: World, operator: unknown, context: unknown): Promise<void>
}

export interface EffectPipelineHooks {
  beforeEffectExecute?: (world: World, effect: EffectDef, context: EffectFireContext) => boolean
  afterEffectExecute?: (world: World, effect: EffectDef, context: EffectFireContext) => void | Promise<void>
}

export interface EffectFireContext {
  trigger: string
  sourceEntityId: string
  triggerSourceEntityId?: string
  effectEntityId?: string
  effectId?: string
  available?: boolean
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// EffectPipeline
// ---------------------------------------------------------------------------

export class EffectPipeline {
  constructor(
    private interpreter: EffectInterpreter,
    private hooks: EffectPipelineHooks = {},
  ) {}

  setInterpreter(interpreter: EffectInterpreter): void {
    this.interpreter = interpreter
  }

  /** Attach an effect to an entity (adds to its effects component). */
  attachEffect(world: World, entityId: string, effect: EffectDef): void {
    const effects = getComponent<EffectDef[]>(world, entityId, EFFECTS) ?? []
    effects.push(effect)
    setComponent(world, entityId, EFFECTS, effects)
  }

  /** Detach an effect from an entity by effect ID. */
  detachEffect(world: World, entityId: string, effectId: string): boolean {
    const effects = getComponent<EffectDef[]>(world, entityId, EFFECTS)
    if (!effects) return false
    const idx = effects.findIndex(e => e.id === effectId)
    if (idx === -1) return false
    effects.splice(idx, 1)
    return true
  }

  /** Detach all effects from an entity. */
  detachAllEffects(world: World, entityId: string): void {
    setComponent(world, entityId, EFFECTS, [])
  }

  /** Get all effects on an entity. */
  getEffects(world: World, entityId: string): EffectDef[] {
    return getComponent<EffectDef[]>(world, entityId, EFFECTS) ?? []
  }

  /** Get effects for a specific trigger on an entity. */
  getEffectsForTrigger(world: World, entityId: string, trigger: string): EffectDef[] {
    return this.getEffects(world, entityId).filter(e => e.triggers.includes(trigger))
  }

  /**
   * Fire a trigger: collect matching effects, evaluate conditions, execute operators.
   * @param entityIds — entities to scan. If omitted, scans all entities with effects.
   */
  async fire(world: World, trigger: string, context: EffectFireContext, entityIds?: string[]): Promise<void> {
    const ids = entityIds ?? queryByComponent(world, EFFECTS)

    const candidates: { entityId: string; effect: EffectDef }[] = []
    for (const eid of ids) {
      for (const effect of this.getEffects(world, eid)) {
        if (effect.triggers.includes(trigger)) {
          candidates.push({ entityId: eid, effect })
        }
      }
    }

    candidates.sort((a, b) => b.effect.priority - a.effect.priority)

    for (const { entityId, effect } of candidates) {
      const triggerSourceEntityId =
        typeof context.triggerSourceEntityId === 'string'
          ? context.triggerSourceEntityId
          : context.sourceEntityId
      const effectContext: EffectFireContext = trigger === 'BeforeEffect' ? context : { ...context }
      effectContext.triggerSourceEntityId = triggerSourceEntityId
      effectContext.sourceEntityId = entityId
      effectContext.effectEntityId = entityId
      effectContext.effectId = effect.id

      // v1-compatible hook: BeforeEffect can disable current effect execution.
      // Avoid recursion by not re-firing when current trigger itself is BeforeEffect.
      if (trigger !== 'BeforeEffect') {
        const beforeEffectContext: EffectFireContext = {
          ...effectContext,
          trigger: 'BeforeEffect',
          triggerSourceEntityId: entityId,
          sourceEntityId: entityId,
          effectEntityId: entityId,
          effectId: effect.id,
          effect,
          available: true,
        }
        await this.fire(world, 'BeforeEffect', beforeEffectContext, ids)
        if (beforeEffectContext.available === false) continue
      }

      if (this.hooks.beforeEffectExecute && !this.hooks.beforeEffectExecute(world, effect, effectContext)) continue
      if (effect.condition !== undefined) {
        if (!this.interpreter.evaluateCondition(world, effect.condition, effectContext)) continue
      }
      await this.interpreter.executeOperator(world, effect.apply, effectContext)
      if (trigger === 'BeforeEffect' && typeof effectContext.available === 'boolean') {
        context.available = effectContext.available
      }
      if (this.hooks.afterEffectExecute) await this.hooks.afterEffectExecute(world, effect, effectContext)
    }
  }

  /** Fire a trigger for a single entity. */
  async fireForEntity(world: World, entityId: string, trigger: string, context: EffectFireContext): Promise<void> {
    await this.fire(world, trigger, context, [entityId])
  }
}
