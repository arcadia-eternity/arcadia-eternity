import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'
import { BaseMark } from '@arcadia-eternity/battle/engine'
import { defineEffects, EffectTrigger, conditions, ops, selectFrom, targets } from '@arcadia-eternity/battle/authoring'

export const randomMarkApplicationDependencies = Object.freeze(['mark_zhaocai', 'mark_jinbao'] as const)

/** Explicit candidate only; dependency closure and production admission are separate gates. */
@effectGroup({ id: 'random-mark-applications' })
export class RandomMarkApplicationsEffects {
  static build(context: Pick<EffectLoadingContext, 'marks'>) {
    const marks = context.marks

    const choices = randomMarkApplicationDependencies.map(id => {
      const mark = marks.get(id)
      if (!(mark instanceof BaseMark) || mark.id !== id)
        throw new Error(`Missing or mismatched native mark dependency: ${id}`)
      return mark
    })
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
