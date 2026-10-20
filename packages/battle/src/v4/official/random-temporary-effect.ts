import { Effect } from '../effect'
import type { EffectTrigger } from '@arcadia-eternity/const'
import { compileEffect, conditions, defineEffect, ops, selectFrom, targets } from '../content/authoring'

export const randomTemporaryEffectDependencies = Object.freeze([
  'effect_skill_add_mark_shanbi_below_1_8_hp',
  'effect_skill_add_mark_both_shanghaizengjia_50',
  'effect_skill_add_mark_opponent_mingzhongxiajiang_15',
  'effect_skill_priority_plus_1',
] as const)

/** Phase-scoped selection; admission does not replay the trigger currently being dispatched. */
export function createRandomTemporaryEffect(effects: ReadonlyMap<string, Effect<EffectTrigger>>) {
  const choices = randomTemporaryEffectDependencies.map(id => {
    const effect = effects.get(id)
    if (!(effect instanceof Effect) || effect.id !== id)
      throw new Error(`Missing or mismatched native effect dependency: ${id}`)
    return effect
  })
  return compileEffect(
    defineEffect({
      id: 'effect_skill_random_xifa_effect',
      on: 'BeforeSort',
      priority: 100,
      when: conditions.selfUsesSkill,
      execute: targets.sourceSkill.apply(ops.addTemporaryEffect(selectFrom(choices).shuffled().first())),
    }),
  )
}
