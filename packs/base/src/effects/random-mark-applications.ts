import { BaseMark } from '@arcadia-eternity/battle/v4'
import {
  EffectTrigger,
  compileEffect,
  conditions,
  defineEffect,
  ops,
  selectFrom,
  targets,
} from '@arcadia-eternity/battle/v4/authoring'

export const randomMarkApplicationDependencies = Object.freeze(['mark_zhaocai', 'mark_jinbao'] as const)

/** Explicit candidate only; dependency closure and production admission are separate gates. */
export function createRandomMarkApplications(marks: ReadonlyMap<string, BaseMark>) {
  const choices = randomMarkApplicationDependencies.map(id => {
    const mark = marks.get(id)
    if (!(mark instanceof BaseMark) || mark.id !== id)
      throw new Error(`Missing or mismatched native mark dependency: ${id}`)
    return mark
  })
  const luckyMark = selectFrom(choices).shuffled().first()
  return Object.freeze({
    effect_skill_add_mark_zhaocai_or_jinbao: compileEffect(
      defineEffect({
        id: 'effect_skill_add_mark_zhaocai_or_jinbao',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(luckyMark)),
      }),
    ),
  })
}
