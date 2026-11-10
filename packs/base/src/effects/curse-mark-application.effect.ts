import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

import { EffectTrigger, compileEffect, ops, selectFrom, targets } from '@arcadia-eternity/battle/authoring'

/** The supplied ordered catalog is read at execution time, including membership and tag changes. */
@effectGroup({ id: 'curse-mark-application' })
export class CurseMarkApplicationEffects {
  static build(context: Pick<EffectLoadingContext, 'marks'>) {
    const marks = context.marks

    const randomStatus = selectFrom([marks])
      .flatMap(catalog => [...catalog.values()])
      .where(mark => mark.tags.includes('status'))
      .shuffled()
      .first()
    return compileEffect({
      id: 'effect_mark_curse_add_random_status',
      triggers: [EffectTrigger.OnMarkDestroy],
      priority: 0,
      apply: targets.ownerPet.apply(ops.addMark(randomStatus)),
    })
  }
}
