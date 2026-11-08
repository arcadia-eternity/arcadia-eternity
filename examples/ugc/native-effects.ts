import type { CodeEffectModuleContext } from '@arcadia-eternity/battle/authoring'

/** Official engine APIs, exercised by packages/battle/test/engine/effect-sdk-native.test.ts. */
export function createEffects({ sdk, id }: CodeEffectModuleContext) {
  const { defineCodeEffect, EffectTrigger, Pet, HealContext, targets, ops } = sdk
  return [
    defineCodeEffect({
      id: id('recover'),
      sourceKind: 'skill',
      triggers: [EffectTrigger.OnHit],
      when: context => context.source === context.parent.skill,
      apply(context) {
        const owner = context.source.owner
        if (owner instanceof Pet) {
          const amount = context.battle.randomInt(3, 7)
          owner.heal(new HealContext(context, context.source, owner, amount))
        }
      },
    }),
    defineCodeEffect({
      id: id('stack-defense'),
      sourceKind: 'petMark',
      build({ effectId }) {
        return {
          id: effectId,
          triggers: [EffectTrigger.OnMarkCreated],
          rebindOnOwnerTransfer: true,
          apply: targets.ownerPet.apply(
            ops.bindAttribute({
              key: 'defense',
              attribute: 'def',
              operation: 'delta',
              value: targets.sourceMark
                .first()
                .capture({ key: 'source', scope: 'binding' })
                .attribute('stack')
                .follow({ key: 'stack' })
                .map(stack => stack * 3),
              lifetime: 'sourceMark',
              missing: 'detach',
            }),
          ),
        }
      },
    }),
  ]
}
