// Reviewed native behavior; edit this TypeScript source directly.
import {
  EffectTrigger,
  compileEffect,
  defineEffect,
  targets,
  ops,
  actions,
} from '@arcadia-eternity/battle/v4/authoring'
export function createGeneratedSkillContributions() {
  return Object.freeze({
    effect_ability_add_self_skill_accuracy_5: compileEffect(
      defineEffect({
        id: 'effect_ability_add_self_skill_accuracy_5',
        triggers: [EffectTrigger.OnBattleStart],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.selfSkills.apply(
            ops.addSkillAttributeModifier('accuracy', 'delta', 5, { lifetime: 'sourceMarkOrTargetSkill' }),
          ),
        ),
      }),
    ),
    effect_ability_reduce_rage_cost_5: compileEffect(
      defineEffect({
        id: 'effect_ability_reduce_rage_cost_5',
        triggers: [EffectTrigger.OnBattleStart],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.selfSkills
            .where(skill => (skill.category as string) !== 'Climax')
            .apply(ops.addSkillAttributeModifier('rage', 'delta', -5, { lifetime: 'sourceMarkOrTargetSkill' })),
        ),
      }),
    ),
    effect_emblem_huashen_skill_rage_cost_reduce_5: compileEffect(
      defineEffect({
        id: 'effect_emblem_huashen_skill_rage_cost_reduce_5',
        triggers: [EffectTrigger.OnBattleStart],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.selfSkills
            .where(skill => skill.tags.includes('huashen'))
            .apply(ops.addSkillAttributeModifier('rage', 'delta', -5, { lifetime: 'sourceMarkOrTargetSkill' })),
        ),
      }),
    ),
    effect_emblem_no_rage_cost_for_fasi_skills: compileEffect(
      defineEffect({
        id: 'effect_emblem_no_rage_cost_for_fasi_skills',
        triggers: [EffectTrigger.OnBattleStart],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.selfSkills
            .where(skill => skill.tags.includes('fasi'))
            .apply(ops.addSkillAttributeModifier('rage', 'override', 0, { lifetime: 'sourceMarkOrTargetSkill' })),
        ),
      }),
    ),
    effect_emblem_reduce_light_skill_rage_cost_5: compileEffect(
      defineEffect({
        id: 'effect_emblem_reduce_light_skill_rage_cost_5',
        triggers: [EffectTrigger.OnBattleStart],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.selfSkills
            .where(skill => (skill.element as string) === 'Light')
            .where(skill => (skill.category as string) !== 'Climax')
            .apply(ops.addSkillAttributeModifier('rage', 'delta', -5, { lifetime: 'sourceMarkOrTargetSkill' })),
        ),
      }),
    ),
    effect_emblem_shahezhiguang_power_boost_10_percent: compileEffect(
      defineEffect({
        id: 'effect_emblem_shahezhiguang_power_boost_10_percent',
        triggers: [EffectTrigger.OnBattleStart],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.selfSkills
            .where(skill => (skill.baseId as string) === 'skill_shahezhili')
            .apply(ops.addSkillAttributeModifier('power', 'percent', 10, { lifetime: 'sourceMarkOrTargetSkill' })),
        ),
      }),
    ),
    effect_emblem_ziwocuimian_priority_plus_1: compileEffect(
      defineEffect({
        id: 'effect_emblem_ziwocuimian_priority_plus_1',
        triggers: [EffectTrigger.OnBattleStart],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.selfSkills
            .where(skill => (skill.baseId as string) === 'skill_ziwocuimian')
            .apply(ops.addSkillAttributeModifier('priority', 'delta', 1, { lifetime: 'sourceMarkOrTargetSkill' })),
        ),
      }),
    ),
    effect_mark_amplify_all_skill_power_2: compileEffect(
      defineEffect({
        id: 'effect_mark_amplify_all_skill_power_2',
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.selfSkills
            .where(skill => (skill.category as string) !== 'Status')
            .apply(ops.addSkillAttributeModifier('power', 'percent', 100, { lifetime: 'sourceMarkOrTargetSkill' })),
        ),
      }),
    ),
    effect_mark_amplify_electric_skill_70: compileEffect(
      defineEffect({
        id: 'effect_mark_amplify_electric_skill_70',
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.selfSkills
            .where(skill => (skill.category as string) !== 'Status')
            .where(skill => (skill.element as string) === 'Electric')
            .apply(ops.addSkillAttributeModifier('power', 'percent', 70, { lifetime: 'sourceMarkOrTargetSkill' })),
        ),
      }),
    ),
    effect_mark_amplify_power_20x_stack: compileEffect(
      defineEffect({
        id: 'effect_mark_amplify_power_20x_stack',
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.selfSkills
            .where(skill => (skill.category as string) !== 'Status')
            .apply(
              ops.bindSkillAttribute({
                key: 'action0_value_binding',
                attribute: 'power',
                operation: 'delta',
                value: targets.sourceMark
                  .first()
                  .capture({ key: 'source', scope: 'binding' })
                  .attribute('stack')
                  .follow({ key: 'stack' })
                  .map(stack => Math.floor(stack * 20)),
                stacking: 'append',
                lifetime: 'sourceMark',
                missing: 'detach',
              }),
            ),
        ),
      }),
    ),
    effect_mark_anyingzhiguang_power_min_100: compileEffect(
      defineEffect({
        id: 'effect_mark_anyingzhiguang_power_min_100',
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.selfSkills
            .where(skill => (skill.category as string) !== 'Status')
            .where(skill => skill.power < 100)
            .apply(ops.addSkillAttributeModifier('power', 'override', 100, { lifetime: 'sourceMarkOrTargetSkill' })),
        ),
      }),
    ),
    effect_mark_priority_add_1: compileEffect(
      defineEffect({
        id: 'effect_mark_priority_add_1',
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.selfSkills.apply(
            ops.addSkillAttributeModifier('priority', 'delta', 1, { lifetime: 'sourceMarkOrTargetSkill' }),
          ),
        ),
      }),
    ),
    effect_mark_priority_reduce_1: compileEffect(
      defineEffect({
        id: 'effect_mark_priority_reduce_1',
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.selfSkills.apply(
            ops.addSkillAttributeModifier('priority', 'delta', -1, { lifetime: 'sourceMarkOrTargetSkill' }),
          ),
        ),
      }),
    ),
    effect_skill_lock_rage_to_10: compileEffect(
      defineEffect({
        id: 'effect_skill_lock_rage_to_10',
        triggers: [EffectTrigger.OnBattleStart],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.sourceSkill.apply(
            ops.addSkillAttributeModifier('rage', 'override', 10, { lifetime: 'sourceMarkOrTargetSkill' }),
          ),
        ),
      }),
    ),
  })
}
export const generatedSkillContributions = createGeneratedSkillContributions()
