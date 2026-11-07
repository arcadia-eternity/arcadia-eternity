import {
  EffectTrigger,
  compileEffect,
  conditions,
  contexts,
  defineEffect,
  ops,
  targets,
} from '@arcadia-eternity/battle/v4/authoring'

/** Legacy randomPick(1) fully shuffles the affordable pool, then selects its first member. */
export function createRandomSkillSelection() {
  const build = (id: string, exclude?: string) =>
    compileEffect(
      defineEffect({
        id,
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.sourceOwnsEvent,
        apply: contexts.skillUse.apply(
          ops.setSkill(
            targets.selfAvailableSkills
              .where(skill => skill.baseId !== exclude)
              .shuffled()
              .first(),
            true,
          ),
        ),
      }),
    )
  return Object.freeze({
    effect_mark_random_use_skill: build('effect_mark_random_use_skill'),
    effect_mark_random_use_skill_except_jingshenshikong: build(
      'effect_mark_random_use_skill_except_jingshenshikong',
      'skill_jingshenshikong',
    ),
  })
}
