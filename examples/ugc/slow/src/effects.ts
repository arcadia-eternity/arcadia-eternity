import type { CodeEffectModuleContext } from '@arcadia-eternity/battle/v4/authoring'

/** The host supplies its SDK and canonical prototypes; importing this file registers nothing globally. */
export function createEffects({ sdk, marks, id }: CodeEffectModuleContext) {
  const { defineCodeEffect, numberParam, targets, ops, EffectTrigger, AddMarkContext } = sdk
  const slow = marks.get(id('slow'))
  if (!slow) throw new Error('Missing slow mark')
  return [
    defineCodeEffect({
      id: id('apply-slow'),
      sourceKind: 'skill',
      triggers: [EffectTrigger.OnHit],
      when: context => context.source === context.parent.skill,
      apply(context) {
        const target = context.parent.actualTarget
        if (target) target.addMark(new AddMarkContext(context, target, slow))
      },
    }),
    defineCodeEffect({
      id: id('speed-penalty'),
      sourceKind: 'petMark',
      build({ effectId }) {
        // This remains a modifiable battle parameter even though there is no editor parameter form.
        const amount = numberParam({ default: -25, tags: [id('slow-amount')] })
        return {
          id: effectId,
          on: 'OnMarkCreated',
          rebindOnOwnerTransfer: true,
          parameters: { amount },
          execute: targets.ownerPet.apply(
            ops.bindAttribute({
              key: 'speed',
              attribute: 'spe',
              operation: 'delta',
              value: amount.follow({ key: 'amount' }),
              lifetime: 'sourceMark',
              missing: 'detach',
            }),
          ),
        }
      },
    }),
  ]
}
