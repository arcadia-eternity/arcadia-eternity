// Paladin (帕拉丁, original client form 250, 图鉴 123) authored from:
// - pets.xml form 250/249 (stats, learn list, per-move SoundID/EffectID),
// - moves.xml 11572-11586 / 10034 / 10939 (name, category, type, power, accuracy,
//   anger and the client Tips text quoted per effect below),
// - buffs.xml (3304 神圣, 3315 公正, 3317 征伐, 3320 庇护, 3322 救赎),
// - dictionary.xml form 250 (特性 1123 "自己具有神圣状态时不会受到致命一击",
//   emblemID 300123) plus the 4399 帕拉丁解析 (community analysis used only where the
//   client tables leave a number unspecified, e.g. the 神圣 heal rate).
// Unsupported details are marked as assumptions in the comments, not as original facts.
import { DamageType } from '@arcadia-eternity/const'
import { BaseMark } from '@arcadia-eternity/battle/v4'
import {
  EffectTrigger,
  actions,
  checks,
  compileEffect,
  conditions,
  contexts,
  defineEffect,
  ops,
  targets,
  values,
  type Condition,
} from '@arcadia-eternity/battle/v4/authoring'

function requireMark(marks: ReadonlyMap<string, BaseMark>, id: string): BaseMark {
  const mark = marks.get(id)
  if (!(mark instanceof BaseMark) || mark.id !== id) throw new Error(`Missing official mark: ${id}`)
  return mark
}

const SHENSHENG = 'mark_shensheng'

