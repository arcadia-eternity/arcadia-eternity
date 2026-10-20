import { actions, compileEffect, conditions, contexts, defineEffect, ops, targets } from '../content/authoring'

export function createSwitchRageProtection() {
  return compileEffect(
    defineEffect({
      id: 'effect_mark_prevent_rage_loss_on_switch',
      on: 'BeforeRageLoss',
      priority: 0,
      when: conditions.ownerLosesSwitchRage,
      execute: actions.sequence(contexts.rage.apply(ops.disableContext()), targets.sourceMark.apply(ops.removeMark())),
    }),
  )
}
