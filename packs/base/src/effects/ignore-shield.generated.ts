// Reviewed native behavior; edit this TypeScript source directly.
import {
  defineEffects,
  EffectTrigger,
  conditions,
  contexts,
  targets,
  checks,
  ops,
  actions,
} from '@arcadia-eternity/battle/authoring'
export function createGeneratedIgnoreShield() {
  return defineEffects({
    effect_skill_ignore_opponent_shield_if_has_shunliu: {
      triggers: [EffectTrigger.AfterUseSkillCheck],
      priority: 0,
      when: conditions.all(
        conditions.selfUsesSkill,
        targets.ownerMarks.where(mark => mark.baseId === 'mark_shunliu').condition(checks.exists()),
      ),
      apply: actions.sequence(contexts.skillUse.apply(ops.setIgnoreShield())),
    },
  })
}
export const generatedIgnoreShield = createGeneratedIgnoreShield()
