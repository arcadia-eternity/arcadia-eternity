import {
  conditions,
  contexts,
  DamageType,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

const ANFU = 'mark_anfu'
const DONGSHANG = 'mark_dongshang'
const XINLING = 'mark_xinlingzhiyue'
const SHANGHAI = 'mark_shoudaoshanghaizengjia'
const XUEZHIWAIYI = 'mark_xuezhiwaiyi'
const BINGFENG = 'mark_bingfengjiyi'
const BAOFENGXUE = 'mark_global_baofengxue'

const anfuOnOpponent = targets.opponentActive
  .flatMap(pet => pet.marks)
  .where(mark => mark.baseId === ANFU && mark.isActive)
const opponentHasAnfu = anfuOnOpponent.first().map(mark => mark !== undefined)

const normalDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Physical || event.damageType === DamageType.Special),
)

const normalSkill = contexts.damageSkill.condition((_, skills) => skills.some(skill => skill.element === 'Normal'))

@effectGroup({ id: 'niya' })
export class NiyaEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const anfu = marks.get(ANFU)
    const dongshang = marks.get(DONGSHANG)
    const xinling = marks.get(XINLING)
    const shanghai = marks.get(SHANGHAI)
    const xuezhiwaiyi = marks.get(XUEZHIWAIYI)
    const bingfeng = marks.get(BINGFENG)
    const baofengxue = marks.get(BAOFENGXUE)
    if (!anfu || !dongshang || !xinling || !shanghai || !xuezhiwaiyi || !bingfeng || !baofengxue) {
      throw new Error('Missing Niya mark dependencies')
    }

    return defineEffects({
      effect_niya_ability_normal_boost: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, normalDamage, normalSkill),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 25, delta: 0 })),
      },
      effect_niya_emblem_anfu_power: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ctx => ctx.read(opponentHasAnfu) === true),
        apply: contexts.skillUse.apply(ops.addPower(10)),
      },
      effect_niya_skill_anfuzhichu: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.opponentActive.apply(ops.addMark(anfu)),
      },
      effect_niya_skill_feixue: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ctx => ctx.read(opponentHasAnfu) === true),
        apply: targets.opponentActive.apply(ops.addMark(dongshang)),
      },
      effect_niya_skill_hanlengzhichu: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.firstSkillThisTurn),
        apply: targets.opponentActive.apply(ops.addMark(xinling, { stack: 1 })),
      },
      effect_niya_skill_xuehuafeiwu: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ctx => ctx.read(opponentHasAnfu) === true),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_niya_skill_xuezhiwaiyi: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(xuezhiwaiyi, { stack: 100 })),
      },
      effect_niya_skill_bingdongzhichu: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.opponentActive.apply(ops.addMark(shanghai, { stack: 50 })),
      },
      effect_niya_skill_xiubaixue: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ctx => ctx.read(opponentHasAnfu) === true),
        apply: targets.opponentActive.apply(ops.dealDamage(50)),
      },
      effect_niya_skill_bingfengjiyi: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ctx => {
          targets.ownerPet.apply(ops.changeStatStage('spe', 1))(ctx)
          const pet = ctx.read(targets.ownerPet.first())
          if (!pet) return
          const stages = ['atk', 'def', 'spa', 'spd', 'spe'] as const
          const memory = pet.marks.find(mark => mark.isActive && mark.baseId === BINGFENG)

          if (memory) {
            const downLevels = stages.map(
              stat => pet.marks.find(mark => mark.isActive && mark.baseId === `stat_stage_${stat}_down`)?.stack ?? 0,
            )
            targets.ownerPet.apply(ops.clearStatStages({ stats: [...stages], strategy: 'positive' }))(ctx)
            stages.forEach((stat, index) => {
              const saved = Math.floor((memory.stack - 1) / 7 ** index) % 7
              if (saved > 0) targets.ownerPet.apply(ops.changeStatStage(stat, saved + downLevels[index]))(ctx)
            })
            targets.ownerMarks.where(mark => mark.id === memory.id).apply(ops.removeMark())(ctx)
            return
          }

          let encoded = 0
          for (const [index, stat] of stages.entries()) {
            const positive =
              pet.marks.find(mark => mark.isActive && mark.baseId === `stat_stage_${stat}_up`)?.stack ?? 0
            encoded += positive * 7 ** index
          }
          targets.ownerPet.apply(ops.addMark(bingfeng, { stack: encoded + 1 }))(ctx)
        },
      },
      effect_niya_skill_baofengxue: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.battle.apply(ops.addMark(baofengxue)),
      },
      effect_mark_anfu_block_boost: {
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(conditions.ownerReceivesMark, conditions.statStageChange(undefined, 'up')),
        apply: contexts.addMark.apply(ops.disableContext()),
      },
      effect_mark_baofengxue_ice_boost: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: ctx =>
          ctx.parent.origin.skillElement === 'Ice' && ctx.read(targets.damageOriginPet.first())?.element === 'Ice',
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 35, delta: 0 })),
      },
      effect_mark_xuezhiwaiyi_absorb: {
        triggers: [EffectTrigger.OnConsumeStack],
        priority: 0,
        when: ctx => ctx.parent.mark === ctx.read(targets.sourceMark.first()) && ctx.parent.reason === 'shield',
        apply: targets.ownerPet.apply(
          ops.heal(contexts.consumeStack.select(payment => Math.floor(payment.actualAmount / 2)).first()),
        ),
      },
    })
  }
}
