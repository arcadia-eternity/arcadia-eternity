import {
  EffectTrigger,
  checks,
  compileEffect,
  conditions,
  contexts,
  defineEffect,
  numberParam,
  ops,
  targets,
  values,
} from '@arcadia-eternity/battle/v4/authoring'

/** Explicit corrections to the source's reactive-object delta and premature skill-check trigger. */
export function createStackDamageEffects() {
  const damagePerStack = numberParam({ default: 30 })
  const inverseCurrent = targets.ownerMarks.where(mark => mark.baseId === 'mark_niliu')
  return Object.freeze({
    effect_mark_special_damage_reduction_with_stack: compileEffect(
      defineEffect({
        id: 'effect_mark_special_damage_reduction_with_stack',
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          contexts.damage.condition((_ctx, events) => events[0]?.damageType === 'Special'),
        ),
        apply: contexts.damage.apply(
          ops.modifyDamage({
            percent: 0,
            delta: targets.sourceMark
              .first()
              .attribute('stack')
              .map(stack => -stack),
          }),
        ),
      }),
    ),
    effect_skill_add_damage_30_per_niliu: compileEffect(
      defineEffect({
        id: 'effect_skill_add_damage_30_per_niliu',
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        parameters: { damagePerStack },
        when: conditions.all(conditions.selfUsesSkill, inverseCurrent.condition(checks.exists())),
        apply: contexts.damage.apply(
          ops.modifyDamage({
            percent: 0,
            delta: values.combine(inverseCurrent.first().attribute('stack'), damagePerStack, (stack, amount) =>
              Math.floor(stack * amount),
            ),
          }),
        ),
      }),
    ),
  })
}
