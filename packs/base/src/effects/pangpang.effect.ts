import {
  actions,
  conditions,
  contexts,
  DamageType,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
  type Action,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

const WEIZUI = 'mark_weizui'
const LANZUI = 'mark_lanzui'
const MEIJIU = 'mark_meijiuyouhuo'
const HUNMI = 'mark_hunmi'
const EXIN = 'mark_exin'
const MIANYIYICHANG = 'mark_mianyiyichang'

const weizui = targets.ownerMarks.where(mark => mark.baseId === WEIZUI && mark.isActive)
const lanzui = targets.ownerMarks.where(mark => mark.baseId === LANZUI && mark.isActive)
const hasWeizui = weizui.first().map(mark => mark !== undefined)
const hasLanzui = lanzui.first().map(mark => mark !== undefined)
const hasAnyDrunk = conditions.any(
  targets.ownerMarks.condition((_, marks) => marks.some(mark => mark.baseId === WEIZUI && mark.isActive)),
  targets.ownerMarks.condition((_, marks) => marks.some(mark => mark.baseId === LANZUI && mark.isActive)),
)

function consumeDrunk(): Action {
  return actions.sequence(weizui.apply(ops.removeMark()), lanzui.apply(ops.removeMark()))
}

@effectGroup({ id: 'pangpang' })
export class PangpangEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const recovery = marks.get('mark_huifu_1_16')
    const weizuiMark = marks.get(WEIZUI)
    const lanzuiMark = marks.get(LANZUI)
    const meijiuMark = marks.get(MEIJIU)
    const hunmiMark = marks.get(HUNMI)
    const exinMark = marks.get(EXIN)
    const mianyiMark = marks.get(MIANYIYICHANG)
    if (!recovery || !weizuiMark || !lanzuiMark || !meijiuMark || !hunmiMark || !exinMark || !mianyiMark) {
      throw new Error('Missing pangpang mark dependency')
    }

    const opponentActive = targets.opponentActive
    const ownerPet = targets.ownerPet

    return defineEffects({
      effect_pangpang_ability_rage_regen: {
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
      effect_pangpang_emblem_lanzui_duration: {
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_, events) => events.some(e => e.baseMark.id === LANZUI)),
        ),
        apply: contexts.addMark.apply(ops.setMarkDuration(3)),
      },
      effect_pangpang_skill_yinjiu_drink: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: (ctx => {
          const hasWeizuiNow = ctx.read(hasWeizui)
          const hasLanzuiNow = ctx.read(hasLanzui)
          if (hasWeizuiNow && !hasLanzuiNow) {
            consumeDrunk()(ctx)
            ownerPet.apply(ops.addMark(lanzuiMark, { stack: 1, duration: 2 }))(ctx)
          } else if (!hasWeizuiNow && !hasLanzuiNow) {
            ownerPet.apply(ops.addMark(weizuiMark, { stack: 1, duration: 3 }))(ctx)
          }
        }) satisfies Action,
      },
      effect_pangpang_skill_yuntouzhuanxiang_crit: {
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
      effect_pangpang_skill_xingjiu_heal: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasAnyDrunk),
        apply: (ctx => {
          consumeDrunk()(ctx)
          ownerPet.apply(ops.addMark(recovery, { duration: 5 }))(ctx)
        }) satisfies Action,
      },
      effect_pangpang_skill_exin_effect: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasAnyDrunk),
        apply: (ctx => {
          consumeDrunk()(ctx)
          contexts.skillUse.apply(ops.setAccuracy(95))(ctx)
          opponentActive.apply(ops.addMark(exinMark, { stack: 1, duration: 3 }))(ctx)
          ownerPet.apply(ops.addMark(exinMark, { stack: 1, duration: 3 }))(ctx)
        }) satisfies Action,
      },
      effect_pangpang_skill_manmianhongguang_buff: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: (ctx => {
          ownerPet.apply(ops.changeStatStage('atk', 1))(ctx)
          if (ctx.read(hasLanzui)) {
            ownerPet.apply(ops.changeStatStage('spa', 1))(ctx)
          }
        }) satisfies Action,
      },
      effect_pangpang_skill_xilihutu_power: {
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
      effect_pangpang_skill_fanwei_effect: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasAnyDrunk),
        apply: (ctx => {
          consumeDrunk()(ctx)
          opponentActive.apply(ops.changeStatStage('spd', -1))(ctx)
          ownerPet.apply(ops.changeStatStage('spd', -1))(ctx)
        }) satisfies Action,
      },
      effect_pangpang_skill_shouwuzudao_multihit: {
        triggers: [EffectTrigger.BeforeMultiHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: (ctx => {
          if (ctx.read(hasLanzui)) {
            contexts.skillUse.apply(ops.setMultihit(3))(ctx)
            contexts.skillUse.apply(ops.addMultihitResult(2))(ctx)
          } else if (ctx.read(hasWeizui)) {
            contexts.skillUse.apply(ops.setMultihit(2))(ctx)
            contexts.skillUse.apply(ops.addMultihitResult(1))(ctx)
          }
        }) satisfies Action,
      },
      effect_pangpang_skill_fali_effect: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasAnyDrunk),
        apply: (ctx => {
          consumeDrunk()(ctx)
          opponentActive.apply(ops.changeStatStage('spe', -1))(ctx)
          ownerPet.apply(ops.changeStatStage('spe', -1))(ctx)
        }) satisfies Action,
      },
      effect_pangpang_skill_jiuguidaluanda_clear: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.clearStatStages({ strategy: 'negative' })),
      },
      effect_pangpang_skill_fennu_rage: {
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
      effect_pangpang_skill_xingzhigaoang_buff: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: (ctx => {
          ownerPet.apply(ops.changeStatStage('spa', 1))(ctx)
          if (ctx.read(hasLanzui)) {
            ownerPet.apply(ops.changeStatStage('spe', 1))(ctx)
          }
        }) satisfies Action,
      },
      effect_pangpang_skill_penxue_immunity: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.addMark(mianyiMark, { stack: 1, duration: 3 })),
      },
      effect_pangpang_skill_quanjiu_meijiu: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.addMark(meijiuMark, { stack: 1 })),
      },
      effect_pangpang_meijiu_apply_lanzui: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(
          conditions.ownerIsActive,
          conditions.selfBeDamaged,
          ctx => ctx.read(targets.sourceMark.first())?.duration === 1,
          contexts.damage.condition((_, events) => events.some(e => e.damageType === DamageType.Physical)),
        ),
        apply: actions.sequence(
          targets.damageOriginPet.apply(ops.addMark(lanzuiMark, { stack: 1, duration: 2 })),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      },
      effect_pangpang_lanzui_end_hunmi: {
        triggers: [EffectTrigger.OnMarkDurationEnd],
        priority: 0,
        apply: (ctx => {
          targets.ownerPet.apply(ops.addMark(hunmiMark, { stack: 1, duration: 2 }))(ctx)
        }) satisfies Action,
      },
    })
  }
}
