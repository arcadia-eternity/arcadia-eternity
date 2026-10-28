import {
  EffectTrigger,
  actions,
  compileEffect,
  conditions,
  defineEffect,
  ops,
  targets,
} from '@arcadia-eternity/battle/v4/authoring'

import { statusTransferOnHit } from './shared-plans'

/** Targets and source lists are queried anew for each action, using the existing transfer lifecycle. */
export function createMarkTransfers() {
  return Object.freeze({
    effect_skill_transfer_debuff_stage_to_opponent: compileEffect(
      defineEffect({
        id: 'effect_skill_transfer_debuff_stage_to_opponent',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.opponentActive.apply(ops.transferStatStages(targets.ownerPet.first(), { strategy: 'negative' })),
      }),
    ),
    effect_skill_transfer_status_marks_to_opponent: compileEffect(
      defineEffect({
        id: 'effect_skill_transfer_status_marks_to_opponent',
        ...statusTransferOnHit('status'),
      }),
    ),
    effect_mark_transfer_to_opponent_on_hit: compileEffect(
      defineEffect({
        id: 'effect_mark_transfer_to_opponent_on_hit',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.ownerIsSkillTarget,
        apply: actions.sequence(
          targets.opponentActive.apply(ops.transferMarks(targets.sourceMark.all())),
          targets.sourceMark.apply(ops.addStacks(1)),
        ),
      }),
    ),
  })
}
