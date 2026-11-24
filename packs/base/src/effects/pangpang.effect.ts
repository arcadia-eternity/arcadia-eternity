import {
  actions,
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
import { physicalDamage } from './damage-conditions'
import { activeOwnerMarks, sourceMarkOnLastTurn, requireMark } from './mark-queries'

const WEIZUI = 'mark_weizui'
const LANZUI = 'mark_lanzui'
const MEIJIU = 'mark_meijiuyouhuo'
const HUNMI = 'mark_hunmi'
const EXIN = 'mark_exin'
const MIANYIYICHANG = 'mark_mianyiyichang'

const weizui = activeOwnerMarks(WEIZUI)
const lanzui = activeOwnerMarks(LANZUI)
const hasWeizui = weizui.first().map(mark => mark !== undefined)
const hasLanzui = lanzui.first().map(mark => mark !== undefined)
const hasAnyDrunk = conditions.any(
  targets.ownerMarks.condition((_, marks) => marks.some(mark => mark.baseId === WEIZUI && mark.isActive)),
  targets.ownerMarks.condition((_, marks) => marks.some(mark => mark.baseId === LANZUI && mark.isActive)),
)

const consumeDrunk = actions.sequence(weizui.apply(ops.removeMark()), lanzui.apply(ops.removeMark()))

@effectGroup({ id: 'pangpang' })
export class PangpangEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const recovery = requireMark(marks, 'mark_huifu_1_16')
    const weizuiMark = requireMark(marks, WEIZUI)
    const lanzuiMark = requireMark(marks, LANZUI)
    const meijiuMark = requireMark(marks, MEIJIU)
    const hunmiMark = requireMark(marks, HUNMI)
    const exinMark = requireMark(marks, EXIN)
    const mianyiMark = requireMark(marks, MIANYIYICHANG)

    const opponentActive = targets.opponentActive
    const ownerPet = targets.ownerPet

    return defineEffects({
      effect_ability_add_5_rage_at_turn_end_if_weizui_or_lanzui: {
        triggers: [EffectTrigger.TurnEnd],
        priority: 0,
        when: conditions.all(
          conditions.ownerIsActive,
          conditions.any(
            targets.ownerMarks.condition((_, ms) => ms.some(m => m.baseId === WEIZUI && m.isActive)),
            targets.ownerMarks.condition((_, ms) => ms.some(m => m.baseId === LANZUI && m.isActive)),
          ),
        ),
        apply: ownerPet.apply(ops.addRage(5)),
      },
      effect_emblem_set_received_lanzui_duration_3: {
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_, events) => events.some(e => e.baseMark.id === LANZUI)),
        ),
        apply: contexts.addMark.apply(ops.setMarkDuration(3)),
      },
      effect_skill_add_mark_self_weizui_or_upgrade_to_lanzui: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: (ctx => {
          const hasWeizuiNow = ctx.read(hasWeizui)
          const hasLanzuiNow = ctx.read(hasLanzui)
          if (hasWeizuiNow && !hasLanzuiNow) {
            consumeDrunk(ctx)
            ownerPet.apply(ops.addMark(lanzuiMark, { stack: 1, duration: 2 }))(ctx)
          } else if (!hasWeizuiNow && !hasLanzuiNow) {
            ownerPet.apply(ops.addMark(weizuiMark, { stack: 1, duration: 3 }))(ctx)
          }
        }) satisfies Action,
      },
      effect_skill_add_50_crit_rate_if_weizui_or_95_if_lanzui: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: (ctx => {
          if (ctx.read(hasLanzui)) {
            contexts.skillUse.apply(ops.addCritRate(95))(ctx)
          } else if (ctx.read(hasWeizui)) {
            contexts.skillUse.apply(ops.addCritRate(50))(ctx)
          }
        }) satisfies Action,
      },
      effect_skill_consume_drunk_to_add_self_huifu_1_16_for_5_turns: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasAnyDrunk),
        apply: (ctx => {
          consumeDrunk(ctx)
          ownerPet.apply(ops.addMark(recovery, { duration: 5 }))(ctx)
        }) satisfies Action,
      },
      effect_skill_consume_drunk_to_set_accuracy_95_and_add_exin_to_both_for_3_turns: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasAnyDrunk),
        apply: (ctx => {
          consumeDrunk(ctx)
          contexts.skillUse.apply(ops.setAccuracy(95))(ctx)
          opponentActive.apply(ops.addMark(exinMark, { stack: 1, duration: 3 }))(ctx)
          ownerPet.apply(ops.addMark(exinMark, { stack: 1, duration: 3 }))(ctx)
        }) satisfies Action,
      },
      effect_skill_raise_atk_1_stage_and_spa_1_stage_if_lanzui: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: (ctx => {
          ownerPet.apply(ops.changeStatStage('atk', 1))(ctx)
          if (ctx.read(hasLanzui)) {
            ownerPet.apply(ops.changeStatStage('spa', 1))(ctx)
          }
        }) satisfies Action,
      },
      effect_skill_add_power_50_if_weizui_or_100_if_lanzui: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: (ctx => {
          if (ctx.read(hasLanzui)) {
            contexts.skillUse.apply(ops.addPower(100))(ctx)
          } else if (ctx.read(hasWeizui)) {
            contexts.skillUse.apply(ops.addPower(50))(ctx)
          }
        }) satisfies Action,
      },
      effect_skill_consume_drunk_to_reduce_both_spd_1_stage: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasAnyDrunk),
        apply: (ctx => {
          consumeDrunk(ctx)
          opponentActive.apply(ops.changeStatStage('spd', -1))(ctx)
          ownerPet.apply(ops.changeStatStage('spd', -1))(ctx)
        }) satisfies Action,
      },
      effect_skill_set_2_to_3_hits_if_weizui_or_3_to_5_if_lanzui: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        when: conditions.all(conditions.selfUsesSkill, hasAnyDrunk),
        apply: actions.choose(
          lanzui.condition((_, marks) => marks.length > 0),
          contexts.skillUse.apply(ops.setMultihit(values.randomInt(3, 5))),
          contexts.skillUse.apply(ops.setMultihit(values.randomInt(2, 3))),
        ),
      },
      effect_skill_consume_drunk_to_reduce_both_spe_1_stage: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasAnyDrunk),
        apply: (ctx => {
          consumeDrunk(ctx)
          opponentActive.apply(ops.changeStatStage('spe', -1))(ctx)
          ownerPet.apply(ops.changeStatStage('spe', -1))(ctx)
        }) satisfies Action,
      },
      effect_skill_reduce_rage_cost_15_if_weizui_or_30_if_lanzui: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: (ctx => {
          if (ctx.read(hasLanzui)) {
            contexts.skillUse.property('rage').apply(ops.add(-30))(ctx)
          } else if (ctx.read(hasWeizui)) {
            contexts.skillUse.property('rage').apply(ops.add(-15))(ctx)
          }
        }) satisfies Action,
      },
      effect_skill_raise_spa_1_stage_and_spe_1_stage_if_lanzui: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: (ctx => {
          ownerPet.apply(ops.changeStatStage('spa', 1))(ctx)
          if (ctx.read(hasLanzui)) {
            ownerPet.apply(ops.changeStatStage('spe', 1))(ctx)
          }
        }) satisfies Action,
      },
      effect_skill_add_mark_self_mianyiyichang_for_3_turns_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.addMark(mianyiMark, { stack: 1, duration: 3 })),
      },
      effect_skill_add_mark_self_meijiuyouhuo_on_hit: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.addMark(meijiuMark, { stack: 1 })),
      },
      effect_mark_add_lanzui_to_physical_attacker_and_remove_self_on_last_turn: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(conditions.ownerIsActive, conditions.selfBeDamaged, sourceMarkOnLastTurn, physicalDamage),
        apply: actions.sequence(
          targets.damageOriginPet.apply(ops.addMark(lanzuiMark, { stack: 1, duration: 2 })),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      },
      effect_mark_add_mark_self_hunmi_for_2_turns_on_duration_end: {
        triggers: [EffectTrigger.OnMarkDurationEnd],
        priority: 0,
        apply: (ctx => {
          targets.ownerPet.apply(ops.addMark(hunmiMark, { stack: 1, duration: 2 }))(ctx)
        }) satisfies Action,
      },
    })
  }
}
