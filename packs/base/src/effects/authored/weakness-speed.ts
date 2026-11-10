import { EffectTrigger, defineEffect, ops, targets } from '@arcadia-eternity/battle/authoring'

const weaknessMark = targets.ownerMarks.where(mark => mark.baseId === 'mark_ruodianjihao').first()

/** Fixed instance, changing stack. Inactive input suspends the contribution without selecting a replacement. */
const capturedInstancePenalty = weaknessMark
  .capture({ key: 'weakness-instance', scope: 'binding' })
  .attribute('stack')
  .follow({ key: 'weakness-stack' })
  .map(stack => Math.floor(stack * -25))

/** Source: effect_mark_reduce_speed_ruodian. Only the first plan is used in this specimen. */
export const weaknessSpeedPenalty = defineEffect({
  id: 'effect_mark_reduce_speed_ruodian',
  triggers: [EffectTrigger.OnMarkCreated],
  apply: targets.ownerPet.apply(
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
