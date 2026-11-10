import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'
import { Effect } from '@arcadia-eternity/battle/engine'
import { EffectTrigger } from '@arcadia-eternity/const'
import { compileEffect, conditions, ops, selectFrom, targets } from '@arcadia-eternity/battle/authoring'

export const randomTemporaryEffectDependencies = Object.freeze([
  'effect_skill_add_mark_shanbi_below_1_8_hp',
  'effect_skill_add_mark_both_shanghaizengjia_50',
  'effect_skill_add_mark_opponent_mingzhongxiajiang_15',
  'effect_skill_priority_plus_1',
] as const)

/** Phase-scoped selection; admission does not replay the trigger currently being dispatched. */
@effectGroup({
  id: 'random-temporary-effect',
  dependsOn: ['compound-actions.generated', 'mark-applications.generated', 'skill-numeric-references.generated'],
})
export class RandomTemporaryEffectEffects {
  static build(context: Pick<EffectLoadingContext, 'effects'>) {
    const effects = context.effects

    const choices = randomTemporaryEffectDependencies.map(id => {
      const effect = effects.get(id)
      if (!(effect instanceof Effect) || effect.id !== id)
        throw new Error(`Missing or mismatched native effect dependency: ${id}`)
      return effect
    })
    return compileEffect({
      id: 'effect_skill_random_xifa_effect',
      triggers: [EffectTrigger.BeforeSort],
      priority: 100,
      when: conditions.selfUsesSkill,
      apply: targets.sourceSkill.apply(ops.addTemporaryEffect(selectFrom(choices).shuffled().first())),
    })
  }
}