/** Owner currently has the named mark (source owner's mark list). */
function hasOwnerMark(id: string): Condition {
  return targets.ownerMarks.where(mark => mark.baseId === id).condition(checks.exists())
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

/**
 * 庇护之火 / 圣佑之火 grant the 庇护 state. The 庇护 emblem widens the flat
 * physical reduction of 庇护之火 to physical and special damage.
 */
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

export function createPaladingEffects(marks: ReadonlyMap<string, BaseMark>) {
  const shensheng = requireMark(marks, SHENSHENG)
  const bihu = requireMark(marks, 'mark_bihu')
  const shengyou = requireMark(marks, 'mark_shengyou')
  const gongzheng = requireMark(marks, 'mark_gongzheng')
  const zhengfa = requireMark(marks, 'mark_zhengfa')
  const mingshi = requireMark(marks, 'mark_mingshi')
  const jiushu = requireMark(marks, 'mark_jiushu')

  return Object.freeze({
    /** 正义之火: raise physical defence, and special defence while in the 神圣 state. */
    effect_skill_palading_zhengyizhihuo: compileEffect(
      defineEffect({
        id: 'effect_skill_palading_zhengyizhihuo',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.ownerPet.apply(ops.changeStatStage('def', 1)),
          actions.choose(hasOwnerMark(SHENSHENG), targets.ownerPet.apply(ops.changeStatStage('spd', 1))),
        ),
      }),
    ),
    /** 圣光之名: enter the permanent 神圣 state (its turn-end healing lives on the mark). */
    effect_skill_palading_shengguangzhiming: compileEffect(
      defineEffect({
        id: 'effect_skill_palading_shengguangzhiming',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(shensheng)),
      }),
    ),
    /** 十字光冲: +50% damage while in the 神圣 state. */
    effect_skill_palading_shiziguangchong: compileEffect(
      defineEffect({
        id: 'effect_skill_palading_shiziguangchong',
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasOwnerMark(SHENSHENG)),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 50, delta: 0 })),
      }),
    ),
    /** 惩戒之光: while in the 神圣 state add 15% of the user's special attack as flat damage. */
    effect_skill_palading_chengjiezhiguang: compileEffect(
      defineEffect({
        id: 'effect_skill_palading_chengjiezhiguang',
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasOwnerMark(SHENSHENG)),
        apply: contexts.damage.apply(
          ops.modifyDamage({
            percent: 0,
            delta: targets.ownerPet.select(pet => Math.floor(pet.stat.spa * 0.15)).first(),
          }),
        ),
      }),
    ),
    /** 庇护之火: grant the 5-turn 庇护 state. */
    effect_skill_palading_bihuzhihuo: compileEffect(
      defineEffect({
        id: 'effect_skill_palading_bihuzhihuo',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(bihu)),
      }),
    ),
    /** 公正光冲: the opponent cannot gain positive stat stages for 3 turns. */
    effect_skill_palading_gongzhengguangchong: compileEffect(
      defineEffect({
        id: 'effect_skill_palading_gongzhengguangchong',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.opponentActive.apply(ops.addMark(gongzheng, { duration: 3 })),
      }),
    ),
    /** 复仇光冲: double power when all allies have fainted. */
    effect_skill_palading_fuchouguangchong: compileEffect(
      defineEffect({
        id: 'effect_skill_palading_fuchouguangchong',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, allAlliesFainted),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    /** 征伐之火: grant the 3-turn 征伐 state. */
    effect_skill_palading_zhengfazhihuo: compileEffect(
      defineEffect({
        id: 'effect_skill_palading_zhengfazhihuo',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(zhengfa)),
      }),
    ),
    /** 圣佑之火: grant the 5-turn 圣佑 state. */
    effect_skill_palading_shengyouzhihuo: compileEffect(
      defineEffect({
        id: 'effect_skill_palading_shengyouzhihuo',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(shengyou)),
      }),
    ),
    /** 荣耀的圣战: while in the 神圣 state raise defence or special defence (50/50, battle RNG). */
    effect_skill_palading_rongyaodeshengzhan: compileEffect(
      defineEffect({
        id: 'effect_skill_palading_rongyaodeshengzhan',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasOwnerMark(SHENSHENG)),
        apply: actions.choose(
          conditions.chance(50),
          targets.ownerPet.apply(ops.changeStatStage('def', 1)),
          targets.ownerPet.apply(ops.changeStatStage('spd', 1)),
        ),
      }),
    ),
    /** 使命之火: grant the 5-turn 使命 state (abnormal-state immunity lives on the mark). */
    effect_skill_palading_shimingzhihuo: compileEffect(
      defineEffect({
        id: 'effect_skill_palading_shimingzhihuo',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(mingshi)),
      }),
    ),
    /** 审判光冲: while in the 神圣 state add 15% of the user's physical attack as flat damage. */
    effect_skill_palading_shenpanguangchong: compileEffect(
      defineEffect({
        id: 'effect_skill_palading_shenpanguangchong',
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasOwnerMark(SHENSHENG)),
        apply: contexts.damage.apply(
          ops.modifyDamage({
            percent: 0,
            delta: targets.ownerPet.select(pet => Math.floor(pet.stat.atk * 0.15)).first(),
          }),
        ),
      }),
    ),
    /** 拯救之火: heal the opponent for 100 and remove 35 rage from them. */
    effect_skill_palading_zhengjiuzhihuo: compileEffect(
      defineEffect({
        id: 'effect_skill_palading_zhengjiuzhihuo',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.opponentActive.apply(ops.heal(100)),
          targets.opponentActive.apply(ops.reduceRage(35)),
        ),
      }),
    ),
    /** 救赎之火: grant the persistent 救赎 state (heal trigger lives on the mark). */
    effect_skill_palading_jiushuzhihuo: compileEffect(
      defineEffect({
        id: 'effect_skill_palading_jiushuzhihuo',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(jiushu)),
      }),
    ),

    /**
     * 神圣 (mark 3314): heals every turn end. The client tip only says "持续恢复体力";
     * the 4399 帕拉丁解析 states 每回合恢复1/16 and 半血以下每回合1/8, which is the only
     * source for the rates, so treat them as community-documented, not client facts.
     * The half-HP boundary uses integer math (see hpBelowFraction) for exact rounding.
     */
    effect_mark_shensheng_heal_turn_end: compileEffect(
      defineEffect({
        id: 'effect_mark_shensheng_heal_turn_end',
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
      }),
    ),
    /**
     * 庇护 (mark 3320): block a flat 50 points of physical damage for the mark's 5 turns
     * (move 11576 tip). The 庇护 emblem (item 300123, "使庇护之火减少物理伤害变为减少所有伤害")
     * widens it to special damage too. Effect-type/fixed damage never reaches
     * OnBeforeCalculateDamage in this engine, so no damage hook can reduce it; only
     * physical and special damage are reachable here.
     */
    effect_mark_bihu_block_damage_50: compileEffect(
      defineEffect({
        id: 'effect_mark_bihu_block_damage_50',
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          damageIsPhysicalOrSpecial,
          conditions.any(emblemBiHuEquipped, damageIsPhysical),
        ),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 0, delta: -50 })),
      }),
    ),
    /** 圣佑 (mark): 5 turns of halved special damage (move 11581 tip). */
    effect_mark_shengyou_halve_special_damage: compileEffect(
      defineEffect({
        id: 'effect_mark_shengyou_halve_special_damage',
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, damageIsSpecial),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -50, delta: 0 })),
      }),
    ),
    /**
     * 公正 (mark 3315): the marked pet cannot gain positive stat stages for 3 turns
     * (move 11578 tip). Only the five battle stats are covered because the engine's
     * stat-stage marks are limited to atk/def/spa/spd/spe.
     */
    effect_mark_gongzheng_block_positive_stage: compileEffect(
      defineEffect({
        id: 'effect_mark_gongzheng_block_positive_stage',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(conditions.ownerReceivesMark, conditions.statStageChange(undefined, 'up')),
        apply: actions.sequence(contexts.addMark.apply(ops.disableContext())),
      }),
    ),
    /** 征伐 (mark 3317): 35% of the damage dealt is converted back into HP (move 11580 tip). */
    effect_mark_zhengfa_lifesteal_35: compileEffect(
      defineEffect({
        id: 'effect_mark_zhengfa_lifesteal_35',
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(
          ops.heal(contexts.damage.select(event => Math.floor(event.damageResult * 0.35)).first()),
        ),
      }),
    ),
    /**
     * 救赎 (mark 3322): "自己体力低于1/8时立刻恢复100点体力 恢复后状态消失"
     * (buff description; move 11586 tip). Heal on drop, then the mark expires.
     */
    effect_mark_jiushu_heal_at_low_hp: compileEffect(
      defineEffect({
        id: 'effect_mark_jiushu_heal_at_low_hp',
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, conditions.ownerIsActive, hpBelowEighth),
        apply: actions.sequence(targets.ownerPet.apply(ops.heal(100)), targets.sourceMark.apply(ops.removeMark())),
      }),
    ),
    /** 救赎 (mark): if it is applied while already below 1/8 HP, resolve immediately. */
    effect_mark_jiushu_heal_on_apply_if_low: compileEffect(
      defineEffect({
        id: 'effect_mark_jiushu_heal_on_apply_if_low',
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_ctx, events) => events.some(event => event.baseMark.id === 'mark_jiushu')),
          hpBelowEighth,
        ),
        apply: actions.sequence(targets.ownerPet.apply(ops.heal(100)), targets.sourceMark.apply(ops.removeMark())),
      }),
    ),
    /**
     * 神圣 (ability, feature 1123): "自己具有神圣状态时不会受到致命一击".
     * The client phrase 致命一击 is the crit term in this engine, so the owner cannot be
     * critically hit while the 神圣 mark is attached. Priority 99 beats the attacker's
     * sure-crit overrides.
     */
    effect_ability_palading_shensheng_immune_crit: compileEffect(
      defineEffect({
        id: 'effect_ability_palading_shensheng_immune_crit',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.ownerIsSkillTarget, hasOwnerMark(SHENSHENG)),
        apply: contexts.skillUse.apply(ops.setSureNoCrit(99)),
      }),
    ),
  })
}
