import { actions, checks, conditions, defineEffect, ops, targets } from '@arcadia-eternity/battle/v4/authoring'

const owner = targets.ownerPet
const fantasyMarks = targets.ownerMarks.where(mark => mark.baseId === 'mark_huanxiang')
const hasFantasy = fantasyMarks.condition(checks.exists())

/** Source: packs/base/data/effect_skill.yaml — action two queries after consumption hooks finish. */
export const consumeFantasyForDefense = defineEffect({
  id: 'effect_skill_consume_huanxiang_raise_def_1_stage',
  on: 'BeforeHit',
  when(ctx) {
    return conditions.selfUsesSkill(ctx) && hasFantasy(ctx)
  },
  execute: actions.sequence(fantasyMarks.apply(ops.consumeStacks(1)), owner.apply(ops.changeStatStage('def', 1))),
})
