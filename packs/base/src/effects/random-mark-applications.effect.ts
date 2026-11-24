import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'
import { defineEffects, EffectTrigger, conditions, ops, selectFrom, targets } from '@arcadia-eternity/battle/authoring'
import { requireMark } from './mark-queries'

export const randomMarkApplicationDependencies = Object.freeze(['mark_zhaocai', 'mark_jinbao'] as const)

/** Explicit candidate only; dependency closure and production admission are separate gates. */
@effectGroup({ id: 'random-mark-applications' })
export class RandomMarkApplicationsEffects {
  static build(context: Pick<EffectLoadingContext, 'marks'>) {
    const marks = context.marks

    const choices = randomMarkApplicationDependencies.map(id => requireMark(marks, id))
    const luckyMark = selectFrom(choices).shuffled().first()
    return defineEffects({
      effect_skill_add_mark_zhaocai_or_jinbao: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(luckyMark)),
      },
    })
  }
}
