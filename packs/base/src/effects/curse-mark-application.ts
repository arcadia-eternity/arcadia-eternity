import type { BaseMark } from '@arcadia-eternity/battle/v4'
import {
  EffectTrigger,
  compileEffect,
  defineEffect,
  ops,
  selectFrom,
  targets,
} from '@arcadia-eternity/battle/v4/authoring'

/** The supplied ordered catalog is read at execution time, including membership and tag changes. */
export function createCurseMarkApplication(marks: ReadonlyMap<string, BaseMark>) {
  const randomStatus = selectFrom([marks])
    .flatMap(catalog => [...catalog.values()])
    .where(mark => mark.tags.includes('status'))
    .shuffled()
    .first()
  return compileEffect(
    defineEffect({
      id: 'effect_mark_curse_add_random_status',
      triggers: [EffectTrigger.OnMarkDestroy],
      priority: 0,
      apply: targets.ownerPet.apply(ops.addMark(randomStatus)),
    }),
  )
}
