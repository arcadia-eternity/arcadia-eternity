import { BaseStatLevelMark } from '@arcadia-eternity/battle/v4'
import { compileEffect, conditions, contexts, defineEffect, ops } from '@arcadia-eternity/battle/v4/authoring'

/** V1 uses a signed prototype level; V2's statLevelMarkLevel is an unsigned event magnitude. */
export function createDoubleStageDebuff() {
  const doubledLevel = contexts.addMark
    .flatMap(event => (event.baseMark instanceof BaseStatLevelMark ? [event.baseMark.initialLevel] : []))
    .select(level => Math.floor(level * 2))
    .first()
  return compileEffect(
    defineEffect({
      id: 'effect_mark_double_stage_debuff',
      on: 'OnBeforeAddMark',
      priority: 0,
      when: conditions.all(conditions.ownerAddsMark, conditions.statStageChange(undefined, 'down')),
      execute: contexts.addMark.apply(ops.setStatLevelMarkLevel(doubledLevel)),
    }),
  )
}
