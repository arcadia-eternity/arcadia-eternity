import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'
import { EffectTrigger, compileEffect, conditions, contexts, ops, selectFrom } from '@arcadia-eternity/battle/authoring'
import { requireMark } from './mark-queries'

export const randomWeatherDependencies = Object.freeze(['mark_global_qingtian', 'mark_global_yemu'] as const)

/** Historical first-hit cursor semantics; candidate pending dependency closure. */
@effectGroup({ id: 'random-weather-application' })
export class RandomWeatherApplicationEffects {
  static build(context: Pick<EffectLoadingContext, 'marks'>) {
    const marks = context.marks

    const choices = randomWeatherDependencies.map(id => requireMark(marks, id))
    const firstHit = contexts.skillUse.condition((_, events) => events[0]?.currentHitCount === 1)
    return compileEffect({
      id: 'effect_skill_set_field_qingtian_or_yemu',
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: conditions.all(conditions.selfUsesSkill, firstHit),
      apply: contexts.battle.apply(ops.addMark(selectFrom(choices).shuffled().first())),
    })
  }
}
