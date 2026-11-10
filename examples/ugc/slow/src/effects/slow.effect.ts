import {
  effect,
  on,
  defineCodeEffect,
  numberParam,
  targets,
  ops,
  EffectTrigger,
  AddMarkContext,
  type EffectModuleContext,
  type NativeEffectContext,
} from '@arcadia-eternity/content-sdk'

@effect({ id: 'apply-slow', sourceKind: 'skill' })
export class ApplySlow {
  @on(EffectTrigger.OnHit)
  static apply(context: NativeEffectContext<EffectTrigger.OnHit>, content: EffectModuleContext) {
    if (context.source !== context.parent.skill) return
    const slow = content.marks.get(content.id('slow'))
    if (!slow) throw new Error('Missing slow mark')
    const target = context.parent.actualTarget
    if (target) target.addMark(new AddMarkContext(context, target, slow))
  }
}

@effect({ id: 'speed-penalty', sourceKind: 'petMark' })
export class SpeedPenalty {
  static create({ id }: EffectModuleContext) {
    return defineCodeEffect({
      id: id('speed-penalty'),
      sourceKind: 'petMark',
      build({ effectId }) {
        // This remains a modifiable battle parameter even though there is no editor parameter form.
        const amount = numberParam({ default: -25, tags: [id('slow-amount')] })
        return {
          id: effectId,
          triggers: [EffectTrigger.OnMarkCreated],
          rebindOnOwnerTransfer: true,
          parameters: { amount },
          apply: targets.ownerPet.apply(
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
    })
  }
}
