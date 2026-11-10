// 卡顿嘟嘟 (Kadundudu, original client form 71, 图鉴 29)
//
// Client evidence (frozen 2.61 tables, /private/tmp/seer2-original-tables):
// - pets.xml form 71: HP 178 / Atk 125 / Def 124 / SpAtk 113 / SpDef 114 / Spd 94,
//   Type 普通, learning list 10418-10426 plus inherited form 70 moves.
// - dictionary.xml form 71: 特性 1029 "自己具有红心印记时伤害增加10%",
//   emblemID 300029.
// - items.xml item 300029 红心纹章: "使红心印记和桃红印记必中".
// - moves.xml 10416-10426 tips and buffs.xml 3045/3066/3067/3068.
//
// Community sources fill in behaviour the 2.61 tips omit:
// - 4399 嘟嘟/卡顿嘟嘟解析: 红心印记 is gained on attack and is consumed by
//   mark-requiring moves; 红心强化 is 物攻+2 with a mark and +1 without;
//   红心碰撞/激撞 double damage. https://m.news.4399.com/gonglue/seer2/jinglingfenxi/201108-29-112589.html
// - 约瑟传说 BWIKI 修复服描述: 红心冲撞/强化/激撞/连接 consume the marks,
//   红心碰撞 requires self 红心印记 and opponent 心之印记 but does not consume.
//   https://wiki.biligame.com/seer2/卡顿嘟嘟 (检索 2026-11-07)
// - 7k7k 印记效果大全: 桃红印记 is a triggered mark.
//   https://news.7k7k.com/content/20120423/168490.html
//
// Restoration-server skill values and secondary effects take precedence (BWIKI oldid 37122).
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

const HONGXIN = 'mark_hongxinyinji'
const TAOHONG = 'mark_taohongyinji'
const LIANJIE = 'mark_hongxinlianjie'

/** 红心印记 and its 3-turn substitute 桃红印记 share the same trigger tag. */
const hasHongxinMark: Condition = targets.ownerMarks
  .where(mark => mark.tags.includes('hongxinyinji_tag'))
  .condition(checks.exists())

/** Only the real stackable 红心印记 is consumed; 桃红印记 is a timed substitute. */
const hasRealHongxinMark: Condition = targets.ownerMarks
  .where(mark => mark.baseId === HONGXIN)
  .condition(checks.exists())

/**
 * The opponent's active marks are read from the opposing player, not from the
 * skill's actual target: 红心连接 is a self-target status skill but still needs
 * to see the opponent's 心之印记.
 */
const opponentActiveMarks = targets.opponentActive.flatMap(pet => pet.marks)
const hasOpponentXinzhiMark: Condition = opponentActiveMarks
  .where(mark => mark.tags.includes('xinzhiyinji_tag'))
  .condition(checks.exists())

const comboReady = conditions.all(hasHongxinMark, hasOpponentXinzhiMark)

const consumeRealHongxinMark = targets.ownerMarks.where(mark => mark.baseId === HONGXIN).apply(ops.consumeStacks(1))

const consumeOpponentXinzhiMark = opponentActiveMarks
  .where(mark => mark.tags.includes('xinzhiyinji_tag'))
  .apply(ops.consumeStacks(1))

/** 红心连接's shared damage must not recursively share its own effect damage. */
const damageNotFromHongxinLianjie = contexts.damage.condition((_ctx, events) =>
  events.some(event => (event.source as { baseId?: string }).baseId !== LIANJIE),
)

/**
 * Original evidence only covers the physical/special skill damage path; the
 * project's Effect damage bypasses OnBeforeCalculateDamage and is not widened
 * here without original evidence.
 */
const damageIsPhysicalOrSpecial = contexts.damage.condition((_ctx, events) =>
  events.some(event => event.damageType === DamageType.Physical || event.damageType === DamageType.Special),
)

