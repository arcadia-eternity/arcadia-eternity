import { BaseMark } from '@arcadia-eternity/battle/authoring'
import { checks, EffectTrigger, targets, type Condition } from '@arcadia-eternity/battle/authoring'

export function requireMark(marks: ReadonlyMap<string, BaseMark>, id: string): BaseMark {
  const mark = marks.get(id)
  if (!(mark instanceof BaseMark) || mark.id !== id)
    throw new Error(`Missing or mismatched native mark dependency: ${id}`)
  return mark
}

// These presence checks include inactive instances still in the pet’s mark list.
export function ownerHasMark(id: string) {
  return targets.ownerMarks.where(mark => mark.baseId === id).condition(checks.exists())
}

export function activeOwnerMarks(id: string) {
  return targets.ownerMarks.where(mark => mark.baseId === id && mark.isActive)
}

export const opponentActiveMarks = targets.opponentActive.flatMap(pet => pet.marks)

export function opponentHasMark(id: string) {
  return opponentActiveMarks.where(mark => mark.baseId === id).condition(checks.exists())
}

export function activeOpponentMarks(id: string) {
  return opponentActiveMarks.where(mark => mark.baseId === id && mark.isActive)
}

export const ruleConsumedSourceMark: Condition<EffectTrigger.OnConsumeStack> = ctx =>
  ctx.parent.reason === 'rule' && ctx.parent.mark === ctx.read(targets.sourceMark.first())

export const sourceMarkOnLastTurn = targets.sourceMark.condition((_, marks) => marks.some(mark => mark.duration === 1))
