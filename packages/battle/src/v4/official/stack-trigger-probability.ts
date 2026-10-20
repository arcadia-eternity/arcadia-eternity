import { compileEffect, defineEffect, ops, targets } from '../content/authoring'

/** Capture the contributing mark, then follow that instance's stack for each parameter read. */
export function createStackTriggerProbability() {
  const stack = targets.sourceMark
    .first()
    .capture({ key: 'source-mark', scope: 'binding' })
    .attribute('stack')
    .follow({ key: 'current-stack' })
  return Object.freeze({
    effect_mark_increase_skill_trigger_rate_with_stack: compileEffect(
      defineEffect({
        id: 'effect_mark_increase_skill_trigger_rate_with_stack',
        on: 'OnMarkCreated',
        priority: 0,
        execute: targets.ownerPet.apply(
          ops.bindTaggedParameter({
            key: 'stack-trigger-probability',
            tag: 'skill_effect_probability',
            operation: 'delta',
            value: stack,
          }),
        ),
      }),
    ),
  })
}
