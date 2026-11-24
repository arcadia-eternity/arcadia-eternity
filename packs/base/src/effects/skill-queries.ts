import { contexts, targets } from '@arcadia-eternity/battle/authoring'
import type { Element } from '@arcadia-eternity/const'

export const actualSkillTarget = contexts.skillUse.flatMap(cast => (cast.actualTarget ? [cast.actualTarget] : []))
export const nonStatusSkillUse = contexts.skillUse.condition((_, casts) =>
  casts.some(cast => cast.category !== 'Status'),
)

export function opponentHasElement(element: Element) {
  return targets.opponentActive.condition((_, pets) => pets.some(pet => pet.element === element))
}
