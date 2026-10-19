import type { BaseMark } from '../mark'
import { compileEffect, defineEffect, ops, selectFrom, targets } from '../content/authoring'

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
      on: 'OnMarkDestroy',
      priority: 0,
      execute: targets.ownerPet.apply(ops.addMark(randomStatus)),
    }),
  )
}
