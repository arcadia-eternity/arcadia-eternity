import { BaseMark } from '@arcadia-eternity/battle/v4'
import {
  EffectTrigger,
  compileEffect,
  conditions,
  contexts,
  defineEffect,
  ops,
  selectFrom,
} from '@arcadia-eternity/battle/v4/authoring'

export const randomWeatherDependencies = Object.freeze(['mark_global_qingtian', 'mark_global_yemu'] as const)

/** Historical first-hit cursor semantics; candidate pending dependency closure. */
export function createRandomWeatherApplication(marks: ReadonlyMap<string, BaseMark>) {
  const choices = randomWeatherDependencies.map(id => {
    const mark = marks.get(id)
    if (!(mark instanceof BaseMark) || mark.id !== id)
      throw new Error(`Missing or mismatched native mark dependency: ${id}`)
    return mark
  })
  const firstHit = contexts.skillUse.condition((_, events) => events[0]?.currentHitCount === 1)
  return compileEffect(
    defineEffect({
      id: 'effect_skill_set_field_qingtian_or_yemu',
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: conditions.all(conditions.selfUsesSkill, firstHit),
      apply: contexts.battle.apply(ops.addMark(selectFrom(choices).shuffled().first())),
    }),
  )
}
