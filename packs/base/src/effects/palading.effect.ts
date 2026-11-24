import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'
// Paladin (帕拉丁, original client form 250, 图鉴 123) authored from:
// - pets.xml form 250/249 (stats, learn list, per-move SoundID/EffectID),
// - moves.xml 11572-11586 / 10034 / 10939 (name, category, type, power, accuracy,
//   anger and the client Tips text quoted per effect below),
// - buffs.xml (3314 神圣, 3315 公正, 3317 征伐, 3316 格挡, 3320 庇护, 3322 救赎),
// - dictionary.xml form 250 (特性 1123 "自己具有神圣状态时不会受到致命一击",
//   emblemID 300123) plus the 4399 帕拉丁解析 (community analysis used only where the
//   client tables leave a number unspecified, e.g. the 神圣 heal rate).
// Unsupported details are marked as assumptions in the comments, not as original facts.
import { DamageType } from '@arcadia-eternity/const'
import { BaseMark } from '@arcadia-eternity/battle/engine'
import {
  defineEffects,
  EffectTrigger,
  actions,
  checks,
  conditions,
  contexts,
  ops,
  targets,
  values,
  type Condition,
} from '@arcadia-eternity/battle/authoring'

function requireMark(marks: ReadonlyMap<string, BaseMark>, id: string): BaseMark {
  const mark = marks.get(id)
  if (!(mark instanceof BaseMark) || mark.id !== id) throw new Error(`Missing official mark: ${id}`)
  return mark
}

const SHENSHENG = 'mark_shensheng'

/** Owner currently has the named mark (source owner's mark list). */
function hasOwnerMark(id: string): Condition {
  return targets.ownerMarks.where(mark => mark.baseId === id && mark.isActive).condition(checks.exists())
}

/**
 * Owner HP is strictly below 1/`denominator` of max HP.
 * Integer arithmetic keeps the exact boundary for max HP that is not divisible by
 * the denominator (e.g. 801 HP: "低于1/8" includes 100 because 100 < 100.125).
 */
function hpBelowFraction(denominator: number): Condition {
  return targets.ownerPet.condition((_ctx, pets) => pets.some(pet => pet.currentHp * denominator < pet.stat.maxHp))
}

/** 救赎之火: "自己体力低于1/8时恢复100体力" (move tip / buff 3322). */
const hpBelowEighth: Condition = hpBelowFraction(8)

/**
 * 复仇光冲: power doubles when every other team member has fainted.
 * The original tips only state "伙伴全部战败时"; downed team state is read from the player team.
 */
const allAlliesFainted: Condition = targets.ownerPet.condition((_ctx, pets) =>
  pets.some(pet => {
    const player = pet.owner
    return !!player && player.team.every(member => member === pet || !member.isAlive)
  }),
)

/** The 庇护 emblem extends 庇护之火's flat reduction to special damage. */
const emblemBiHuEquipped: Condition = hasOwnerMark('mark_emblem_bihu')

const damageIsPhysical: Condition = contexts.damage.condition((_ctx, events) =>
  events.some(event => event.damageType === DamageType.Physical),
)
const damageIsSpecial: Condition = contexts.damage.condition((_ctx, events) =>
  events.some(event => event.damageType === DamageType.Special),
)
const damageIsPhysicalOrSpecial: Condition = contexts.damage.condition((_ctx, events) =>
  events.some(event => event.damageType === DamageType.Physical || event.damageType === DamageType.Special),
)

