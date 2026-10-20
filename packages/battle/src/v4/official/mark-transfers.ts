import { actions, compileEffect, conditions, defineEffect, ops, targets } from '../content/authoring'

/** Targets and source lists are queried anew for each action, using the existing transfer lifecycle. */
export function createMarkTransfers() {
  return Object.freeze({
    effect_skill_transfer_debuff_stage_to_opponent: compileEffect(
      defineEffect({
        id: 'effect_skill_transfer_debuff_stage_to_opponent',
        on: 'OnHit',
        priority: 0,
        when: conditions.selfUsesSkill,
        execute: targets.opponentActive.apply(
          ops.transferStatStages(targets.ownerPet.first(), { strategy: 'negative' }),
        ),
      }),
    ),
    effect_skill_transfer_status_marks_to_opponent: compileEffect(
      defineEffect({
        id: 'effect_skill_transfer_status_marks_to_opponent',
        on: 'OnHit',
        priority: 0,
        when: conditions.selfUsesSkill,
        execute: targets.opponentActive.apply(
          ops.transferMarks(targets.ownerMarks.where(mark => mark.tags.includes('status')).all()),
        ),
      }),
    ),
    effect_mark_transfer_to_opponent_on_hit: compileEffect(
      defineEffect({
        id: 'effect_mark_transfer_to_opponent_on_hit',
        on: 'OnHit',
        priority: 0,
        when: conditions.ownerIsSkillTarget,
        execute: actions.sequence(
          targets.opponentActive.apply(ops.transferMarks(targets.sourceMark.all())),
          targets.sourceMark.apply(ops.addStacks(1)),
        ),
      }),
    ),
  })
}
