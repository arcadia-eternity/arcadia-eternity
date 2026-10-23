// Reviewed native behavior; edit this TypeScript source directly.
import {
  numberParam,
  compileEffect,
  defineEffect,
  conditions,
  targets,
  ops,
  actions,
  bindings,
  type EffectFrame,
} from '@arcadia-eternity/battle/v4/authoring'
export function createGeneratedAttributeContributions() {
  return Object.freeze({
    effect_ability_add_self_evasion_10: compileEffect(
      defineEffect({
        id: 'effect_ability_add_self_evasion_10',
        on: 'OnBattleStart',
        priority: 0,
        when: () => true,
        execute: actions.sequence(targets.ownerPet.apply(ops.addAttributeModifier('evasion', 'delta', 10))),
      }),
    ),
    effect_ability_hongxin_increase_accuracy_5_percent: compileEffect(
      defineEffect({
        id: 'effect_ability_hongxin_increase_accuracy_5_percent',
        on: 'OnBattleStart',
        priority: 0,
        when: () => true,
        execute: actions.sequence(targets.ownerPet.apply(ops.addAttributeModifier('accuracy', 'delta', 5))),
      }),
    ),
    effect_ability_increase_accuracy_5_percent_if_height_above_100: compileEffect(
      defineEffect({
        id: 'effect_ability_increase_accuracy_5_percent_if_height_above_100',
        on: 'OnBattleStart',
        priority: 0,
        when: conditions.all(conditions.sourceOwnsEvent, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.height).first())
          const right = 100
          return left !== undefined && right !== undefined && left > right
        }),
        execute: actions.sequence(targets.ownerPet.apply(ops.addAttributeModifier('accuracy', 'delta', 5))),
      }),
    ),
    effect_ability_rage_boost_5_per_turn: compileEffect(
      defineEffect({
        id: 'effect_ability_rage_boost_5_per_turn',
        on: 'OnBattleStart',
        priority: 0,
        when: () => true,
        execute: actions.sequence(targets.ownerPet.apply(ops.addAttributeModifier('ragePerTurn', 'delta', 5))),
      }),
    ),
    effect_emblem_increase_weight_10kg: compileEffect(
      defineEffect({
        id: 'effect_emblem_increase_weight_10kg',
        on: 'OnBattleStart',
        priority: 1,
        when: () => true,
        execute: actions.sequence(targets.ownerPet.apply(ops.addAttributeModifier('weight', 'delta', 10))),
      }),
    ),
    effect_emblem_jingsongzhiyan_accuracy_boost_5_percent: compileEffect(
      defineEffect({
        id: 'effect_emblem_jingsongzhiyan_accuracy_boost_5_percent',
        on: 'OnBattleStart',
        priority: 0,
        when: () => true,
        execute: actions.sequence(
          targets.selfSkills
            .where(skill => skill.baseId === 'skill_jingsongzhiyan')
            .apply(ops.addSkillAttributeModifier('accuracy', 'delta', 5)),
        ),
      }),
    ),
    effect_emblem_xifa_skill_accuracy_boost_5_percent: compileEffect(
      defineEffect({
        id: 'effect_emblem_xifa_skill_accuracy_boost_5_percent',
        on: 'OnBattleStart',
        priority: 0,
        when: () => true,
        execute: actions.sequence(
          targets.selfSkills
            .where(skill => skill.tags.includes('xifa'))
            .apply(ops.addSkillAttributeModifier('accuracy', 'delta', 5)),
        ),
      }),
    ),
    effect_mark_add_crit_rate_10_percent: compileEffect(
      defineEffect({
        id: 'effect_mark_add_crit_rate_10_percent',
        on: 'OnMarkCreated',
        priority: 0,
        when: () => true,
        execute: actions.sequence(targets.ownerPet.apply(ops.addAttributeModifier('critRate', 'delta', 10))),
      }),
    ),
    effect_mark_add_crit_rate_5_percent: compileEffect(
      defineEffect({
        id: 'effect_mark_add_crit_rate_5_percent',
        on: 'OnMarkCreated',
        priority: 0,
        when: () => true,
        execute: actions.sequence(targets.ownerPet.apply(ops.addAttributeModifier('critRate', 'delta', 5))),
      }),
    ),
    effect_mark_decrease_atk: compileEffect(
      defineEffect({
        id: 'effect_mark_decrease_atk',
        on: 'OnMarkCreated',
        priority: 0,
        when: () => true,
        execute: actions.sequence(targets.ownerPet.apply(ops.addAttributeModifier('atk', 'percent', -25))),
      }),
    ),
    effect_mark_decrease_spa: compileEffect(
      defineEffect({
        id: 'effect_mark_decrease_spa',
        on: 'OnMarkCreated',
        priority: 0,
        when: () => true,
        execute: actions.sequence(targets.ownerPet.apply(ops.addAttributeModifier('spa', 'percent', -25))),
      }),
    ),
    effect_mark_increase_crit_rate_10_percent: compileEffect(
      defineEffect({
        id: 'effect_mark_increase_crit_rate_10_percent',
        on: 'OnMarkCreated',
        priority: 0,
        when: () => true,
        execute: actions.sequence(targets.ownerPet.apply(ops.addAttributeModifier('critRate', 'delta', 10))),
      }),
    ),
    effect_mark_increase_crit_rate_20_percent_per_stack: (() => {
      const parameters = {
        action0_value_factor: numberParam({
          default: 20,
          tags: [],
          legacyAliases: ['effect_mark_increase_crit_rate_20_percent_per_stack.crit_rate_increase_per_stack'],
        }),
      }
      return compileEffect(
        defineEffect({
          id: 'effect_mark_increase_crit_rate_20_percent_per_stack',
          on: 'OnMarkCreated',
          priority: 0,
          parameters,
          when: () => true,
          execute: actions.sequence(
            targets.ownerPet.apply(
              ops.bindAttribute({
                key: 'action0_value_binding',
                attribute: 'critRate',
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
    effect_mark_increase_evasion_10_percent: compileEffect(
      defineEffect({
        id: 'effect_mark_increase_evasion_10_percent',
        on: 'OnMarkCreated',
        priority: 0,
        when: () => true,
        execute: actions.sequence(targets.ownerPet.apply(ops.addAttributeModifier('evasion', 'delta', 10))),
      }),
    ),
    effect_mark_increase_evasion_15_percent: (() => {
      const parameters = {
        action0_value: numberParam({
          default: 15,
          tags: [],
          legacyAliases: ['effect_mark_increase_evasion_15_percent.evasion_increase'],
        }),
      }
      return compileEffect(
        defineEffect({
          id: 'effect_mark_increase_evasion_15_percent',
          on: 'OnMarkCreated',
          priority: 0,
          parameters,
          when: () => true,
          execute: actions.sequence(
            targets.ownerPet.apply(ops.addAttributeModifier('evasion', 'delta', parameters.action0_value)),
          ),
        }),
      )
    })(),
    effect_mark_increase_evasion_5_percent: compileEffect(
      defineEffect({
        id: 'effect_mark_increase_evasion_5_percent',
        on: 'OnMarkCreated',
        priority: 0,
        when: () => true,
        execute: actions.sequence(targets.ownerPet.apply(ops.addAttributeModifier('evasion', 'delta', 5))),
      }),
    ),
    effect_mark_increase_self_crit_rate: compileEffect(
      defineEffect({
        id: 'effect_mark_increase_self_crit_rate',
        on: 'OnMarkCreated',
        priority: 0,
        when: () => true,
        execute: actions.sequence(targets.selfTeam.apply(ops.addAttributeModifier('critRate', 'delta', 10))),
      }),
    ),
    effect_mark_reduce_accuracy_10: compileEffect(
      defineEffect({
        id: 'effect_mark_reduce_accuracy_10',
        on: 'OnMarkCreated',
        priority: 0,
        when: () => true,
        execute: actions.sequence(targets.ownerPet.apply(ops.addAttributeModifier('accuracy', 'percent', -10))),
      }),
    ),
    effect_mark_reduce_accuracy_15: compileEffect(
      defineEffect({
        id: 'effect_mark_reduce_accuracy_15',
        on: 'OnMarkCreated',
        priority: 0,
        when: () => true,
        execute: actions.sequence(targets.ownerPet.apply(ops.addAttributeModifier('accuracy', 'delta', -15))),
      }),
    ),
    effect_mark_reduce_accuracy_50: compileEffect(
      defineEffect({
        id: 'effect_mark_reduce_accuracy_50',
        on: 'OnMarkCreated',
        priority: 0,
        when: () => true,
        execute: actions.sequence(targets.ownerPet.apply(ops.addAttributeModifier('accuracy', 'delta', -50))),
      }),
    ),
    effect_mark_reduce_speed_50: compileEffect(
      defineEffect({
        id: 'effect_mark_reduce_speed_50',
        on: 'OnMarkCreated',
        priority: 0,
        when: () => true,
        execute: actions.sequence(targets.ownerPet.apply(ops.addAttributeModifier('spe', 'delta', -50))),
      }),
    ),
  })
}
export const generatedAttributeContributions = createGeneratedAttributeContributions()
