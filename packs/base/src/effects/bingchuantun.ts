import { BaseMark } from '@arcadia-eternity/battle/engine'
import {
  defineEffects,
  targets,
  contexts,
  conditions,
  actions,
  checks,
  ops,
  EffectTrigger,
} from '@arcadia-eternity/battle/authoring'
import { DamageType } from '@arcadia-eternity/const'

// Accepted recreation: priority/power spend before hit; on-hit effects spend on hit.
// 寒冰坚韧 persists across switches; these timing choices are not original-server proof.
const HANBINGJIANREN = 'mark_hanbingjianren'
const DONGSHANG = 'mark_dongshang'
const MIANYIBULIANG = 'mark_mianyibuliang'

export function createBingchuantunEffects(marks: ReadonlyMap<string, BaseMark>) {
  const hanbingjianren = marks.get(HANBINGJIANREN)
  if (!hanbingjianren) throw new Error('Missing bingchuantun mark: ' + HANBINGJIANREN)
  const dongshang = marks.get(DONGSHANG)
  if (!dongshang) throw new Error('Missing base mark: ' + DONGSHANG)
  const mianyibuliang = marks.get(MIANYIBULIANG)
  if (!mianyibuliang) throw new Error('Missing base mark: ' + MIANYIBULIANG)

  const ownerHasHanbingjianren = targets.ownerMarks
    .where(mark => mark.baseId === hanbingjianren.id)
    .condition(checks.exists())
  const consumeHanbingjianren = targets.ownerMarks
    .where(mark => mark.baseId === hanbingjianren.id)
    .apply(ops.removeMark())
  const opponentHasDongshang = targets.opponentActive.condition((_ctx, pets) =>
    pets.some(pet => pet.marks.some(mark => mark.baseId === DONGSHANG)),
  )
  const opponentIsNotIce = targets.opponentActive.condition((_ctx, pets) => pets[0]?.element !== 'Ice')

  const damageIsPhysical = contexts.damage.condition((_ctx, events) =>
    events.some(event => event.damageType === DamageType.Physical),
  )
  const damageIsSpecial = contexts.damage.condition((_ctx, events) =>
    events.some(event => event.damageType === DamageType.Special),
  )
  const damageIsPhysicalOrSpecial = conditions.any(damageIsPhysical, damageIsSpecial)

  return defineEffects({
    /** 寒冰坚韧 (buff 3115): physical damage taken -25%, special damage taken -15%. */
    effect_bingchuantun_hanbingjianren_reduce_physical: {
      triggers: [EffectTrigger.OnBeforeCalculateDamage],
      priority: 0,
      when: conditions.all(conditions.selfBeDamaged, conditions.ownerIsActive, damageIsPhysical),
      apply: contexts.damage.apply(ops.modifyDamage({ percent: -25, delta: 0 })),
    },
    effect_bingchuantun_hanbingjianren_reduce_special: {
      triggers: [EffectTrigger.OnBeforeCalculateDamage],
      priority: 0,
      when: conditions.all(conditions.selfBeDamaged, conditions.ownerIsActive, damageIsSpecial),
      apply: contexts.damage.apply(ops.modifyDamage({ percent: -15, delta: 0 })),
    },
    /** 特性 后劲 (dictionary Features): +10% damage when acting last this turn. */
    effect_bingchuantun_ability_houjin_damage: {
      triggers: [EffectTrigger.OnBeforeCalculateDamage],
      priority: 0,
      when: conditions.all(conditions.selfUsesSkill, conditions.lastSkillThisTurn, damageIsPhysicalOrSpecial),
      apply: contexts.damage.apply(ops.modifyDamage({ percent: 10, delta: 0 })),
    },
    /**
     * 纹章 坚韧 (item 300062): while the owner has 寒冰坚韧, damage taken is
     * reduced by a flat 20. Effect damage is intentionally not included.
     */
    effect_bingchuantun_emblem_jianren_flat_reduction: {
      triggers: [EffectTrigger.OnBeforeCalculateDamage],
      priority: 0,
      when: conditions.all(
        conditions.selfBeDamaged,
        conditions.ownerIsActive,
        damageIsPhysicalOrSpecial,
        ownerHasHanbingjianren,
      ),
      apply: contexts.damage.apply(ops.modifyDamage({ percent: 0, delta: -20 })),
    },
    /** 寒冰坚韧 (move 10627) and 冰河时代 (move 10633): gain the self mark. */
    effect_bingchuantun_skill_add_hanbingjianren: {
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: conditions.selfUsesSkill,
      apply: targets.ownerPet.apply(ops.addMark(hanbingjianren)),
    },
    /**
     * 冰冷一击 (move 10636): consume the mark on hit, after its damage bonus.
     * The mark must still be present during damage calculation.
     */
    effect_bingchuantun_skill_consume_hanbingjianren: {
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: conditions.all(conditions.selfUsesSkill, ownerHasHanbingjianren),
      apply: consumeHanbingjianren,
    },
    /**
     * 冻气冲撞 (move 10628): consume 寒冰坚韧 to make the opponent 冻伤.
     * 冻伤 is ineffective against Ice-type targets (buff 1002).
     */
    effect_bingchuantun_skill_dongqi_chongzhuang: {
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: conditions.all(conditions.selfUsesSkill, ownerHasHanbingjianren, opponentIsNotIce),
      apply: actions.sequence(targets.opponentActive.apply(ops.addMark(dongshang)), consumeHanbingjianren),
    },
    /**
     * 急速冰锥 (move 10630): consume 寒冰坚韧 for priority +1 before sorting.
     * Power/priority sequences in the base pack spend the mark before the hit
     * check, so an eventual miss still spends it.
     */
    effect_bingchuantun_skill_jisubingzhui_priority: {
      triggers: [EffectTrigger.BeforeSort],
      priority: 0,
      when: conditions.all(conditions.selfUsesSkill, ownerHasHanbingjianren),
      apply: actions.sequence(contexts.skillUse.property('priority').apply(ops.add(1)), consumeHanbingjianren),
    },
    /**
     * 冰雹 (move 10632): consume 寒冰坚韧 for +60 power. The power decision
     * happens in AfterUseSkillCheck, so the mark is spent at the same point
     * as the base pack's power + consume sequences.
     */
    effect_bingchuantun_skill_bingbao_power: {
      triggers: [EffectTrigger.AfterUseSkillCheck],
      priority: 0,
      when: conditions.all(conditions.selfUsesSkill, ownerHasHanbingjianren),
      apply: actions.sequence(contexts.skillUse.apply(ops.addPower(60)), consumeHanbingjianren),
    },
    /** 冰冷一击 (move 10636): consume 寒冰坚韧 for +60 fixed damage. */
    effect_bingchuantun_skill_binglengyiji_fixed_damage: {
      triggers: [EffectTrigger.OnBeforeCalculateDamage],
      priority: 0,
      when: conditions.all(conditions.selfUsesSkill, damageIsPhysicalOrSpecial, ownerHasHanbingjianren),
      apply: contexts.damage.apply(ops.modifyDamage({ percent: 0, delta: 60 })),
    },
    /** 寒冷之气 (move 10634): double power against a 冻伤 opponent. */
    effect_bingchuantun_skill_hanlengzhiqi_power: {
      triggers: [EffectTrigger.AfterUseSkillCheck],
      priority: 0,
      when: conditions.all(conditions.selfUsesSkill, opponentHasDongshang),
      apply: contexts.skillUse.apply(ops.amplifyPower(2)),
    },
    /** 冰冷皮肤 (move 10637): gain the base 不良免疫 mark. */
    effect_bingchuantun_skill_add_mianyibuliang: {
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      when: conditions.selfUsesSkill,
      apply: targets.ownerPet.apply(ops.addMark(mianyibuliang)),
    },
  })
}
