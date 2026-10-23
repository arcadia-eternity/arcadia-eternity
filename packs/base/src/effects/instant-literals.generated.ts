// Reviewed native behavior; edit this TypeScript source directly.
import { EffectTrigger, type effectId } from '@arcadia-eternity/const'
import { HealContext, RageContext, UseSkillContext, type EffectContext } from '@arcadia-eternity/battle/v4'
import { Pet } from '@arcadia-eternity/battle/v4'
import { SkillInstance } from '@arcadia-eternity/battle/v4'
import { MarkInstanceImpl } from '@arcadia-eternity/battle/v4'
import { defineNativeEffect } from '@arcadia-eternity/battle/v4'
function selfUsesSkill(context: EffectContext<EffectTrigger>): boolean {
  if (!(context.parent instanceof UseSkillContext)) return false
  return context.source instanceof SkillInstance
    ? context.source === context.parent.skill && context.source.owner === context.parent.pet
    : context.source instanceof MarkInstanceImpl && context.source.owner === context.parent.pet
}
function sourcePetIsActive(context: EffectContext<EffectTrigger>): boolean {
  return context.source.owner instanceof Pet && context.source.owner.isActive()
}
export const generatedInstantLiteralEffects = Object.freeze({
  effect_emblem_guangming_heal_20_per_turn: defineNativeEffect({
    id: 'effect_emblem_guangming_heal_20_per_turn' as effectId,
    triggers: [EffectTrigger.TurnEnd],
    priority: 0,
    when: sourcePetIsActive,
    apply(context) {
      const owner = context.source.owner
      if (!(owner instanceof Pet)) return
      const target = owner
      target.heal(new HealContext(context, context.source, target, 20))
    },
  }),
  effect_mark_add_rage_10_per_turn: defineNativeEffect({
    id: 'effect_mark_add_rage_10_per_turn' as effectId,
    triggers: [EffectTrigger.TurnEnd],
    priority: 0,
    when: sourcePetIsActive,
    apply(context) {
      const owner = context.source.owner
      if (!(owner instanceof Pet)) return
      const target = owner
      target.addRage(new RageContext(context, target.owner!, 'effect', 'add', 10))
    },
  }),
  effect_mark_add_rage_35_per_turn: defineNativeEffect({
    id: 'effect_mark_add_rage_35_per_turn' as effectId,
    triggers: [EffectTrigger.TurnEnd],
    priority: 0,
    when: sourcePetIsActive,
    apply(context) {
      const owner = context.source.owner
      if (!(owner instanceof Pet)) return
      const target = owner
      target.addRage(new RageContext(context, target.owner!, 'effect', 'add', 35))
    },
  }),
  effect_mark_add_rage_5_per_turn: defineNativeEffect({
    id: 'effect_mark_add_rage_5_per_turn' as effectId,
    triggers: [EffectTrigger.TurnEnd],
    priority: 0,
    when: sourcePetIsActive,
    apply(context) {
      const owner = context.source.owner
      if (!(owner instanceof Pet)) return
      const target = owner
      target.addRage(new RageContext(context, target.owner!, 'effect', 'add', 5))
    },
  }),
  effect_mark_heal_40_per_turn: defineNativeEffect({
    id: 'effect_mark_heal_40_per_turn' as effectId,
    triggers: [EffectTrigger.TurnEnd],
    priority: 0,
    when: sourcePetIsActive,
    apply(context) {
      const owner = context.source.owner
      if (!(owner instanceof Pet)) return
      const target = owner
      target.heal(new HealContext(context, context.source, target, 40))
    },
  }),
  effect_mark_heal_self_50_turn_end: defineNativeEffect({
    id: 'effect_mark_heal_self_50_turn_end' as effectId,
    triggers: [EffectTrigger.TurnEnd],
    priority: 0,
    when: sourcePetIsActive,
    apply(context) {
      const owner = context.source.owner
      if (!(owner instanceof Pet)) return
      const target = owner
      target.heal(new HealContext(context, context.source, target, 50))
    },
  }),
  effect_skill_add_rage_10: defineNativeEffect({
    id: 'effect_skill_add_rage_10' as effectId,
    triggers: [EffectTrigger.OnHit],
    priority: 0,
    when: selfUsesSkill,
    apply(context) {
      const owner = context.source.owner
      if (!(owner instanceof Pet)) return
      const target = owner
      target.addRage(new RageContext(context, target.owner!, 'effect', 'add', 10))
    },
  }),
  effect_skill_add_rage_15: defineNativeEffect({
    id: 'effect_skill_add_rage_15' as effectId,
    triggers: [EffectTrigger.OnHit],
    priority: 0,
    when: selfUsesSkill,
    apply(context) {
      const owner = context.source.owner
      if (!(owner instanceof Pet)) return
      const target = owner
      target.addRage(new RageContext(context, target.owner!, 'effect', 'add', 15))
    },
  }),
  effect_skill_add_rage_20: defineNativeEffect({
    id: 'effect_skill_add_rage_20' as effectId,
    triggers: [EffectTrigger.OnHit],
    priority: 0,
    when: selfUsesSkill,
    apply(context) {
      const owner = context.source.owner
      if (!(owner instanceof Pet)) return
      const target = owner
      target.addRage(new RageContext(context, target.owner!, 'effect', 'add', 20))
    },
  }),
  effect_skill_add_rage_25: defineNativeEffect({
    id: 'effect_skill_add_rage_25' as effectId,
    triggers: [EffectTrigger.OnHit],
    priority: 0,
    when: selfUsesSkill,
    apply(context) {
      const owner = context.source.owner
      if (!(owner instanceof Pet)) return
      const target = owner
      target.addRage(new RageContext(context, target.owner!, 'effect', 'add', 25))
    },
  }),
  effect_skill_add_rage_30_hit_or_miss: defineNativeEffect({
    id: 'effect_skill_add_rage_30_hit_or_miss' as effectId,
    triggers: [EffectTrigger.OnHit, EffectTrigger.OnMiss],
    priority: 0,
    when: selfUsesSkill,
    apply(context) {
      const owner = context.source.owner
      if (!(owner instanceof Pet)) return
      const target = owner
      target.addRage(new RageContext(context, target.owner!, 'effect', 'add', 30))
    },
  }),
  effect_skill_add_rage_35: defineNativeEffect({
    id: 'effect_skill_add_rage_35' as effectId,
    triggers: [EffectTrigger.OnHit],
    priority: 0,
    when: selfUsesSkill,
    apply(context) {
      const owner = context.source.owner
      if (!(owner instanceof Pet)) return
      const target = owner
      target.addRage(new RageContext(context, target.owner!, 'effect', 'add', 35))
    },
  }),
  effect_skill_heal_self_120_hp: defineNativeEffect({
    id: 'effect_skill_heal_self_120_hp' as effectId,
    triggers: [EffectTrigger.OnHit],
    priority: 0,
    when: selfUsesSkill,
    apply(context) {
      const owner = context.source.owner
      if (!(owner instanceof Pet)) return
      const target = owner
      target.heal(new HealContext(context, context.source, target, 120))
    },
  }),
  effect_skill_reduce_opponent_rage_15: defineNativeEffect({
    id: 'effect_skill_reduce_opponent_rage_15' as effectId,
    triggers: [EffectTrigger.OnHit],
    priority: 0,
    when: selfUsesSkill,
    apply(context) {
      const owner = context.source.owner
      if (!(owner instanceof Pet)) return
      const target = context.battle.getOpponent(owner.owner!).activePet
      target.addRage(new RageContext(context, target.owner!, 'effect', 'add', -15))
    },
  }),
  effect_skill_reduce_opponent_rage_20: defineNativeEffect({
    id: 'effect_skill_reduce_opponent_rage_20' as effectId,
    triggers: [EffectTrigger.OnHit],
    priority: 0,
    when: selfUsesSkill,
    apply(context) {
      const owner = context.source.owner
      if (!(owner instanceof Pet)) return
      const target = context.battle.getOpponent(owner.owner!).activePet
      target.addRage(new RageContext(context, target.owner!, 'effect', 'add', -20))
    },
  }),
  effect_skill_reduce_opponent_rage_5: defineNativeEffect({
    id: 'effect_skill_reduce_opponent_rage_5' as effectId,
    triggers: [EffectTrigger.OnHit],
    priority: 0,
    when: selfUsesSkill,
    apply(context) {
      const owner = context.source.owner
      if (!(owner instanceof Pet)) return
      const target = context.battle.getOpponent(owner.owner!).activePet
      target.addRage(new RageContext(context, target.owner!, 'effect', 'add', -5))
    },
  }),
})
