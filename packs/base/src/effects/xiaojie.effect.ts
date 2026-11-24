import {
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
  values,
  type Action,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'
import { physicalDamage, specialDamage, physicalOrSpecialDamage } from './damage-conditions'
import { activeOwnerMarks, sourceMarkOnLastTurn, requireMark } from './mark-queries'

const SHIQIESHI = 'mark_shiqieshi'
const CHENSHOUSHI = 'mark_chenshoushi'
const DUNJUSHI = 'mark_dunjushi'
const WUSHUANGSHI = 'mark_wushuangshi'
const WUSHUANGLI = 'mark_wushuangli'
const SHANGHAIZENGJIA = 'mark_shanghaizengjia'

function weightPower(base: number): Action {
  return contexts.skillUse.apply(
    ops.addPower(
      values.choose(
        targets.ownerPet.condition((_, pets) => (pets[0]?.weight ?? 0) > 100),
        base,
        0,
      ),
    ),
  )
}

@effectGroup({ id: 'xiaojie' })
export class XiaojieEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const shiqieshi = requireMark(marks, SHIQIESHI)
    const chenshoushi = requireMark(marks, CHENSHOUSHI)
    const dunjushi = requireMark(marks, DUNJUSHI)
    const wushuangshi = requireMark(marks, WUSHUANGSHI)
    const wushuangli = requireMark(marks, WUSHUANGLI)
    const shanghaizengjia = requireMark(marks, SHANGHAIZENGJIA)

    return defineEffects({
      effect_ability_raise_atk_1_stage_before_receiving_spe_drop: {
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: -1,
        when: conditions.all(
          conditions.ownerReceivesMark,
          conditions.statStageChange('spe', 'down'),
          contexts.addMark.condition((_, events) => events.some(event => event.available)),
        ),
        apply: targets.ownerPet.apply(ops.changeStatStage('atk', 1)),
      },
      effect_emblem_add_mark_self_shanghaizengjia_10_after_stance_skill: {
        triggers: [EffectTrigger.SkillUseEnd],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, events) =>
            events.some(event =>
              ['skill_shiqieshi', 'skill_chenshoushi', 'skill_dunjushi', 'skill_wushuangshi'].includes(
                event.skill.baseId,
              ),
            ),
          ),
        ),
        apply: targets.ownerPet.apply(ops.addMark(shanghaizengjia, { stack: 10 })),
      },
      effect_skill_add_mark_self_shiqieshi_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(shiqieshi, { stack: 1 })),
      },
      effect_skill_add_power_65_if_weight_above_100: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: weightPower(65),
      },
      effect_skill_add_mark_self_chenshoushi_if_first: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.firstSkillThisTurn),
        apply: targets.ownerPet.apply(ops.addMark(chenshoushi, { stack: 1 })),
      },
      effect_skill_add_mark_self_dunjushi_if_first: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.firstSkillThisTurn),
        apply: targets.ownerPet.apply(ops.addMark(dunjushi, { stack: 1 })),
      },
      effect_skill_add_mark_self_shanghaizengjia_40_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(shanghaizengjia, { stack: 40 })),
      },
      effect_skill_add_power_70_if_weight_above_100: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: weightPower(70),
      },
      effect_skill_add_mark_self_wushuangshi_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(wushuangshi, { stack: 1 })),
      },
      effect_mark_amplify_outgoing_attack_damage_40_percent_on_last_turn: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, physicalOrSpecialDamage, sourceMarkOnLastTurn),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 40, delta: 0 })),
      },
      effect_mark_prevent_physical_damage_50_percent_consume_1_stack: {
        triggers: [EffectTrigger.OnDamageReplacement],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, physicalDamage),
        apply: contexts.damage.apply(ops.preventDamage({ fraction: 0.5, stacks: 1 })),
      },
      effect_mark_prevent_special_damage_50_percent_consume_1_stack: {
        triggers: [EffectTrigger.OnDamageReplacement],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, specialDamage),
        apply: contexts.damage.apply(ops.preventDamage({ fraction: 0.5, stacks: 1 })),
      },
      effect_mark_add_mark_self_wushuangli_by_half_attack_hp_loss_and_remove_wushuangshi: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, physicalOrSpecialDamage),
        apply: (ctx => {
          const lost = ctx.read(contexts.damageResult.select(result => result.hpLoss).first()) ?? 0
          const stacks = Math.floor(lost / 2)
          if (stacks > 0) targets.ownerPet.apply(ops.addMark(wushuangli, { stack: stacks }))(ctx)
          activeOwnerMarks(WUSHUANGSHI).apply(ops.removeMark())(ctx)
        }) satisfies Action<EffectTrigger.OnDamage>,
      },
      effect_mark_remove_self_after_attack_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: -1,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, events) => events[0]?.category !== 'Status'),
        ),
        apply: targets.sourceMark.apply(ops.removeMark()),
      },
    })
  }
}
