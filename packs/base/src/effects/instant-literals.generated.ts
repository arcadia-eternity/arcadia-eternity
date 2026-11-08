// Reviewed SDK behavior; edit this TypeScript source directly.
import { UseSkillContext } from '@arcadia-eternity/battle/engine'
import {
  EffectTrigger,
  compileEffect,
  defineEffect,
  conditions,
  targets,
  ops,
} from '@arcadia-eternity/battle/authoring'

const selfUsesSkill = conditions.all(ctx => ctx.parent instanceof UseSkillContext, conditions.selfUsesSkill)

// Signed rage additions preserve the original gain/loss hooks; do not replace them with reduceRage.
export const generatedInstantLiteralEffects = Object.freeze({
  effect_emblem_guangming_heal_20_per_turn: compileEffect(
    defineEffect({
      id: 'effect_emblem_guangming_heal_20_per_turn',
      triggers: [EffectTrigger.TurnEnd],
      priority: 0,
      when: conditions.ownerIsActive,
      apply: targets.ownerPet.apply(ops.heal(20)),
    }),
  ),
  effect_mark_add_rage_10_per_turn: compileEffect(
    defineEffect({
      id: 'effect_mark_add_rage_10_per_turn',
      triggers: [EffectTrigger.TurnEnd],
      priority: 0,
      when: conditions.ownerIsActive,
      apply: targets.ownerPet.apply(ops.addRage(10)),
    }),
  ),
  effect_mark_add_rage_35_per_turn: compileEffect(
    defineEffect({
      id: 'effect_mark_add_rage_35_per_turn',
      triggers: [EffectTrigger.TurnEnd],
      priority: 0,
      when: conditions.ownerIsActive,
      apply: targets.ownerPet.apply(ops.addRage(35)),
    }),
  ),
  effect_mark_add_rage_5_per_turn: compileEffect(
    defineEffect({
      id: 'effect_mark_add_rage_5_per_turn',
      triggers: [EffectTrigger.TurnEnd],
      priority: 0,
      when: conditions.ownerIsActive,
      apply: targets.ownerPet.apply(ops.addRage(5)),
    }),
  ),
  effect_mark_heal_40_per_turn: compileEffect(
    defineEffect({
      id: 'effect_mark_heal_40_per_turn',
      triggers: [EffectTrigger.TurnEnd],
      priority: 0,
      when: conditions.ownerIsActive,
      apply: targets.ownerPet.apply(ops.heal(40)),
    }),
  ),
  effect_mark_heal_self_50_turn_end: compileEffect(
    defineEffect({
      id: 'effect_mark_heal_self_50_turn_end',
      triggers: [EffectTrigger.TurnEnd],
      priority: 0,
      when: conditions.ownerIsActive,
      apply: targets.ownerPet.apply(ops.heal(50)),
    }),
  ),
  effect_skill_add_rage_10: compileEffect(
    defineEffect({
      id: 'effect_skill_add_rage_10',
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: selfUsesSkill,
      apply: targets.ownerPet.apply(ops.addRage(10)),
    }),
  ),
  effect_skill_add_rage_15: compileEffect(
    defineEffect({
      id: 'effect_skill_add_rage_15',
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: selfUsesSkill,
      apply: targets.ownerPet.apply(ops.addRage(15)),
    }),
  ),
  effect_skill_add_rage_20: compileEffect(
    defineEffect({
      id: 'effect_skill_add_rage_20',
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: selfUsesSkill,
      apply: targets.ownerPet.apply(ops.addRage(20)),
    }),
  ),
  effect_skill_add_rage_25: compileEffect(
    defineEffect({
      id: 'effect_skill_add_rage_25',
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: selfUsesSkill,
      apply: targets.ownerPet.apply(ops.addRage(25)),
    }),
  ),
  effect_skill_add_rage_30_hit_or_miss: compileEffect(
    defineEffect({
      id: 'effect_skill_add_rage_30_hit_or_miss',
      triggers: [EffectTrigger.OnHit, EffectTrigger.OnMiss],
      priority: 0,
      when: selfUsesSkill,
      apply: targets.ownerPet.apply(ops.addRage(30)),
    }),
  ),
  effect_skill_add_rage_35: compileEffect(
    defineEffect({
      id: 'effect_skill_add_rage_35',
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: selfUsesSkill,
      apply: targets.ownerPet.apply(ops.addRage(35)),
    }),
  ),
  effect_skill_heal_self_120_hp: compileEffect(
    defineEffect({
      id: 'effect_skill_heal_self_120_hp',
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: selfUsesSkill,
      apply: targets.ownerPet.apply(ops.heal(120)),
    }),
  ),
  effect_skill_reduce_opponent_rage_15: compileEffect(
    defineEffect({
      id: 'effect_skill_reduce_opponent_rage_15',
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: selfUsesSkill,
      apply: targets.opponentActive.apply(ops.addRage(-15)),
    }),
  ),
  effect_skill_reduce_opponent_rage_20: compileEffect(
    defineEffect({
      id: 'effect_skill_reduce_opponent_rage_20',
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: selfUsesSkill,
      apply: targets.opponentActive.apply(ops.addRage(-20)),
    }),
  ),
  effect_skill_reduce_opponent_rage_5: compileEffect(
    defineEffect({
      id: 'effect_skill_reduce_opponent_rage_5',
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: selfUsesSkill,
      apply: targets.opponentActive.apply(ops.addRage(-5)),
    }),
  ),
})
