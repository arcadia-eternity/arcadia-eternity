import type { CodeEffectModuleContext } from '@arcadia-eternity/battle/v4/authoring'

/** Official engine APIs, exercised by packages/battle/test/v4/effect-sdk-native.test.ts. */
export function createEffects({ sdk, id }: CodeEffectModuleContext) {
  const { defineCodeEffect, EffectTrigger, Pet, HealContext, MarkInstanceImpl, Modifier, DurationType, projectValue } =
    sdk
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
      triggers: [EffectTrigger.OnMarkCreated],
      rebindOnOwnerTransfer: true,
      apply(context) {
        const source = context.source,
          owner = source.owner
        if (!(source instanceof MarkInstanceImpl) || !(owner instanceof Pet)) return
        const modifier = new Modifier(
          DurationType.binding,
          `${context.effect!.id}/defense`,
          projectValue(source.attributeSystem.getAttribute$('stack'), 'multiply', 3),
          'delta',
          0,
          source,
        )
        modifier.followsMarkOwner = true
        source.addAttributeModifierCleanup(owner.attributeSystem.addModifier('def', modifier))
      },
    }),
  ]
}