@effectGroup({ id: 'palading' })
export class PaladingEffects {
  static build(context: Pick<EffectLoadingContext, 'marks'>) {
    const marks = context.marks

    const shensheng = requireMark(marks, SHENSHENG)
    const bihu = requireMark(marks, 'mark_bihu')
    const shengyou = requireMark(marks, 'mark_shengyou')
    const gongzheng = requireMark(marks, 'mark_gongzheng')
    const zhengfa = requireMark(marks, 'mark_zhengfa')
    const mingshi = requireMark(marks, 'mark_mingshi')
    const jiushu = requireMark(marks, 'mark_jiushu')

    return defineEffects({
      /** 正义之火: raise special defence while in the 神圣 state. */
      effect_skill_raise_spd_1_stage_if_shensheng: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasOwnerMark(SHENSHENG)),
        apply: targets.ownerPet.apply(ops.changeStatStage('spd', 1)),
      },
      /** 圣光之名: enter the permanent 神圣 state (its turn-end healing lives on the mark). */
      effect_skill_add_mark_self_shensheng: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(shensheng)),
      },
      /** 十字光冲: +50% damage while in the 神圣 state. */
      effect_skill_increase_damage_50_percent_if_shensheng: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasOwnerMark(SHENSHENG)),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 50, delta: 0 })),
      },
      /** 惩戒之光: while in the 神圣 state add 15% of the user's special attack as flat damage. */
      effect_skill_add_damage_15_percent_spa_if_shensheng: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasOwnerMark(SHENSHENG)),
        apply: contexts.damage.apply(
          ops.modifyDamage({
            percent: 0,
            delta: targets.ownerPet.select(pet => Math.floor(pet.stat.spa * 0.15)).first(),
          }),
        ),
      },
      /** 庇护之火: grant the 5-turn 格挡 state. */
      effect_skill_add_mark_self_bihu: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(bihu)),
      },
      /** 公正光冲: the opponent cannot gain positive stat stages for 3 turns. */
      effect_skill_add_mark_opponent_gongzheng: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.opponentActive.apply(ops.addMark(gongzheng)),
      },
      /** 复仇光冲: double power when all allies have fainted. */
      effect_skill_double_power_if_all_allies_fainted: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, allAlliesFainted),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      },
      /** 征伐之火: grant the 3-turn 征伐 state. */
      effect_skill_add_mark_self_zhengfa: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(zhengfa)),
      },
      /** 圣佑之火: grant the 5-turn 庇护 state. */
      effect_skill_add_mark_self_shengyou: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(shengyou)),
      },
      /** 荣耀的圣战: while in the 神圣 state raise defence or special defence (50/50, battle RNG). */
      effect_skill_raise_def_or_spd_1_stage_if_shensheng: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasOwnerMark(SHENSHENG)),
        apply: actions.choose(
          conditions.chance(50),
          targets.ownerPet.apply(ops.changeStatStage('def', 1)),
          targets.ownerPet.apply(ops.changeStatStage('spd', 1)),
        ),
      },
      /** 使命之火: grant the 5-turn 使命 state (abnormal-state immunity lives on the mark). */
      effect_skill_add_mark_self_mingshi: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(mingshi)),
      },
      /** 审判光冲: while in the 神圣 state add 15% of the user's physical attack as flat damage. */
      effect_skill_add_damage_15_percent_atk_if_shensheng: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasOwnerMark(SHENSHENG)),
        apply: contexts.damage.apply(
          ops.modifyDamage({
            percent: 0,
            delta: targets.ownerPet.select(pet => Math.floor(pet.stat.atk * 0.15)).first(),
          }),
        ),
      },
      /** 拯救之火: heal the opponent for 100 and remove 35 rage from them. */
      effect_skill_heal_opponent_100_and_reduce_opponent_rage_35: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.opponentActive.apply(ops.heal(100)),
          targets.opponentActive.apply(ops.reduceRage(35)),
        ),
      },
      /** 救赎之火: grant the persistent 救赎 state (heal trigger lives on the mark). */
      effect_skill_add_mark_self_jiushu: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(jiushu)),
      },

      /**
       * 神圣 (mark 3314): heals every turn end. The client tip only says "持续恢复体力";
       * the 4399 帕拉丁解析 states 每回合恢复1/16 and 半血以下每回合1/8, which is the only
       * source for the rates, so treat them as community-documented, not client facts.
       * The half-HP boundary uses integer math (see hpBelowFraction) for exact rounding.
       */
      effect_mark_heal_self_sixteenth_or_eighth_below_half_turn_end: {
        triggers: [EffectTrigger.TurnEnd],
        priority: 0,
        when: conditions.ownerIsActive,
        apply: targets.ownerPet.apply(
          ops.heal(
            values.combine(
              targets.ownerPet.select(pet => pet.currentHp).first(),
              targets.ownerPet.select(pet => pet.stat.maxHp).first(),
              (currentHp, maxHp) => Math.floor(maxHp / (currentHp * 2 < maxHp ? 8 : 16)),
            ),
          ),
        ),
      },
      /**
       * 格挡 (mark 3316): block a flat 50 points of physical damage for the mark's 5 turns
       * (move 11576 tip). The 庇护 emblem (item 300123, "使庇护之火减少物理伤害变为减少所有伤害")
       * widens it to special damage too.
       */
      effect_mark_reduce_physical_damage_50_or_special_with_bihu_emblem: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          damageIsPhysicalOrSpecial,
          conditions.any(emblemBiHuEquipped, damageIsPhysical),
        ),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 0, delta: -50 })),
      },
      /** 庇护 (mark 3320): 5 turns of halved special damage (move 11581 tip). */
      effect_mark_reduce_special_damage_50_percent: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, damageIsSpecial),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -50, delta: 0 })),
      },
      /**
       * 公正 (mark 3315): the marked pet cannot gain positive stat stages for 3 turns
       * (move 11578 tip). Only the five battle stats are covered because the engine's
       * stat-stage marks are limited to atk/def/spa/spd/spe.
       */
      effect_mark_block_positive_stat_stages: {
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(conditions.ownerReceivesMark, conditions.statStageChange(undefined, 'up')),
        apply: contexts.addMark.apply(ops.disableContext()),
      },
      /** 征伐 (mark 3317): 35% of the damage dealt is converted back into HP (move 11580 tip). */
      effect_mark_heal_self_35_percent_damage_dealt: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(
          ops.heal(contexts.damageResult.select(event => Math.floor(event.hpLoss * 0.35)).first()),
        ),
      },
      /**
       * 救赎 (mark 3322): "自己体力低于1/8时立刻恢复100点体力 恢复后状态消失"
       * (buff description; move 11586 tip). Heal on drop, then the mark expires.
       */
      effect_mark_heal_self_100_below_eighth_hp_when_damaged_then_remove_self: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, conditions.ownerIsActive, hpBelowEighth),
        apply: actions.sequence(targets.ownerPet.apply(ops.heal(100)), targets.sourceMark.apply(ops.removeMark())),
      },
      /** 救赎 (mark): if it is applied while already below 1/8 HP, resolve immediately. */
      effect_mark_heal_self_100_below_eighth_hp_on_jiushu_created_then_remove_self: {
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_ctx, events) => events.some(event => event.baseMark.id === 'mark_jiushu')),
          hpBelowEighth,
        ),
        apply: actions.sequence(targets.ownerPet.apply(ops.heal(100)), targets.sourceMark.apply(ops.removeMark())),
      },
      /**
       * 神圣 (ability, feature 1123): "自己具有神圣状态时不会受到致命一击".
       * The client phrase 致命一击 is the crit term in this engine, so the owner cannot be
       * critically hit while the 神圣 mark is attached. Priority 99 beats the attacker's
       * sure-crit overrides.
       */
      effect_ability_prevent_incoming_crit_if_shensheng: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.ownerIsSkillTarget, hasOwnerMark(SHENSHENG)),
        apply: contexts.skillUse.apply(ops.setSureNoCrit(99)),
      },
    })
  }
}
