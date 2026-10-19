import { defineEffect, ops, targets } from '../../content/authoring'

const weaknessMark = targets.ownerMarks.where(mark => mark.baseId === 'mark_ruodianjihao').first()

/** Fixed instance, changing stack. Inactive input suspends the contribution without selecting a replacement. */
export const capturedInstancePenalty = weaknessMark
  .capture({ key: 'weakness-instance', scope: 'binding' })
  .attribute('stack')
  .follow({ key: 'weakness-stack' })
  .map(stack => Math.floor(stack * -25))

/** Alternative: reselection after a matching mark is removed/replaced. Not the same legacy behavior. */
export const followingInstancePenalty = weaknessMark
  .follow({ key: 'weakness-instance' })
  .attribute('stack')
  .follow({ key: 'weakness-stack' })
  .map(stack => Math.floor(stack * -25))

/** Alternative: capture once for each continuous period of membership, including re-entry. */
export const entryStackPenalty = weaknessMark
  .follow({ key: 'weakness-instance' })
  .attribute('stack')
  .capture({ key: 'initial-stack', scope: 'input' })
  .map(stack => Math.floor(stack * -25))

/** Source: effect_mark_reduce_speed_ruodian. Only the first plan is used in this specimen. */
export const weaknessSpeedPenalty = defineEffect({
  id: 'effect_mark_reduce_speed_ruodian',
  on: 'OnMarkCreated',
  execute: targets.ownerPet.apply(
    ops.bindAttribute({
      key: 'speed-penalty',
      attribute: 'spe',
      operation: 'delta',
      value: capturedInstancePenalty,
      lifetime: 'sourceMark',
      missing: 'detach',
    }),
  ),
})
