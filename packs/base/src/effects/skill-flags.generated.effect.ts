import { effectGroup } from '@arcadia-eternity/battle/effect-loading'
// Reviewed native behavior; edit this TypeScript source directly.
import {
  defineEffects,
  EffectTrigger,
  conditions,
  targets,
  checks,
  ops,
  actions,
} from '@arcadia-eternity/battle/authoring'
@effectGroup({ id: 'skill-flags.generated' })
export class SkillFlagsGeneratedEffects {
  static build() {
    return defineEffects({
      effect_ability_multi_hit_skills_sure_hit: {
        triggers: [EffectTrigger.OnBattleStart],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.selfSkills
            .where(skill => (Array.isArray(skill.multihit) ? skill.multihit[0] : skill.multihit) !== 1)
            .apply(ops.setSkillSureHit(true)),
        ),
      },
      effect_emblem_fenshenshu_set_sure_hit: {
        triggers: [EffectTrigger.OnBattleStart],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.selfSkills
            .where(skill => (skill.baseId as string) === 'skill_fenshenshu')
            .apply(ops.setSkillSureHit(true)),
        ),
      },
      effect_emblem_jihuo_fire_skill_sure_hit: {
        triggers: [EffectTrigger.OnBattleStart],
        priority: 0,
        when: conditions.all(
          targets.selfSkills.where(skill => (skill.element as string) === 'Fire').condition(checks.exists()),
        ),
        apply: actions.sequence(
          targets.selfSkills.where(skill => (skill.element as string) === 'Fire').apply(ops.setSkillSureHit(true)),
        ),
      },
      effect_emblem_pofangyiji_sure_hit: {
        triggers: [EffectTrigger.OnBattleStart],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.selfSkills
            .where(skill => (skill.baseId as string) === 'skill_pofangyiji')
            .apply(ops.setSkillSureHit(true)),
        ),
      },
      effect_emblem_skill_kaowenzhe_sure_hit: {
        triggers: [EffectTrigger.OnBattleStart],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.selfSkills
            .where(skill => (skill.baseId as string) === 'skill_kaowenzhe')
            .apply(ops.setSkillSureHit(true)),
        ),
      },
      effect_emblem_skill_tongjiling_sure_hit: {
        triggers: [EffectTrigger.OnBattleStart],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.selfSkills
            .where(skill => (skill.baseId as string) === 'skill_tongjiling')
            .apply(ops.setSkillSureHit(true)),
        ),
      },
    })
  }
}

export const generatedSkillFlags = SkillFlagsGeneratedEffects.build()
