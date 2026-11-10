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
@effectGroup({ id: 'mark-stack-gains.generated' })
export class MarkStackGainsGeneratedEffects {
  static build() {
    return defineEffects({
      effect_mark_add_stack_on_turn_end: {
        triggers: [EffectTrigger.TurnEnd],
        priority: 0,
        when: conditions.ownerIsActive,
        apply: actions.sequence(targets.sourceMark.apply(ops.addStacks(1))),
      },
      effect_mark_stack_mark_with_damage: {
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
      },
    })
  }
}

export const generatedMarkStackGains = MarkStackGainsGeneratedEffects.build()
