// Reviewed native behavior; edit this TypeScript source directly.
import {
  compileEffect,
  defineEffect,
  conditions,
  contexts,
  targets,
  ops,
  actions,
  type EffectFrame,
} from '@arcadia-eternity/battle/v4/authoring'
export function createGeneratedDamageSequences() {
  return Object.freeze({
    effect_mark_add_damage_taken_with_stack: compileEffect(
      defineEffect({
        id: 'effect_mark_add_damage_taken_with_stack',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.selfBeDamaged,
        execute: actions.sequence(
          contexts.damage.apply(
            ops.modifyDamage({ percent: targets.sourceMark.select(mark => mark.stack).first(), delta: 0 }),
          ),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      }),
    ),
    effect_mark_add_damage_with_stack_and_consume: compileEffect(
      defineEffect({
        id: 'effect_mark_add_damage_with_stack_and_consume',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.sourceMark.select(mark => mark.stack).first())
          const right = 1
          return left !== undefined && right !== undefined && left > right
        }),
        execute: actions.sequence(
          contexts.damage.apply(
            ops.modifyDamage({ percent: 0, delta: targets.sourceMark.select(mark => mark.stack).first() }),
          ),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      }),
    ),
    effect_mark_amplify_next_physical_damage_with_stack: compileEffect(
      defineEffect({
        id: 'effect_mark_amplify_next_physical_damage_with_stack',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.damage.condition((_ctx, events) => events[0]?.damageType === 'Physical'),
        ),
        execute: actions.sequence(
          contexts.damage.apply(
            ops.modifyDamage({ percent: targets.sourceMark.select(mark => mark.stack).first(), delta: 0 }),
          ),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      }),
    ),
    effect_mark_amplify_next_special_damage_with_stack: compileEffect(
      defineEffect({
        id: 'effect_mark_amplify_next_special_damage_with_stack',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.damage.condition((_ctx, events) => events[0]?.damageType === 'Special'),
        ),
        execute: actions.sequence(
          contexts.damage.apply(
            ops.modifyDamage({ percent: targets.sourceMark.select(mark => mark.stack).first(), delta: 0 }),
          ),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      }),
    ),
    effect_mark_baiyapo_add_damage_based_on_stack: compileEffect(
      defineEffect({
        id: 'effect_mark_baiyapo_add_damage_based_on_stack',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          contexts.skillUse.condition((_ctx, events) => events[0]?.skill.baseId === 'skill_baiyapo'),
        ),
        execute: actions.sequence(
          contexts.damage.apply(
            ops.modifyDamage({ percent: 0, delta: targets.sourceMark.select(mark => mark.stack).first() }),
          ),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      }),
    ),
    effect_mark_block_climax_damage: compileEffect(
      defineEffect({
        id: 'effect_mark_block_climax_damage',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          contexts.skillUse.condition((_ctx, events) => events[0]?.category === 'Climax'),
        ),
        execute: actions.sequence(contexts.damage.apply(ops.preventDamage())),
      }),
    ),
    effect_mark_block_next_special_damage: compileEffect(
      defineEffect({
        id: 'effect_mark_block_next_special_damage',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          contexts.damage.condition((_ctx, events) => events[0]?.damageType === 'Special'),
        ),
        execute: actions.sequence(
          contexts.damage.apply(ops.preventDamage()),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      }),
    ),
    effect_mark_heiyapao_add_damage_based_on_stack: compileEffect(
      defineEffect({
        id: 'effect_mark_heiyapao_add_damage_based_on_stack',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          contexts.skillUse.condition((_ctx, events) => events[0]?.skill.baseId === 'skill_heiyapo'),
        ),
        execute: actions.sequence(
          contexts.damage.apply(
            ops.modifyDamage({ percent: 0, delta: targets.sourceMark.select(mark => mark.stack).first() }),
          ),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      }),
    ),
    effect_mark_increase_damage_taken_once: compileEffect(
      defineEffect({
        id: 'effect_mark_increase_damage_taken_once',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.selfBeDamaged,
        execute: actions.sequence(
          contexts.damage.apply(
            ops.modifyDamage({ percent: targets.sourceMark.select(mark => mark.stack).first(), delta: 0 }),
          ),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      }),
    ),
    effect_mark_increase_taken_damage_30_xstack: compileEffect(
      defineEffect({
        id: 'effect_mark_increase_taken_damage_30_xstack',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.selfBeDamaged,
        execute: actions.sequence(
          contexts.damage.apply(
            ops.modifyDamage({
              percent: 0,
              delta: targets.sourceMark
                .select(mark => mark.stack)
                .first()
                .map(n => Math.floor(n * 30)),
            }),
          ),
        ),
      }),
    ),
    effect_mark_mihuo_reduce_damage: compileEffect(
      defineEffect({
        id: 'effect_mark_mihuo_reduce_damage',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.selfUsesSkill,
        execute: actions.sequence(contexts.damage.apply(ops.modifyDamage({ percent: 0, delta: -50 }))),
      }),
    ),
    effect_mark_reduce_damage_15_percent: compileEffect(
      defineEffect({
        id: 'effect_mark_reduce_damage_15_percent',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.selfUsesSkill,
        execute: actions.sequence(contexts.damage.apply(ops.modifyDamage({ percent: -15, delta: 0 }))),
      }),
    ),
    effect_mark_reduce_damage_30_percent_xstack: compileEffect(
      defineEffect({
        id: 'effect_mark_reduce_damage_30_percent_xstack',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.selfUsesSkill,
        execute: actions.sequence(
          contexts.damage.apply(
            ops.modifyDamage({
              percent: 0,
              delta: targets.sourceMark
                .select(mark => mark.stack)
                .first()
                .map(n => Math.floor(n * -30)),
            }),
          ),
        ),
      }),
    ),
    effect_mark_reduce_damage_taken_once: compileEffect(
      defineEffect({
        id: 'effect_mark_reduce_damage_taken_once',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.selfBeDamaged,
        execute: actions.sequence(
          contexts.damage.apply(
            ops.modifyDamage({
              percent: targets.sourceMark
                .select(mark => mark.stack)
                .first()
                .map(n => Math.floor(n * -1)),
              delta: 0,
            }),
          ),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      }),
    ),
    effect_mark_reduce_deal_damage_once_per_stack: compileEffect(
      defineEffect({
        id: 'effect_mark_reduce_deal_damage_once_per_stack',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.selfUsesSkill,
        execute: actions.sequence(
          contexts.damage.apply(
            ops.modifyDamage({
              percent: 0,
              delta: targets.sourceMark
                .select(mark => mark.stack)
                .first()
                .map(n => Math.floor(n * -1)),
            }),
          ),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      }),
    ),
  })
}
export const generatedDamageSequences = createGeneratedDamageSequences()
