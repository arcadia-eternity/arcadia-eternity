import {
  EffectTrigger,
  actions,
  compileEffect,
  conditions,
  contexts,
  ops,
  targets,
} from '@arcadia-eternity/battle/authoring'

export function createSwitchRageProtection() {
  return compileEffect({
    id: 'effect_mark_prevent_rage_loss_on_switch',
    triggers: [EffectTrigger.BeforeRageLoss],
    priority: 0,
    when: conditions.ownerLosesSwitchRage,
    apply: actions.sequence(contexts.rage.apply(ops.disableContext()), targets.sourceMark.apply(ops.removeMark())),
  })
}
