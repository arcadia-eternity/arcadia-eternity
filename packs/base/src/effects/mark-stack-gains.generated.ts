// Reviewed native behavior; edit this TypeScript source directly.
import {
  EffectTrigger,
  compileEffect,
  defineEffect,
  conditions,
  contexts,
  targets,
  ops,
  actions,
  type EffectFrame,
} from '@arcadia-eternity/battle/v4/authoring'
export function createGeneratedMarkStackGains() {
  return Object.freeze({
    effect_mark_add_stack_on_turn_end: compileEffect(
      defineEffect({
        id: 'effect_mark_add_stack_on_turn_end',
        triggers: [EffectTrigger.TurnEnd],
        priority: 0,
        when: conditions.ownerIsActive,
        apply: actions.sequence(targets.sourceMark.apply(ops.addStacks(1))),
      }),
    ),
    effect_mark_stack_mark_with_damage: compileEffect(
      defineEffect({
        id: 'effect_mark_stack_mark_with_damage',
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, (ctx: EffectFrame) => {
          const left = ctx.read(contexts.damage.select(event => event.damageResult).first())
          const right = 0
          return left !== undefined && right !== undefined && left > right
        }),
        apply: actions.sequence(
          targets.sourceMark.apply(
            ops.addStacks(
              contexts.damage
                .select(event => event.damageResult)
                .first()
                .map(n => Math.floor(n * 0.5)),
            ),
          ),
        ),
      }),
    ),
  })
}
export const generatedMarkStackGains = createGeneratedMarkStackGains()
