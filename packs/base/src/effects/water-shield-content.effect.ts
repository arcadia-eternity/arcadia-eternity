import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'
import { EffectTrigger } from '@arcadia-eternity/const'

import { compileEffect, targets, ops } from '@arcadia-eternity/battle/authoring'

@effectGroup({ id: 'water-shield-destruction' })
export class WaterShieldDestructionEffects {
  static build(context: Pick<EffectLoadingContext, 'mark'>) {
    const amplification = context.mark('mark_shanghaizengjia')

    if (amplification.id !== 'mark_shanghaizengjia')
      throw new Error('Water shield destruction requires mark_shanghaizengjia')
    return compileEffect({
      id: 'effect_mark_onDestroy_add_mark_shanghaizengjia',
      triggers: [EffectTrigger.OnMarkDestroy],
      apply: targets.ownerPet.apply(ops.addMark(amplification, { stack: 100 })),
    })
  }
}
