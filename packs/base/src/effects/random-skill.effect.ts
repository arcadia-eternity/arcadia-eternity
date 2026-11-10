import { effectGroup } from '@arcadia-eternity/battle/effect-loading'
import { defineEffects, EffectTrigger, conditions, contexts, ops, targets } from '@arcadia-eternity/battle/authoring'

/** Legacy randomPick(1) fully shuffles the affordable pool, then selects its first member. */
@effectGroup({ id: 'random-skill' })
export class RandomSkillEffects {
  static build() {
    const build = (exclude?: string) => ({
      triggers: [EffectTrigger.BeforeUseSkillCheck] as const,
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
    })
    return defineEffects({
      effect_mark_random_use_skill: build(),
      effect_mark_random_use_skill_except_jingshenshikong: build('skill_jingshenshikong'),
    })
  }
}
