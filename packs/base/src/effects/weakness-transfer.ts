import {
  EffectTrigger,
  booleanParam,
  compileEffect,
  conditions,
  contexts,
  defineEffect,
  ops,
} from '@arcadia-eternity/battle/v4/authoring'

/** C09 repairs baseMarkId; the original action sets transferOnSwitch, despite the effect's name. */
export function createWeaknessTransfer() {
  const transfer = booleanParam({ default: true })
  return compileEffect(
    defineEffect({
      id: 'effect_emblem_set_ruodianbiaoji_keeponswitchout',
      triggers: [EffectTrigger.OnBeforeAddMark],
      priority: 0,
      parameters: { transfer },
      when: conditions.all(
        conditions.ownerAddsMark,
        contexts.addMark.condition((_ctx, events) => events.some(event => event.baseMark.id === 'mark_ruodianjihao')),
      ),
      apply: contexts.addMark.apply(ops.setMarkTransferOnSwitch(transfer)),
    }),
  )
}
