import { compileEffect, conditions, contexts, defineEffect, numberParam, ops, values } from '../content/authoring'

/** C09: the used instance is UseSkillContext.skill, not skillId. */
export function createEmblemSkillCost() {
  const reduction = numberParam({ default: 5 })
  return compileEffect(
    defineEffect({
      id: 'effect_emblem_yinji_reduce_rage_cost_xinzhiyinji',
      on: 'BeforeUseSkillCheck',
      priority: 0,
      parameters: { reduction },
      when: conditions.all(
        conditions.sourceOwnsEvent,
        contexts.skillUse.condition((_ctx, uses) =>
          uses.some(use => ['skill_xinzhiyinji', 'skill_xuehongyinji'].includes(use.skill.baseId)),
        ),
      ),
      execute: contexts.skillUse
        .property('rage')
        .apply(
          ops.assign(
            values.combine(contexts.skillUse.select(use => use.rage).first(), reduction, (rage, amount) =>
              Math.max(0, rage - amount),
            ),
          ),
        ),
    }),
  )
}
