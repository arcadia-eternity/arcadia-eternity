import { EffectTrigger } from '@arcadia-eternity/const'
import { EffectContext, UseSkillContext, type TriggerContextMap } from '../context.js'
import type { TrustedEffect } from '../effects.js'
import type { EffectReference } from '../content.js'
import { Mark } from '../mark.js'
import type { Skill } from '../skill.js'
import { copyData } from '../data.js'
import { SynchronousPhase } from './base.js'

export class EffectPhase<T extends EffectTrigger> extends SynchronousPhase<EffectContext<T>> {
  readonly kind = 'effect'
  constructor(
    context: EffectContext<T>,
    readonly definition: TrustedEffect,
  ) {
    super(context)
  }
  protected executeOperation() {
    const context = this.context
    if (!context.available) return
    const result: unknown = this.definition.execute(context)
    if (result !== undefined) throw new Error('Trusted effects must execute synchronously and return void')
    context.success = true
  }
}
/** Typed source collection/dispatch seam; official effects/templates remain #205/#223. */
export class EffectExecutionPhase<T extends EffectTrigger> extends SynchronousPhase<TriggerContextMap[T]> {
  readonly kind = 'effect-execution'
  constructor(
    parent: TriggerContextMap[NoInfer<T>],
    readonly trigger: T,
    readonly only?: readonly Mark[],
  ) {
    super(parent)
  }
  protected executeOperation() {
    const battle = this.battle
    battle.emitEvent('trigger', { trigger: this.trigger })
    const sources: readonly (Skill | Mark)[] = this.only ?? [
      ...battle.getActiveMarks(),
      ...(this.context instanceof UseSkillContext ? [this.context.skill] : []),
    ]
    const calls = sources
      .flatMap(source => source.base.effects.map(ref => ({ source, ref, definition: battle.registry.resolve(ref) })))
      .filter(call => call.definition.triggers.includes(this.trigger))
      .sort((a, b) => (b.definition.priority ?? 0) - (a.definition.priority ?? 0))
    for (const { source, ref, definition } of calls) {
      if (source instanceof Mark && !source.isActive && this.trigger !== EffectTrigger.OnMarkDestroy) continue
      this.executeEffect(source, ref, definition)
    }
  }
  private executeEffect(source: Skill | Mark, ref: EffectReference, definition: TrustedEffect) {
    const bound: TrustedEffect<T> = {
      id: definition.id,
      version: definition.version,
      triggers: [this.trigger],
      priority: definition.priority,
      execute: context => definition.execute(context),
    }
    const context = new EffectContext(this.context, this.trigger, source, copyData(ref.params), bound)
    this.battle.phaseManager.executeSync(new EffectPhase(context, bound))
  }
}
