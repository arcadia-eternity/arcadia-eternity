// Reviewed native behavior; edit this TypeScript source directly.
import {
  EffectTrigger,
  numberParam,
  compileEffect,
  defineEffect,
  targets,
  ops,
  actions,
  bindings,
} from '@arcadia-eternity/battle/v4/authoring'
export function createGeneratedDynamicContributions() {
  return Object.freeze({
    effect_mark_add_atk_stack_x35: compileEffect(
      defineEffect({
        id: 'effect_mark_add_atk_stack_x35',
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.ownerPet.apply(
            ops.bindAttribute({
              key: 'action0_value_binding',
              attribute: 'atk',
              operation: 'delta',
              value: targets.sourceMark
                .first()
                .capture({ key: 'source', scope: 'binding' })
                .attribute('stack')
                .follow({ key: 'stack' })
                .map(stack => Math.floor(stack * 35)),
              stacking: 'append',
              lifetime: 'sourceMark',
              missing: 'detach',
            }),
          ),
        ),
      }),
    ),
    effect_mark_add_weight_stack_x50: compileEffect(
      defineEffect({
        id: 'effect_mark_add_weight_stack_x50',
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.ownerPet.apply(
            ops.bindAttribute({
              key: 'action0_value_binding',
              attribute: 'weight',
              operation: 'delta',
              value: targets.sourceMark
                .first()
                .capture({ key: 'source', scope: 'binding' })
                .attribute('stack')
                .follow({ key: 'stack' })
                .map(stack => Math.floor(stack * 50)),
              stacking: 'append',
              lifetime: 'sourceMark',
              missing: 'detach',
            }),
          ),
        ),
      }),
    ),
    effect_mark_def_boost_25_per_stack: compileEffect(
      defineEffect({
        id: 'effect_mark_def_boost_25_per_stack',
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.ownerPet.apply(
            ops.bindAttribute({
              key: 'action0_value_binding',
              attribute: 'def',
              operation: 'delta',
              value: targets.sourceMark
                .first()
                .capture({ key: 'source', scope: 'binding' })
                .attribute('stack')
                .follow({ key: 'stack' })
                .map(stack => Math.floor(stack * 25)),
              stacking: 'append',
              lifetime: 'sourceMark',
              missing: 'detach',
            }),
          ),
        ),
      }),
    ),
    effect_mark_increase_accuracy_stack: compileEffect(
      defineEffect({
        id: 'effect_mark_increase_accuracy_stack',
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.ownerPet.apply(
            ops.bindAttribute({
              key: 'action0_value_binding',
              attribute: 'accuracy',
              operation: 'delta',
              value: targets.sourceMark
                .first()
                .capture({ key: 'source', scope: 'binding' })
                .attribute('stack')
                .follow({ key: 'stack' }),
              stacking: 'append',
              lifetime: 'sourceMark',
              missing: 'detach',
            }),
          ),
        ),
      }),
    ),
    effect_mark_raise_spe_by_25_per_stack: compileEffect(
      defineEffect({
        id: 'effect_mark_raise_spe_by_25_per_stack',
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.ownerPet.apply(
            ops.bindAttribute({
              key: 'action0_value_binding',
              attribute: 'spe',
              operation: 'delta',
              value: targets.sourceMark
                .first()
                .capture({ key: 'source', scope: 'binding' })
                .attribute('stack')
                .follow({ key: 'stack' })
                .map(stack => Math.floor(stack * 25)),
              stacking: 'append',
              lifetime: 'sourceMark',
              missing: 'detach',
            }),
          ),
        ),
      }),
    ),
    effect_mark_reduce_accuracy_5_per_stack: (() => {
      const parameters = {
        action0_value_factor: numberParam({
          default: -5,
          tags: [],
          legacyAliases: ['effect_mark_reduce_accuracy_5_per_stack.reduce_accuracy_per_stack'],
        }),
      }
      return compileEffect(
        defineEffect({
          id: 'effect_mark_reduce_accuracy_5_per_stack',
          triggers: [EffectTrigger.OnMarkCreated],
          priority: 0,
          parameters,
          when: () => true,
          apply: actions.sequence(
            targets.ownerPet.apply(
              ops.bindAttribute({
                key: 'action0_value_binding',
                attribute: 'accuracy',
                operation: 'delta',
                value: bindings.combine(
                  targets.sourceMark
                    .first()
                    .capture({ key: 'source', scope: 'binding' })
                    .attribute('stack')
                    .follow({ key: 'stack' }),
                  parameters.action0_value_factor.capture({ key: 'factor', scope: 'binding' }),
                  (stack, factor) => Math.floor(stack * factor),
                ),
                stacking: 'append',
                lifetime: 'sourceMark',
                missing: 'detach',
              }),
            ),
          ),
        }),
      )
    })(),
    effect_mark_reduce_accuracy_stack: compileEffect(
      defineEffect({
        id: 'effect_mark_reduce_accuracy_stack',
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.ownerPet.apply(
            ops.bindAttribute({
              key: 'action0_value_binding',
              attribute: 'accuracy',
              operation: 'delta',
              value: targets.sourceMark
                .first()
                .capture({ key: 'source', scope: 'binding' })
                .attribute('stack')
                .follow({ key: 'stack' })
                .map(stack => Math.floor(stack * -1)),
              stacking: 'append',
              lifetime: 'sourceMark',
              missing: 'detach',
            }),
          ),
        ),
      }),
    ),
    effect_mark_reduce_speed_with_stack: compileEffect(
      defineEffect({
        id: 'effect_mark_reduce_speed_with_stack',
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.ownerPet.apply(
            ops.bindAttribute({
              key: 'action0_value_binding',
              attribute: 'spe',
              operation: 'delta',
              value: targets.sourceMark
                .first()
                .capture({ key: 'source', scope: 'binding' })
                .attribute('stack')
                .follow({ key: 'stack' })
                .map(stack => Math.floor(stack * -1)),
              stacking: 'append',
              lifetime: 'sourceMark',
              missing: 'detach',
            }),
          ),
        ),
      }),
    ),
    effect_mark_spa_boost_25_per_stack: compileEffect(
      defineEffect({
        id: 'effect_mark_spa_boost_25_per_stack',
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.ownerPet.apply(
            ops.bindAttribute({
              key: 'action0_value_binding',
              attribute: 'spa',
              operation: 'delta',
              value: targets.sourceMark
                .first()
                .capture({ key: 'source', scope: 'binding' })
                .attribute('stack')
                .follow({ key: 'stack' })
                .map(stack => Math.floor(stack * 25)),
              stacking: 'append',
              lifetime: 'sourceMark',
              missing: 'detach',
            }),
          ),
        ),
      }),
    ),
    effect_mark_xukongtizhi_evasion: compileEffect(
      defineEffect({
        id: 'effect_mark_xukongtizhi_evasion',
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.ownerPet.apply(
            ops.bindAttribute({
              key: 'action0_value_binding',
              attribute: 'evasion',
              operation: 'delta',
              value: targets.sourceMark
                .first()
                .capture({ key: 'source', scope: 'binding' })
                .attribute('stack')
                .follow({ key: 'stack' })
                .map(stack => Math.min(stack, 100)),
              stacking: 'append',
              lifetime: 'sourceMark',
              missing: 'detach',
            }),
          ),
        ),
      }),
    ),
  })
}
export const generatedDynamicContributions = createGeneratedDynamicContributions()
