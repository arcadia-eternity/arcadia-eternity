import {
  EffectTrigger,
  compileEffect,
  conditions,
  contexts,
  defineEffect,
  ops,
  targets,
} from '@arcadia-eternity/battle/v4/authoring'

/** Restore the most recently installed transformation after this instance finishes its skill use. */
export function createSkillTransformationRemoval() {
  return compileEffect(
    defineEffect({
      id: 'effect_skill_clear_transform_when_use',
      triggers: [EffectTrigger.SkillUseEnd],
      priority: 5,
      when: conditions.selfUsesSkill,
      apply: targets.sourceSkill.apply(ops.removeSkillTransformation()),
    }),
  )
}

/** C09/C19: select the used skill instance and its actual prototype, not a string identifier. */
export function createSkillTransformationCopy() {
  return compileEffect(
    defineEffect({
      id: 'effect_skill_change_to_used_skill',
      triggers: [EffectTrigger.AfterUseSkillCheck],
      priority: 0,
      when: conditions.all(
        conditions.sourceOwnsEvent,
        targets.sourceSkill.condition((ctx, skills) => {
          const used = contexts.nearestSkillUse(ctx)?.skill
          return skills[0] !== used
        }),
      ),
      apply: targets.sourceSkill.apply(ops.transformSkill(contexts.skillUse.select(use => use.skill.base).first())),
    }),
  )
}
