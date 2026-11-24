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
      effect_ability_increase_normal_attack_damage_dealt_25_percent: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, normalDamage, normalSkill),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 25, delta: 0 })),
      },
      effect_emblem_add_power_10_if_opponent_has_anfu: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ctx => ctx.read(opponentHasAnfu) === true),
        apply: contexts.skillUse.apply(ops.addPower(10)),
      },
      effect_skill_add_mark_opponent_anfu_on_hit: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.opponentActive.apply(ops.addMark(anfu)),
      },
      effect_skill_add_mark_opponent_dongshang_if_anfu: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ctx => ctx.read(opponentHasAnfu) === true),
        apply: targets.opponentActive.apply(ops.addMark(dongshang)),
      },
      effect_skill_add_mark_opponent_xinlingzhiyue_if_first_skill: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.firstSkillThisTurn),
        apply: targets.opponentActive.apply(ops.addMark(xinling, { stack: 1 })),
      },
      effect_skill_set_sure_hit_if_opponent_has_anfu: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ctx => ctx.read(opponentHasAnfu) === true),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_skill_add_mark_self_xuezhiwaiyi_100_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(xuezhiwaiyi, { stack: 100 })),
      },
      effect_skill_add_mark_opponent_shoudaoshanghaizengjia_50_on_hit: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.opponentActive.apply(ops.addMark(shanghai, { stack: 50 })),
      },
      effect_skill_deal_50_fixed_damage_to_opponent_with_anfu_on_hit: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ctx => ctx.read(opponentHasAnfu) === true),
        apply: targets.opponentActive.apply(ops.dealDamage(50)),
      },
      effect_skill_raise_spe_1_stage_and_store_or_restore_positive_stages_with_bingfengjiyi: {
        triggers: [EffectTrigger.BeforeHit],
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
      effect_skill_set_field_baofengxue_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.battle.apply(ops.addMark(baofengxue)),
      },
      effect_mark_increase_ice_skill_damage_dealt_by_ice_pet_35_percent: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: ctx =>
          ctx.parent.origin.skillElement === 'Ice' && ctx.read(targets.damageOriginPet.first())?.element === 'Ice',
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 35, delta: 0 })),
      },
      effect_mark_heal_self_half_shield_stacks_consumed: {
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
