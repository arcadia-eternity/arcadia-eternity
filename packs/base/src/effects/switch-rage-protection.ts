import {
  EffectTrigger,
  actions,
  compileEffect,
  conditions,
  contexts,
  defineEffect,
  ops,
  targets,
} from '@arcadia-eternity/battle/v4/authoring'

export function createSwitchRageProtection() {
  return compileEffect(
    defineEffect({
      id: 'effect_mark_prevent_rage_loss_on_switch',
      triggers: [EffectTrigger.BeforeRageLoss],
      priority: 0,
      when: conditions.ownerLosesSwitchRage,
      apply: actions.sequence(contexts.rage.apply(ops.disableContext()), targets.sourceMark.apply(ops.removeMark())),
    }),
  )
}
