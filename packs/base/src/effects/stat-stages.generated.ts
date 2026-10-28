// Reviewed native behavior; edit this TypeScript source directly.
import {
  numberParam,
  compileEffect,
  defineEffect,
  conditions,
  contexts,
  targets,
  checks,
  ops,
  type EffectFrame,
} from '@arcadia-eternity/battle/v4/authoring'
import { Type } from '@sinclair/typebox'
import { EffectTrigger, StatTypeWithoutHp, type effectId } from '@arcadia-eternity/const'
import { UseSkillContext, type EffectContext } from '@arcadia-eternity/battle/v4'
import { Pet } from '@arcadia-eternity/battle/v4'
import { SkillInstance } from '@arcadia-eternity/battle/v4'
import { MarkInstanceImpl } from '@arcadia-eternity/battle/v4'
import { ConfigModifierType } from '@arcadia-eternity/battle/v4'
import { defineNativeEffect } from '@arcadia-eternity/battle/v4'
import { defineParameter, parameterAddress, ParameterCatalog } from '@arcadia-eternity/battle/v4'
function selfUsesSkill(context: EffectContext<EffectTrigger>) {
  return (
    context.parent instanceof UseSkillContext &&
    context.source.owner === context.parent.pet &&
    (context.source instanceof SkillInstance
      ? context.source === context.parent.skill
      : context.source instanceof MarkInstanceImpl)
  )
}
function roll(context: EffectContext<EffectTrigger>, percent: number) {
  return context.battle.random() < percent / 100
}
const p0 = defineParameter({
  address: parameterAddress('effect_skill_raise_atk_1_stage_10_percent', 'condition/1/1', 'percent'),
  schema: Type.Number({ default: 10 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p1 = defineParameter({
  address: parameterAddress('effect_skill_raise_atk_1_stage_15_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 15 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p2 = defineParameter({
  address: parameterAddress('effect_skill_raise_atk_1_stage_20_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 20 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p3 = defineParameter({
  address: parameterAddress('effect_skill_raise_atk_1_stage_5_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 5 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p4 = defineParameter({
  address: parameterAddress('effect_skill_raise_atk_20_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 20 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p5 = defineParameter({
  address: parameterAddress('effect_skill_raise_def_1_stage_20_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 20 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p6 = defineParameter({
  address: parameterAddress('effect_skill_raise_spa_1_stage_10_percent', 'condition/1/1', 'percent'),
  schema: Type.Number({ default: 10 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p7 = defineParameter({
  address: parameterAddress('effect_skill_raise_spa_1_stage_15_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 15 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p8 = defineParameter({
  address: parameterAddress('effect_skill_raise_spa_1_stage_20_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 20 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p9 = defineParameter({
  address: parameterAddress('effect_skill_raise_spd_1_stage_20_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 20 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p10 = defineParameter({
  address: parameterAddress('effect_skill_raise_spe_1_stage_10_percent', 'condition/1/1', 'percent'),
  schema: Type.Number({ default: 10 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p11 = defineParameter({
  address: parameterAddress('effect_skill_raise_spe_1_stage_20_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 20 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p12 = defineParameter({
  address: parameterAddress('effect_skill_raise_spe_1_stage_5_percent', 'condition/1/1', 'percent'),
  schema: Type.Number({ default: 5 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p13 = defineParameter({
  address: parameterAddress('effect_skill_raise_spe_1_stage_50_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 50 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: ['effect_skill_raise_spe_1_stage_50_percent.probability'],
})
const p14 = defineParameter({
  address: parameterAddress('effect_skill_raise_spe_20_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 20 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p15 = defineParameter({
  address: parameterAddress('effect_skill_raise_spe_70_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 70 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p16 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_atk_1_stage_10_percent', 'condition/1/1', 'percent'),
  schema: Type.Number({ default: 10 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p17 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_atk_1_stage_15_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 15 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p18 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_atk_1_stage_20_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 20 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p19 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_atk_1_stage_30_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 30 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p20 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_atk_1_stage_5_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 5 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p21 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_def_1_stage_10_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 10 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p22 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_def_1_stage_15_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 15 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p23 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_def_1_stage_20_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 20 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p24 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_def_1_stage_35_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 35 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p25 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_def_1_stage_5_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 5 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p26 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_def_1_stage_50_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 50 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: ['effect_skill_reduce_opponent_def_1_stage_50_percent.probability'],
})
const p27 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_spa_1_stage_10_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 10 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p28 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_spa_1_stage_15_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 15 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p29 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_spa_1_stage_20_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 20 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p30 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_spa_1_stage_5_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 5 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p31 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_spd_1_stage_10_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 10 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p32 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_spd_1_stage_15_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 15 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p33 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_spd_1_stage_20_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 20 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p34 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_spd_1_stage_25_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 25 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p35 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_spd_1_stage_30_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 30 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p36 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_spd_1_stage_5_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 5 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p37 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_spd_1_stage_50_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 50 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: ['effect_skill_reduce_opponent_spd_1_stage_50_percent.probability'],
})
const p38 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_spe_1_stage_15_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 15 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p39 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_spe_1_stage_20_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 20 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p40 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_spe_1_stage_35_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 35 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const p41 = defineParameter({
  address: parameterAddress('effect_skill_reduce_opponent_spe_1_stage_5_percent', 'condition/1', 'percent'),
  schema: Type.Number({ default: 5 }),
  effectiveSchema: Type.Number(),
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  tags: ['skill_effect_probability'],
  aliases: [],
})
const parameters = new ParameterCatalog([
  p0,
  p1,
  p2,
  p3,
  p4,
  p5,
  p6,
  p7,
  p8,
  p9,
  p10,
  p11,
  p12,
  p13,
  p14,
  p15,
  p16,
  p17,
  p18,
  p19,
  p20,
  p21,
  p22,
  p23,
  p24,
  p25,
  p26,
  p27,
  p28,
  p29,
  p30,
  p31,
  p32,
  p33,
  p34,
  p35,
  p36,
  p37,
  p38,
  p39,
  p40,
  p41,
])
export const generatedStatStageCandidates = Object.freeze({
  parameters,
  effects: Object.freeze({
    effect_ability_enhance_atk_when_spa_enhanced: compileEffect(
      defineEffect({
        id: 'effect_ability_enhance_atk_when_spa_enhanced',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(conditions.ownerAddsMark, conditions.statStageChange('spa', 'up')),
        apply: targets.ownerPet.apply(
          ops.changeStatStage('atk', contexts.addMark.select(event => event.stack).first()),
        ),
      }),
    ),
    effect_ability_raise_spe_1_stage_when_dodge: compileEffect(
      defineEffect({
        id: 'effect_ability_raise_spe_1_stage_when_dodge',
        triggers: [EffectTrigger.OnMiss],
        priority: 0,
        when: conditions.ownerIsSkillTarget,
        apply: targets.ownerPet.apply(ops.changeStatStage('spe', 1)),
      }),
    ),
    effect_emblem_raise_spd_1_stage_when_baonuan_20_percent: compileEffect(
      defineEffect({
        id: 'effect_emblem_raise_spd_1_stage_when_baonuan_20_percent',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_ctx, events) => events[0]?.skill.baseId === 'skill_baonuan'),
          conditions.chance(20),
        ),
        apply: targets.ownerPet.apply(ops.changeStatStage('spd', 1)),
      }),
    ),
    effect_emblem_raise_spd_1_stage_when_rouruan_20_percent: compileEffect(
      defineEffect({
        id: 'effect_emblem_raise_spd_1_stage_when_rouruan_20_percent',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_ctx, events) => events[0]?.skill.baseId === 'skill_rouruan'),
          conditions.chance(20),
        ),
        apply: targets.ownerPet.apply(ops.changeStatStage('spd', 1)),
      }),
    ),
    effect_mark_reduce_opponent_atk_1_stage_when_fainted: compileEffect(
      defineEffect({
        id: 'effect_mark_reduce_opponent_atk_1_stage_when_fainted',
        triggers: [EffectTrigger.OnDefeat],
        priority: 0,
        when: conditions.ownerIsSkillTarget,
        apply: targets.opponentActive.apply(ops.changeStatStage('atk', -1)),
      }),
    ),
    effect_mark_reduce_opponent_spe_1_stage_when_fainted: compileEffect(
      defineEffect({
        id: 'effect_mark_reduce_opponent_spe_1_stage_when_fainted',
        triggers: [EffectTrigger.OnDefeat],
        priority: 0,
        when: conditions.ownerIsSkillTarget,
        apply: targets.opponentActive.apply(ops.changeStatStage('spe', -1)),
      }),
    ),
    effect_skill_raise_atk_1_stage: defineNativeEffect({
      id: 'effect_skill_raise_atk_1_stage' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context)
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.atk, 1)
      },
    }),
    effect_skill_raise_atk_1_stage_10_percent: defineNativeEffect({
      id: 'effect_skill_raise_atk_1_stage_10_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) &&
          selfUsesSkill(context) &&
          roll(context, parameters.read(context.battle.configSystem, p0, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.atk, 1)
      },
    }),
    effect_skill_raise_atk_1_stage_15_percent: defineNativeEffect({
      id: 'effect_skill_raise_atk_1_stage_15_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p1, context.source))
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.atk, 1)
      },
    }),
    effect_skill_raise_atk_1_stage_20_percent: defineNativeEffect({
      id: 'effect_skill_raise_atk_1_stage_20_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p2, context.source))
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.atk, 1)
      },
    }),
    effect_skill_raise_atk_1_stage_5_percent: defineNativeEffect({
      id: 'effect_skill_raise_atk_1_stage_5_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p3, context.source))
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.atk, 1)
      },
    }),
    effect_skill_raise_atk_1_stage_after_2_uses: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_atk_1_stage_after_2_uses',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.everyNthUse(2)),
        apply: targets.ownerPet.apply(ops.changeStatStage('atk', 1)),
      }),
    ),
    effect_skill_raise_atk_1_stage_if_anyinglingyu: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_atk_1_stage_if_anyinglingyu',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_anyinglingyu').condition(checks.exists()),
        ),
        apply: targets.ownerPet.apply(ops.changeStatStage('atk', 1)),
      }),
    ),
    effect_skill_raise_atk_1_stage_if_has_shunliu: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_atk_1_stage_if_has_shunliu',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shunliu').condition(checks.exists()),
        ),
        apply: targets.ownerPet.apply(ops.changeStatStage('atk', 1)),
      }),
    ),
    effect_skill_raise_atk_1_stage_if_opponent_male: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_atk_1_stage_if_opponent_male',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) => pets.some(pet => pet.gender === 'Male')),
        ),
        apply: targets.ownerPet.apply(ops.changeStatStage('atk', 1)),
      }),
    ),
    effect_skill_raise_atk_1_stage_on_crit: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_atk_1_stage_on_crit',
        triggers: [EffectTrigger.OnCritPreDamage],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.changeStatStage('atk', 1)),
      }),
    ),
    effect_skill_raise_atk_2_stage_if_male: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_atk_2_stage_if_male',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerPet.condition((_ctx, pets) => pets.some(pet => pet.gender === 'Male')),
        ),
        apply: targets.ownerPet.apply(ops.changeStatStage('atk', 2)),
      }),
    ),
    effect_skill_raise_atk_2_stages: defineNativeEffect({
      id: 'effect_skill_raise_atk_2_stages' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context)
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.atk, 2)
      },
    }),
    effect_skill_raise_atk_20_percent: defineNativeEffect({
      id: 'effect_skill_raise_atk_20_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p4, context.source))
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.atk, 1)
      },
    }),
    effect_skill_raise_def_1_stage: defineNativeEffect({
      id: 'effect_skill_raise_def_1_stage' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context)
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.def, 1)
      },
    }),
    effect_skill_raise_def_1_stage_20_percent: defineNativeEffect({
      id: 'effect_skill_raise_def_1_stage_20_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p5, context.source))
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.def, 1)
      },
    }),
    effect_skill_raise_def_1_stage_after_2_uses: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_def_1_stage_after_2_uses',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.everyNthUse(2)),
        apply: targets.ownerPet.apply(ops.changeStatStage('def', 1)),
      }),
    ),
    effect_skill_raise_def_1_stage_if_aideminyi: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_def_1_stage_if_aideminyi',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_aideminyi').condition(checks.exists()),
        ),
        apply: targets.ownerPet.apply(ops.changeStatStage('def', 1)),
      }),
    ),
    effect_skill_raise_def_1_stage_if_has_shunliu: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_def_1_stage_if_has_shunliu',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shunliu').condition(checks.exists()),
        ),
        apply: targets.ownerPet.apply(ops.changeStatStage('def', 1)),
      }),
    ),
    effect_skill_raise_def_1_stage_if_opponent_has_kaowen: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_def_1_stage_if_opponent_has_kaowen',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_kaowen')),
          ),
        ),
        apply: targets.ownerPet.apply(ops.changeStatStage('def', 1)),
      }),
    ),
    effect_skill_raise_def_2_stages: defineNativeEffect({
      id: 'effect_skill_raise_def_2_stages' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context)
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.def, 2)
      },
    }),
    effect_skill_raise_self_spa_1_stage_if_3_hits: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_self_spa_1_stage_if_3_hits',
        triggers: [EffectTrigger.BeforeMultiHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(contexts.skillUse.select(event => event.multihitResult).first())
          const right = 3
          return left !== undefined && right !== undefined && left === right
        }),
        apply: targets.ownerPet.apply(ops.changeStatStage('spa', 1)),
      }),
    ),
    effect_skill_raise_self_spa_2_stage_if_has_shijianfaze: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_self_spa_2_stage_if_has_shijianfaze',
        triggers: [EffectTrigger.BeforeHit],
        priority: -1,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shijianfaze').condition(checks.exists()),
        ),
        apply: targets.ownerPet.apply(ops.changeStatStage('spa', 2)),
      }),
    ),
    effect_skill_raise_spa_1_stage: defineNativeEffect({
      id: 'effect_skill_raise_spa_1_stage' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context)
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.spa, 1)
      },
    }),
    effect_skill_raise_spa_1_stage_10_percent: defineNativeEffect({
      id: 'effect_skill_raise_spa_1_stage_10_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) &&
          selfUsesSkill(context) &&
          roll(context, parameters.read(context.battle.configSystem, p6, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.spa, 1)
      },
    }),
    effect_skill_raise_spa_1_stage_15_percent: defineNativeEffect({
      id: 'effect_skill_raise_spa_1_stage_15_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p7, context.source))
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.spa, 1)
      },
    }),
    effect_skill_raise_spa_1_stage_20_percent: defineNativeEffect({
      id: 'effect_skill_raise_spa_1_stage_20_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p8, context.source))
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.spa, 1)
      },
    }),
    effect_skill_raise_spa_1_stage_after_2_uses: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_spa_1_stage_after_2_uses',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.everyNthUse(2)),
        apply: targets.ownerPet.apply(ops.changeStatStage('spa', 1)),
      }),
    ),
    effect_skill_raise_spa_1_stage_if_has_niliu: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_spa_1_stage_if_has_niliu',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_niliu').condition(checks.exists()),
        ),
        apply: targets.ownerPet.apply(ops.changeStatStage('spa', 1)),
      }),
    ),
    effect_skill_raise_spa_1_stage_if_hp_lt_half: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_spa_1_stage_if_hp_lt_half',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.currentHp).first())
          const right = ctx.read(
            targets.ownerPet
              .select(pet => pet.stat.maxHp)
              .first()
              .map(n => Math.floor(n * 0.5)),
          )
          return left !== undefined && right !== undefined && left < right
        }),
        apply: targets.ownerPet.apply(ops.changeStatStage('spa', 1)),
      }),
    ),
    effect_skill_raise_spa_1_stage_if_shuiliangbaohe: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_spa_1_stage_if_shuiliangbaohe',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shuiliangbaohe').condition(checks.exists()),
        ),
        apply: targets.ownerPet.apply(ops.changeStatStage('spa', 1)),
      }),
    ),
    effect_skill_raise_spa_2_stage_if_female: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_spa_2_stage_if_female',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerPet.condition((_ctx, pets) => pets.some(pet => pet.gender === 'Female')),
        ),
        apply: targets.ownerPet.apply(ops.changeStatStage('spa', 2)),
      }),
    ),
    effect_skill_raise_spa_2_stages: defineNativeEffect({
      id: 'effect_skill_raise_spa_2_stages' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context)
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.spa, 2)
      },
    }),
    effect_skill_raise_spd_1_stage: defineNativeEffect({
      id: 'effect_skill_raise_spd_1_stage' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context)
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.spd, 1)
      },
    }),
    effect_skill_raise_spd_1_stage_20_percent: defineNativeEffect({
      id: 'effect_skill_raise_spd_1_stage_20_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p9, context.source))
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.spd, 1)
      },
    }),
    effect_skill_raise_spd_1_stage_after_2_uses: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_spd_1_stage_after_2_uses',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.everyNthUse(2)),
        apply: targets.ownerPet.apply(ops.changeStatStage('spd', 1)),
      }),
    ),
    effect_skill_raise_spd_1_stage_if_has_niliu: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_spd_1_stage_if_has_niliu',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_niliu').condition(checks.exists()),
        ),
        apply: targets.ownerPet.apply(ops.changeStatStage('spd', 1)),
      }),
    ),
    effect_skill_raise_spd_1_stage_if_opponent_has_tongjiling: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_spd_1_stage_if_opponent_has_tongjiling',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_tongjiling')),
          ),
        ),
        apply: targets.ownerPet.apply(ops.changeStatStage('spd', 1)),
      }),
    ),
    effect_skill_raise_spd_2_stages: defineNativeEffect({
      id: 'effect_skill_raise_spd_2_stages' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context)
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.spd, 2)
      },
    }),
    effect_skill_raise_spe_1_stage: defineNativeEffect({
      id: 'effect_skill_raise_spe_1_stage' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context)
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.spe, 1)
      },
    }),
    effect_skill_raise_spe_1_stage_10_percent: defineNativeEffect({
      id: 'effect_skill_raise_spe_1_stage_10_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) &&
          selfUsesSkill(context) &&
          roll(context, parameters.read(context.battle.configSystem, p10, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.spe, 1)
      },
    }),
    effect_skill_raise_spe_1_stage_20_percent: defineNativeEffect({
      id: 'effect_skill_raise_spe_1_stage_20_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p11, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.spe, 1)
      },
    }),
    effect_skill_raise_spe_1_stage_5_percent: defineNativeEffect({
      id: 'effect_skill_raise_spe_1_stage_5_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) &&
          selfUsesSkill(context) &&
          roll(context, parameters.read(context.battle.configSystem, p12, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.spe, 1)
      },
    }),
    effect_skill_raise_spe_1_stage_50_percent: defineNativeEffect({
      id: 'effect_skill_raise_spe_1_stage_50_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p13, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.spe, 1)
      },
    }),
    effect_skill_raise_spe_1_stage_after_2_uses: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_spe_1_stage_after_2_uses',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.everyNthUse(2)),
        apply: targets.ownerPet.apply(ops.changeStatStage('spe', 1)),
      }),
    ),
    effect_skill_raise_spe_1_stage_if_hp_below_75_percent: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_spe_1_stage_if_hp_below_75_percent',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.currentHp).first())
          const right = ctx.read(
            targets.ownerPet
              .select(pet => pet.stat.maxHp)
              .first()
              .map(n => Math.floor(n * 0.75)),
          )
          return left !== undefined && right !== undefined && left < right
        }),
        apply: targets.ownerPet.apply(ops.changeStatStage('spe', 1)),
      }),
    ),
    effect_skill_raise_spe_1_stage_if_opponent_female: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_spe_1_stage_if_opponent_female',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) => pets.some(pet => pet.gender === 'Female')),
        ),
        apply: targets.ownerPet.apply(ops.changeStatStage('spe', 1)),
      }),
    ),
    effect_skill_raise_spe_1_stage_if_opponent_has_tongjiling_on_defeated: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_spe_1_stage_if_opponent_has_tongjiling_on_defeated',
        triggers: [EffectTrigger.OnDefeat],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_tongjiling')),
          ),
        ),
        apply: targets.ownerPet.apply(ops.changeStatStage('spe', 1)),
      }),
    ),
    effect_skill_raise_spe_1_stage_if_zhandoulingyu: compileEffect(
      defineEffect({
        id: 'effect_skill_raise_spe_1_stage_if_zhandoulingyu',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_zhandoulingyu').condition(checks.exists()),
        ),
        apply: targets.ownerPet.apply(ops.changeStatStage('spe', 1)),
      }),
    ),
    effect_skill_raise_spe_2_stages: defineNativeEffect({
      id: 'effect_skill_raise_spe_2_stages' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context)
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.spe, 2)
      },
    }),
    effect_skill_raise_spe_20_percent: defineNativeEffect({
      id: 'effect_skill_raise_spe_20_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p14, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.spe, 1)
      },
    }),
    effect_skill_raise_spe_70_percent: defineNativeEffect({
      id: 'effect_skill_raise_spe_70_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p15, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = owner
        target.addStatStage(context, StatTypeWithoutHp.spe, 1)
      },
    }),
    effect_skill_reduce_opponent_atk_1_stage: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_atk_1_stage' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context)
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.atk, -1)
      },
    }),
    effect_skill_reduce_opponent_atk_1_stage_10_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_atk_1_stage_10_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) &&
          selfUsesSkill(context) &&
          roll(context, parameters.read(context.battle.configSystem, p16, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.atk, -1)
      },
    }),
    effect_skill_reduce_opponent_atk_1_stage_15_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_atk_1_stage_15_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p17, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.atk, -1)
      },
    }),
    effect_skill_reduce_opponent_atk_1_stage_20_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_atk_1_stage_20_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p18, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.atk, -1)
      },
    }),
    effect_skill_reduce_opponent_atk_1_stage_30_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_atk_1_stage_30_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p19, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.atk, -1)
      },
    }),
    effect_skill_reduce_opponent_atk_1_stage_5_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_atk_1_stage_5_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p20, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.atk, -1)
      },
    }),
    effect_skill_reduce_opponent_atk_1_stage_if_opponent_male: compileEffect(
      defineEffect({
        id: 'effect_skill_reduce_opponent_atk_1_stage_if_opponent_male',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) => pets.some(pet => pet.gender === 'Male')),
        ),
        apply: targets.opponentActive.apply(ops.changeStatStage('atk', -1)),
      }),
    ),
    effect_skill_reduce_opponent_def_1_stage: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_def_1_stage' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context)
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.def, -1)
      },
    }),
    effect_skill_reduce_opponent_def_1_stage_10_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_def_1_stage_10_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p21, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.def, -1)
      },
    }),
    effect_skill_reduce_opponent_def_1_stage_15_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_def_1_stage_15_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p22, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.def, -1)
      },
    }),
    effect_skill_reduce_opponent_def_1_stage_20_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_def_1_stage_20_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p23, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.def, -1)
      },
    }),
    effect_skill_reduce_opponent_def_1_stage_35_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_def_1_stage_35_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p24, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.def, -1)
      },
    }),
    effect_skill_reduce_opponent_def_1_stage_5_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_def_1_stage_5_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p25, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.def, -1)
      },
    }),
    effect_skill_reduce_opponent_def_1_stage_50_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_def_1_stage_50_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p26, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.def, -1)
      },
    }),
    effect_skill_reduce_opponent_def_1_stage_if_has_shunliu: compileEffect(
      defineEffect({
        id: 'effect_skill_reduce_opponent_def_1_stage_if_has_shunliu',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shunliu').condition(checks.exists()),
        ),
        apply: targets.opponentActive.apply(ops.changeStatStage('def', -1)),
      }),
    ),
    effect_skill_reduce_opponent_def_1_stage_if_rage_lt_30: compileEffect(
      defineEffect({
        id: 'effect_skill_reduce_opponent_def_1_stage_if_rage_lt_30',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.selfPlayer.select(player => player.currentRage).first())
          const right = 30
          return left !== undefined && right !== undefined && left < right
        }),
        apply: targets.opponentActive.apply(ops.changeStatStage('def', -1)),
      }),
    ),
    effect_skill_reduce_opponent_def_1_stage_if_wuzhezhixin: compileEffect(
      defineEffect({
        id: 'effect_skill_reduce_opponent_def_1_stage_if_wuzhezhixin',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_wuzhezhixin').condition(checks.exists()),
        ),
        apply: targets.opponentActive.apply(ops.changeStatStage('def', -1)),
      }),
    ),
    effect_skill_reduce_opponent_spa_1_stage: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_spa_1_stage' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context)
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.spa, -1)
      },
    }),
    effect_skill_reduce_opponent_spa_1_stage_10_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_spa_1_stage_10_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p27, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.spa, -1)
      },
    }),
    effect_skill_reduce_opponent_spa_1_stage_15_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_spa_1_stage_15_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p28, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.spa, -1)
      },
    }),
    effect_skill_reduce_opponent_spa_1_stage_20_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_spa_1_stage_20_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p29, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.spa, -1)
      },
    }),
    effect_skill_reduce_opponent_spa_1_stage_5_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_spa_1_stage_5_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p30, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.spa, -1)
      },
    }),
    effect_skill_reduce_opponent_spa_1_stage_if_bingdong: compileEffect(
      defineEffect({
        id: 'effect_skill_reduce_opponent_spa_1_stage_if_bingdong',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_bingdong')),
          ),
        ),
        apply: targets.opponentActive.apply(ops.changeStatStage('spa', -1)),
      }),
    ),
    effect_skill_reduce_opponent_spa_1_stage_if_has_niliu: compileEffect(
      defineEffect({
        id: 'effect_skill_reduce_opponent_spa_1_stage_if_has_niliu',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_niliu').condition(checks.exists()),
        ),
        apply: targets.opponentActive.apply(ops.changeStatStage('spa', -1)),
      }),
    ),
    effect_skill_reduce_opponent_spa_1_stage_if_opponent_female: compileEffect(
      defineEffect({
        id: 'effect_skill_reduce_opponent_spa_1_stage_if_opponent_female',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) => pets.some(pet => pet.gender === 'Female')),
        ),
        apply: targets.opponentActive.apply(ops.changeStatStage('spa', -1)),
      }),
    ),
    effect_skill_reduce_opponent_spa_1_stage_if_opponent_has_kaowen_and_last: compileEffect(
      defineEffect({
        id: 'effect_skill_reduce_opponent_spa_1_stage_if_opponent_has_kaowen_and_last',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_kaowen')),
          ),
          conditions.lastSkillThisTurn,
        ),
        apply: targets.opponentActive.apply(ops.changeStatStage('spa', -1)),
      }),
    ),
    effect_skill_reduce_opponent_spd_1_stage: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_spd_1_stage' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context)
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.spd, -1)
      },
    }),
    effect_skill_reduce_opponent_spd_1_stage_10_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_spd_1_stage_10_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p31, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.spd, -1)
      },
    }),
    effect_skill_reduce_opponent_spd_1_stage_15_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_spd_1_stage_15_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p32, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.spd, -1)
      },
    }),
    effect_skill_reduce_opponent_spd_1_stage_20_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_spd_1_stage_20_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p33, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.spd, -1)
      },
    }),
    effect_skill_reduce_opponent_spd_1_stage_25_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_spd_1_stage_25_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p34, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.spd, -1)
      },
    }),
    effect_skill_reduce_opponent_spd_1_stage_30_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_spd_1_stage_30_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p35, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.spd, -1)
      },
    }),
    effect_skill_reduce_opponent_spd_1_stage_5_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_spd_1_stage_5_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p36, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.spd, -1)
      },
    }),
    effect_skill_reduce_opponent_spd_1_stage_50_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_spd_1_stage_50_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p37, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.spd, -1)
      },
    }),
    effect_skill_reduce_opponent_spd_1_stage_consecutive_2_times: compileEffect(
      defineEffect({
        id: 'effect_skill_reduce_opponent_spd_1_stage_consecutive_2_times',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.everyNthUse(2)),
        apply: targets.opponentActive.apply(ops.changeStatStage('spd', -1)),
      }),
    ),
    effect_skill_reduce_opponent_spd_1_stage_if_renzhezhixin: compileEffect(
      defineEffect({
        id: 'effect_skill_reduce_opponent_spd_1_stage_if_renzhezhixin',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_renzhezhixin')),
          ),
        ),
        apply: targets.opponentActive.apply(ops.changeStatStage('spd', -1)),
      }),
    ),
    effect_skill_reduce_opponent_spe_1_stage: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_spe_1_stage' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context)
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.spe, -1)
      },
    }),
    effect_skill_reduce_opponent_spe_1_stage_15_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_spe_1_stage_15_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p38, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.spe, -1)
      },
    }),
    effect_skill_reduce_opponent_spe_1_stage_20_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_spe_1_stage_20_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p39, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.spe, -1)
      },
    }),
    effect_skill_reduce_opponent_spe_1_stage_35_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_spe_1_stage_35_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p40, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.spe, -1)
      },
    }),
    effect_skill_reduce_opponent_spe_1_stage_5_percent: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_spe_1_stage_5_percent' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return (
          selfUsesSkill(context) && roll(context, parameters.read(context.battle.configSystem, p41, context.source))
        )
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.spe, -1)
      },
    }),
    effect_skill_reduce_opponent_spe_2_stage_if_shijianfaze: compileEffect(
      defineEffect({
        id: 'effect_skill_reduce_opponent_spe_2_stage_if_shijianfaze',
        triggers: [EffectTrigger.BeforeHit],
        priority: -1,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shijianfaze').condition(checks.exists()),
        ),
        apply: targets.opponentActive.apply(ops.changeStatStage('spe', -2)),
      }),
    ),
    effect_skill_reduce_opponent_stat_1_stage: defineNativeEffect({
      id: 'effect_skill_reduce_opponent_stat_1_stage' as effectId,
      priority: 0,
      triggers: [EffectTrigger.BeforeHit],
      when(context) {
        return selfUsesSkill(context)
      },
      apply(context) {
        const owner = context.source.owner
        if (!(owner instanceof Pet)) return
        const target = context.battle.getOpponent(owner.owner!).activePet
        target.addStatStage(context, StatTypeWithoutHp.def, -1)
      },
    }),
    effect_skill_reduce_stat_5_percent: (() => {
      const parameters = {
        condition_1_percent: numberParam({ default: 5, tags: ['skill_effect_probability'], legacyAliases: [] }),
      }
      return compileEffect(
        defineEffect({
          id: 'effect_skill_reduce_stat_5_percent',
          triggers: [EffectTrigger.OnDamage],
          priority: 0,
          parameters,
          when: conditions.all(conditions.selfUsesSkill, conditions.chance(parameters.condition_1_percent)),
          apply: targets.opponentActive.apply(ops.changeStatStage('def', -1)),
        }),
      )
    })(),
    effect_skill_set_self_spa_to_atk: compileEffect(
      defineEffect({
        id: 'effect_skill_set_self_spa_to_atk',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'stat_stage_atk_up').condition(checks.exists()),
        ),
        apply: targets.ownerPet.apply(
          ops.changeStatStage(
            'spa',
            targets.ownerMarks
              .where(mark => mark.baseId === 'stat_stage_atk_up')
              .select(mark => mark.stack)
              .all()
              .map(amounts => amounts[0] ?? 0),
          ),
        ),
      }),
    ),
  }),
})
