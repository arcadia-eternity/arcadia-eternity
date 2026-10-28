import {
  EffectTrigger,
  compileEffect,
  conditions,
  contexts,
  defineEffect,
  ops,
} from '@arcadia-eternity/battle/v4/authoring'

export function createResourcePrevention() {
  return Object.freeze({
    effect_mark_zhenshihuanxiang_prevent_consume: compileEffect(
      defineEffect({
        id: 'effect_mark_zhenshihuanxiang_prevent_consume',
        triggers: [EffectTrigger.OnBeforeConsumeStack],
        priority: 100,
        when: conditions.all(
          conditions.sourceOwnsEvent,
          contexts.consumeStack.condition((_ctx, events) =>
            events.some(event => event.mark.baseId === 'mark_huanxiang'),
          ),
        ),
        apply: contexts.consumeStack.apply(ops.disableContext()),
      }),
    ),
    effect_ability_gugao_prevent_rage_when_opponent_use_skill: compileEffect(
      defineEffect({
        id: 'effect_ability_gugao_prevent_rage_when_opponent_use_skill',
        triggers: [EffectTrigger.BeforeRageGain],
        priority: 0,
        when: conditions.all(
          conditions.skillActorDiffersFromOwner,
          conditions.ownerIsActive,
          contexts.rage.condition((_ctx, events) => events.some(event => event.reason === 'skillHit')),
        ),
        apply: contexts.rage.apply(ops.disableContext()),
      }),
    ),
  })
}
