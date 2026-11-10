import { effectGroup } from '@arcadia-eternity/battle/effect-loading'
import { defineEffects, EffectTrigger, actions, conditions, ops, targets } from '@arcadia-eternity/battle/authoring'

import { statusTransferOnHit } from './shared-plans'

/** Targets and source lists are queried anew for each action, using the existing transfer lifecycle. */
@effectGroup({ id: 'mark-transfers' })
export class MarkTransfersEffects {
  static build() {
    return defineEffects({
      effect_skill_transfer_debuff_stage_to_opponent: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.opponentActive.apply(ops.transferStatStages(targets.ownerPet.first(), { strategy: 'negative' })),
      },
      effect_skill_transfer_status_marks_to_opponent: {
        ...statusTransferOnHit('status'),
      },
      effect_mark_transfer_to_opponent_on_hit: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.ownerIsSkillTarget,
        apply: actions.sequence(
          targets.opponentActive.apply(ops.transferMarks(targets.sourceMark.all())),
          targets.sourceMark.apply(ops.addStacks(1)),
        ),
      },
    })
  }
}
