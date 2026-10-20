import { actions, compileEffect, conditions, defineEffect } from '../content/authoring'

/** Preserve the source TODO identity. Experience settlement is not implemented by this effect. */
export function createExperiencePlaceholder() {
  return compileEffect(
    defineEffect({
      id: 'effect_ability_exp_boost_50_percent',
      on: 'OnBattleStart',
      priority: 0,
      when: conditions.sourceOwnsEvent,
      execute: actions.sequence(),
    }),
  )
}