export function createKadunduduEffects(marks: ReadonlyMap<string, BaseMark>) {
  const hongxin = requireMark(marks, HONGXIN)
  const taohong = requireMark(marks, TAOHONG)
  const lianjie = requireMark(marks, LIANJIE)

  return defineEffects({
    effect_skill_kadundudu_reduce_spe_10_percent: {
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: conditions.all(conditions.selfUsesSkill, conditions.chance(10)),
      apply: targets.opponentActive.apply(ops.changeStatStage('spe', -1)),
    },
    /** 红心印记 (move 10416): "攻击对手同时给自己增加1个红心印记". */
    effect_skill_kadundudu_add_hongxinyinji: {
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: conditions.selfUsesSkill,
      apply: targets.ownerPet.apply(ops.addMark(hongxin, { stack: 1 })),
    },
    /** 桃红印记 (move 10423): self mark that counts as 红心印记 for 3 turns. */
    effect_skill_kadundudu_add_taohongyinji: {
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: conditions.selfUsesSkill,
      apply: targets.ownerPet.apply(ops.addMark(taohong)),
    },
    /** 红心回复 (move 10421): 120 HP, or 60 on an immediately repeated use. */
    effect_skill_kadundudu_hongxin_huifu: {
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: conditions.selfUsesSkill,
      apply: targets.ownerPet.apply(
        ops.heal(
          values.choose(
            targets.ownerPet.condition((_ctx, pets) => pets.some(pet => pet.lastSkillUsedTimes > 1)),
            60,
            120,
          ),
        ),
      ),
    },
    /** 红心冲撞 (move 10417): consume 红心印记 for double power. */
    effect_skill_kadundudu_hongxin_chongzhuang_power: {
      triggers: [EffectTrigger.AfterUseSkillCheck],
      priority: 0,
      when: conditions.all(conditions.selfUsesSkill, hasHongxinMark),
      apply: contexts.skillUse.apply(ops.amplifyPower(2)),
    },
    effect_skill_kadundudu_hongxin_chongzhuang_consume: {
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: conditions.all(conditions.selfUsesSkill, hasRealHongxinMark),
      apply: consumeRealHongxinMark,
    },
    /** 红心强化 (move 10418): ATK+1 normally, ATK+2 and consume 红心印记 when present. */
    effect_skill_kadundudu_hongxin_qianghua: {
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: conditions.selfUsesSkill,
      apply: actions.choose(
        hasHongxinMark,
        actions.sequence(
          targets.ownerPet.apply(ops.changeStatStage('atk', 2)),
          actions.choose(hasRealHongxinMark, consumeRealHongxinMark),
        ),
        targets.ownerPet.apply(ops.changeStatStage('atk', 1)),
      ),
    },
    /**
     * 红心碰撞 (move 10424): self 红心印记 + opponent 心之印记, double power.
     * The restoration-server description does not list consumption for this move.
     */
    effect_skill_kadundudu_hongxin_pengzhuang: {
      triggers: [EffectTrigger.AfterUseSkillCheck],
      priority: 0,
      when: conditions.all(conditions.selfUsesSkill, comboReady),
      apply: contexts.skillUse.apply(ops.amplifyPower(2)),
    },
    /** 红心激撞 (move 10425): consume both marks for double power. */
    effect_skill_kadundudu_hongxin_jizhuang_power: {
      triggers: [EffectTrigger.AfterUseSkillCheck],
      priority: 0,
      when: conditions.all(conditions.selfUsesSkill, comboReady),
      apply: contexts.skillUse.apply(ops.amplifyPower(2)),
    },
    effect_skill_kadundudu_hongxin_jizhuang_consume: {
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: conditions.all(conditions.selfUsesSkill, comboReady),
      apply: actions.sequence(consumeRealHongxinMark, consumeOpponentXinzhiMark),
    },
    /** 红心连接 (move 10426): consume both marks and gain the 5-turn shared-damage mark. */
    effect_skill_kadundudu_hongxin_lianjie: {
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: conditions.all(conditions.selfUsesSkill, comboReady),
      apply: actions.sequence(
        targets.ownerPet.apply(ops.addMark(lianjie)),
        consumeRealHongxinMark,
        consumeOpponentXinzhiMark,
      ),
    },
    /**
     * 红心连接 (buff 3068): for 5 turns 1/4 of damage taken is borne by the
     * opponent. Incoming physical/special damage is reduced to 3/4 before it is
     * applied, then one third of that reduced value (1/4 of the original hit) is
     * dealt to the opponent. The owner's net loss is 3/4, and a hit that would
     * otherwise be lethal can be shared instead of failing at 0 HP.
     */
    effect_mark_kadundudu_hongxin_lianjie_reduce: {
      triggers: [EffectTrigger.OnBeforeCalculateDamage],
      priority: 0,
      when: conditions.all(conditions.selfBeDamaged, conditions.ownerIsActive, damageIsPhysicalOrSpecial),
      apply: contexts.damage.apply(ops.modifyDamage({ percent: -25, delta: 0 })),
    },
    effect_mark_kadundudu_hongxin_lianjie_share: {
      triggers: [EffectTrigger.OnDamage],
      priority: 0,
      when: conditions.all(
        conditions.selfBeDamaged,
        conditions.ownerIsActive,
        damageIsPhysicalOrSpecial,
        damageNotFromHongxinLianjie,
      ),
      apply: targets.opponentActive.apply(
        ops.dealDamage(contexts.damage.select(event => Math.floor(event.damageResult / 3)).first()),
      ),
    },
    /** 特性 印记 (feature 1029): +10% damage while any 红心印记 / 桃红印记 is present. */
    effect_ability_kadundudu_yinji_damage_10_percent: {
      triggers: [EffectTrigger.OnBeforeCalculateDamage],
      priority: 0,
      when: conditions.all(conditions.selfUsesSkill, hasHongxinMark),
      apply: contexts.damage.apply(ops.modifyDamage({ percent: 10, delta: 0 })),
    },
    /** 纹章 红心 (item 300029): 红心印记 and 桃红印记 become sure-hit. */
    effect_emblem_kadundudu_hongxin_sure_hit: {
      triggers: [EffectTrigger.AfterUseSkillCheck],
      priority: 0,
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.skillUse.condition((_ctx, uses) =>
          uses.some(use => ['skill_hongxinyinji', 'skill_taohongyinji'].includes(use.skill.baseId)),
        ),
      ),
      apply: contexts.skillUse.apply(ops.setSureHit(2)),
    },
  })
}
