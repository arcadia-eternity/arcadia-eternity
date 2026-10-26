import { conditions, targets, ops, values, type Value } from '@arcadia-eternity/battle/v4/authoring'

type Numeric = number | Value<number, 'optional' | 'required'>

/** Official effects and configurable templates share the same target, event and lifecycle decisions. */
export function healingOnHit(amount: Numeric) {
  return {
    on: 'OnHit' as const,
    when: conditions.selfUsesSkill,
    execute: targets.ownerPet.apply(ops.heal(amount)),
  }
}

export function consecutiveHealingAmount(normal: number | Value<number>, repeated: number | Value<number>) {
  return values.choose(
    targets.ownerPet.condition((_ctx, pets) => pets.some(pet => pet.lastSkillUsedTimes > 1)),
    repeated,
    normal,
  )
}

export function statusTransferOnHit(category: string) {
  return {
    on: 'OnHit' as const,
    priority: 0,
    when: conditions.selfUsesSkill,
    execute: targets.opponentActive.apply(
      ops.transferMarks(targets.ownerMarks.where(mark => mark.tags.includes(category)).all()),
    ),
  }
}
