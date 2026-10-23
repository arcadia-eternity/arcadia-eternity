// Reviewed native behavior; edit this TypeScript source directly.
import {
  compileEffect,
  defineEffect,
  conditions,
  contexts,
  targets,
  checks,
  ops,
  actions,
} from '@arcadia-eternity/battle/v4/authoring'
export function createGeneratedIgnoreShield() {
  return Object.freeze({
    effect_skill_ignore_opponent_shield_if_has_shunliu: compileEffect(
      defineEffect({
        id: 'effect_skill_ignore_opponent_shield_if_has_shunliu',
        on: 'AfterUseSkillCheck',
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shunliu').condition(checks.exists()),
        ),
        execute: actions.sequence(contexts.skillUse.apply(ops.setIgnoreShield())),
      }),
    ),
  })
}
export const generatedIgnoreShield = createGeneratedIgnoreShield()
