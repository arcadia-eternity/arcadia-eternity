import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

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

const HANBINGJIANREN = 'mark_hanbingjianren'
const DONGSHANG = 'mark_dongshang'

@effectGroup({ id: 'bingchuantun' })
export class BingchuantunEffects {
  static build(context: Pick<EffectLoadingContext, 'marks'>) {
    const marks = context.marks

    const hanbingjianren = marks.get(HANBINGJIANREN)
    if (!hanbingjianren) throw new Error('Missing base mark: ' + HANBINGJIANREN)
    const dongshang = marks.get(DONGSHANG)
    if (!dongshang) throw new Error('Missing base mark: ' + DONGSHANG)

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
      effect_mark_reduce_incoming_physical_damage_25_percent: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, conditions.ownerIsActive, damageIsPhysical),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -25, delta: 0 })),
      },
      effect_mark_reduce_incoming_special_damage_15_percent: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, conditions.ownerIsActive, damageIsSpecial),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -15, delta: 0 })),
      },
      /** 特性 后劲 (dictionary Features): +10% damage when acting last this turn. */
      effect_ability_amplify_outgoing_attack_damage_10_percent_if_last: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.lastSkillThisTurn, damageIsPhysicalOrSpecial),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 10, delta: 0 })),
      },
      /**
       * 纹章 坚韧 (item 300062): while the owner has 寒冰坚韧, damage taken is
       * reduced by a flat 20. Effect damage is intentionally not included.
       */
      effect_emblem_reduce_incoming_attack_damage_20_if_hanbingjianren: {
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
      effect_skill_add_mark_self_hanbingjianren: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(hanbingjianren)),
      },
      /**
       * 冰冷一击 (move 10636): consume the mark on hit, after its damage bonus.
       * The mark must still be present during damage calculation.
       */
      effect_skill_consume_hanbingjianren_on_hit: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ownerHasHanbingjianren),
        apply: consumeHanbingjianren,
      },
      /**
       * 冻气冲撞 (move 10628): consume 寒冰坚韧 to make the opponent 冻伤.
       * 冻伤 is ineffective against Ice-type targets (buff 1002).
       */
      effect_skill_consume_hanbingjianren_add_mark_opponent_dongshang: {
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
      effect_skill_add_priority_1_if_consume_hanbingjianren: {
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
      effect_skill_add_power_60_if_consume_hanbingjianren: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ownerHasHanbingjianren),
        apply: actions.sequence(contexts.skillUse.apply(ops.addPower(60)), consumeHanbingjianren),
      },
      /** 冰冷一击 (move 10636): consume 寒冰坚韧 for +60 fixed damage. */
      effect_skill_add_fixed_damage_60_if_hanbingjianren: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, damageIsPhysicalOrSpecial, ownerHasHanbingjianren),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 0, delta: 60 })),
      },
      /** 寒冷之气 (move 10634): double power against a 冻伤 opponent. */
      effect_skill_power_2x_if_opponent_has_mark_dongshang: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasDongshang),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      },
    })
  }
}
