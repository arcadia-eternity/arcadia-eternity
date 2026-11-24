import { effectGroup } from '@arcadia-eternity/battle/effect-loading'
// Reviewed native behavior; edit this TypeScript source directly.
import {
  defineEffects,
  EffectTrigger,
  conditions,
  contexts,
  targets,
  ops,
  actions,
  type EffectFrame,
} from '@arcadia-eternity/battle/authoring'
import { physicalDamage, specialDamage } from './damage-conditions'
@effectGroup({ id: 'damage-sequences.generated' })
export class DamageSequencesGeneratedEffects {
  static build() {
    return defineEffects({
      effect_mark_add_damage_taken_with_stack: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        consumesStacks: 'all',
        when: conditions.selfBeDamaged,
        apply: actions.sequence(
          contexts.damage.apply(
            ops.modifyDamage({ percent: targets.sourceMark.select(mark => mark.stack).first(), delta: 0 }),
          ),
        ),
      },
      effect_mark_add_damage_with_stack_and_consume: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        consumesStacks: 'all',
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.sourceMark.select(mark => mark.stack).first())
          const right = 1
          return left !== undefined && right !== undefined && left > right
        }),
        apply: actions.sequence(
          contexts.damage.apply(
            ops.modifyDamage({ percent: 0, delta: targets.sourceMark.select(mark => mark.stack).first() }),
          ),
        ),
      },
      effect_mark_amplify_next_physical_damage_with_stack: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        consumesStacks: 'all',
        when: conditions.all(conditions.selfUsesSkill, physicalDamage),
        apply: actions.sequence(
          contexts.damage.apply(
            ops.modifyDamage({ percent: targets.sourceMark.select(mark => mark.stack).first(), delta: 0 }),
          ),
        ),
      },
      effect_mark_amplify_next_special_damage_with_stack: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        consumesStacks: 'all',
        when: conditions.all(conditions.selfUsesSkill, specialDamage),
        apply: actions.sequence(
          contexts.damage.apply(
            ops.modifyDamage({ percent: targets.sourceMark.select(mark => mark.stack).first(), delta: 0 }),
          ),
        ),
      },
      effect_mark_baiyapo_add_damage_based_on_stack: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        consumesStacks: 'all',
        when: conditions.all(
          conditions.selfBeDamaged,
          contexts.damageSkill.condition((_ctx, events) => events[0]?.id === 'skill_baiyapo'),
        ),
        apply: actions.sequence(
          contexts.damage.apply(
            ops.modifyDamage({ percent: 0, delta: targets.sourceMark.select(mark => mark.stack).first() }),
          ),
        ),
      },
      effect_mark_block_climax_damage: {
        triggers: [EffectTrigger.OnDamageReplacement],
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          contexts.damageSkill.condition((_ctx, events) => events[0]?.category === 'Climax'),
        ),
        apply: actions.sequence(contexts.damage.apply(ops.preventDamage())),
      },
      effect_mark_block_next_special_damage: {
        triggers: [EffectTrigger.OnDamageReplacement],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, specialDamage),
        apply: contexts.damage.apply(ops.preventDamage({ stacks: 'all' })),
      },
      effect_mark_heiyapao_add_damage_based_on_stack: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        consumesStacks: 'all',
        when: conditions.all(
          conditions.selfBeDamaged,
          contexts.damageSkill.condition((_ctx, events) => events[0]?.id === 'skill_heiyapo'),
        ),
        apply: actions.sequence(
          contexts.damage.apply(
            ops.modifyDamage({ percent: 0, delta: targets.sourceMark.select(mark => mark.stack).first() }),
          ),
        ),
      },
      effect_mark_increase_damage_taken_once: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        consumesStacks: 'all',
        when: conditions.selfBeDamaged,
        apply: actions.sequence(
          contexts.damage.apply(
            ops.modifyDamage({ percent: targets.sourceMark.select(mark => mark.stack).first(), delta: 0 }),
          ),
        ),
      },
      effect_mark_increase_taken_damage_30_xstack: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.selfBeDamaged,
        apply: actions.sequence(
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
      },
      effect_mark_mihuo_reduce_damage: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(contexts.damage.apply(ops.modifyDamage({ percent: 0, delta: -50 }))),
      },
      effect_mark_reduce_damage_15_percent: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(contexts.damage.apply(ops.modifyDamage({ percent: -15, delta: 0 }))),
      },
      effect_mark_reduce_damage_30_percent_xstack: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
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
      },
      effect_mark_reduce_damage_taken_once: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        consumesStacks: 'all',
        when: conditions.selfBeDamaged,
        apply: actions.sequence(
          contexts.damage.apply(
            ops.modifyDamage({
              percent: targets.sourceMark
                .select(mark => mark.stack)
                .first()
                .map(n => Math.floor(n * -1)),
              delta: 0,
            }),
          ),
        ),
      },
      effect_mark_reduce_deal_damage_once_per_stack: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        consumesStacks: 'all',
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          contexts.damage.apply(
            ops.modifyDamage({
              percent: 0,
              delta: targets.sourceMark
                .select(mark => mark.stack)
                .first()
                .map(n => Math.floor(n * -1)),
            }),
          ),
        ),
      },
    })
  }
}

export const generatedDamageSequences = DamageSequencesGeneratedEffects.build()
