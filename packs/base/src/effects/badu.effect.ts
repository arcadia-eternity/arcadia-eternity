import {
  actions,
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  numberParam,
  ops,
  targets,
  type Action,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

const LINGGUI = 'mark_badu_shihunlinggui'
const YOULINGGUI = 'mark_badu_youhunlinggui'
const LIHUNLINGGUI = 'mark_badu_lihunlinggui'
const FANKANG = 'mark_badu_fankangyishi'
const SUIJI = 'mark_badu_linghunsuiji'
const DIZHISHANG = 'mark_badu_dizhishang'

const specialDefense = targets.ownerPet.first().attribute('spd')

const attackDamage = contexts.damage.condition((_, events) =>
  events.some(
    event => event.damageType === 'Physical' || event.damageType === 'Special' || event.damageType === 'Effect',
  ),
)

const specialDamage = contexts.damage.condition((_, events) => events.some(event => event.damageType === 'Special'))

const strikeDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === 'Physical' || event.damageType === 'Special'),
)

const opponentActive = targets.opponentActive

const spdBoostChance = numberParam({ default: 10, tags: ['skill_effect_probability'] })

function spdBonusDamage(divisor: number, cap: number) {
  return {
    triggers: [EffectTrigger.AfterUseSkillCheck] as const,
    priority: 0,
    when: conditions.selfUsesSkill,
    apply: (ctx => {
      const spd = ctx.read(specialDefense) ?? 0
      const bonus = Math.min(cap, Math.floor(spd / divisor))
      if (bonus > 0) contexts.skillUse.apply(ops.addPower(bonus))(ctx)
    }) satisfies Action<EffectTrigger.AfterUseSkillCheck>,
  }
}

function spdMultihit(divisor: number, cap: number) {
  return {
    triggers: [EffectTrigger.AfterUseSkillCheck] as const,
    priority: 0,
    when: conditions.selfUsesSkill,
    apply: (ctx => {
      const spd = ctx.read(specialDefense) ?? 0
      const hits = Math.max(1, Math.min(cap, Math.floor(spd / divisor)))
      contexts.skillUse.apply(ops.setMultihit(hits))(ctx)
    }) satisfies Action<EffectTrigger.AfterUseSkillCheck>,
  }
}

@effectGroup({ id: 'badu' })
export class BaduEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const linggui = marks.get(LINGGUI)
    const youlinggui = marks.get(YOULINGGUI)
    const lihunlinggui = marks.get(LIHUNLINGGUI)
    const fankang = marks.get(FANKANG)
    const suiji = marks.get(SUIJI)
    const dizhishang = marks.get(DIZHISHANG)
    if (!linggui || !youlinggui || !lihunlinggui || !fankang || !suiji || !dizhishang) {
      throw new Error('Missing Badu mark definitions')
    }

    const hasLinggui = targets.ownerMarks.where(
      mark => mark.isActive && (mark.baseId === LINGGUI || mark.baseId === YOULINGGUI || mark.baseId === LIHUNLINGGUI),
    )

    return defineEffects({
      effect_ability_reduce_special_damage_10_percent_if_spd_over_500: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, specialDamage, ctx => (ctx.read(specialDefense) ?? 0) > 500),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -10, delta: 0 })),
      },
      effect_emblem_reduce_damage_5_percent_if_any_linggui: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          attackDamage,
          hasLinggui.condition((_, found) => found.length > 0),
        ),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -5, delta: 0 })),
      },
      effect_skill_add_mark_self_shihunlinggui_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(linggui, { stack: 1 })),
      },
      effect_skill_add_power_1_per_5_spd_max_100: spdBonusDamage(5, 100),
      effect_skill_add_mark_opponent_linghunsuiji_on_hit: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: opponentActive.apply(ops.addMark(suiji, { stack: 1 })),
      },
      effect_skill_multihit_1_per_100_spd_max_6: spdMultihit(100, 6),
      effect_skill_raise_spd_1_stage_10_percent: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        parameters: { chance: spdBoostChance },
        when: conditions.all(conditions.selfUsesSkill, conditions.chance(spdBoostChance)),
        apply: targets.ownerPet.apply(ops.changeStatStage('spd', 1)),
      },
      effect_skill_heal_self_13_percent_max_hp_add_youhunlinggui_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.ownerPet.apply(
            ops.heal(
              targets.ownerPet
                .first()
                .attribute('maxHp')
                .map(max => Math.floor(max * 0.13)),
            ),
          ),
          targets.ownerPet.apply(ops.addMark(youlinggui, { stack: 1 })),
        ),
      },
      effect_skill_add_mark_opponent_dizhishang_on_hit: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: opponentActive.apply(ops.addMark(dizhishang, { stack: 1 })),
      },
      effect_skill_add_power_1_per_10_spd_max_100: spdBonusDamage(10, 100),
      effect_skill_add_mark_self_fankangyishi_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(fankang, { stack: 1 })),
      },
      effect_skill_add_mark_self_lihunlinggui_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(lihunlinggui, { stack: 1 })),
      },
      effect_mark_reflect_half_attack_hp_loss_max_284_drain_opponent_rage_10_and_consume: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, strikeDamage),
        apply: (ctx => {
          const lost = ctx.read(contexts.damageResult.select(result => result.hpLoss).first()) ?? 0
          const reflected = Math.min(284, Math.floor(lost * 0.5))
          if (reflected > 0) {
            targets.damageOriginPet.apply(ops.dealDamage(reflected))(ctx)
            targets.opponentPlayer.apply(ops.reduceRage(10))(ctx)
          }
          targets.sourceMark.apply(ops.removeMark())(ctx)
        }) satisfies Action<EffectTrigger.OnDamage>,
      },
      effect_mark_prevent_attack_damage_twice_current_rage_consume_1_stack: {
        triggers: [EffectTrigger.OnDamageReplacement],
        when: conditions.all(conditions.selfBeDamaged, strikeDamage),
        apply: contexts.damage.apply(
          ops.preventDamage({ amount: targets.ownerPet.first().map(pet => pet.currentRage * 2), stacks: 1 }),
        ),
      },
      effect_mark_add_rage_10_on_hit_while_active: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.ownerUsesSkill, conditions.ownerIsActive),
        apply: targets.ownerPet.apply(ops.addRage(10)),
      },
      effect_mark_remove_self_on_owner_skill_damage: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.sourceMark.apply(ops.removeMark()),
      },
      effect_mark_increase_ground_attack_damage_taken_50_percent: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          strikeDamage,
          contexts.damageSkill.condition((_, skills) => skills.some(skill => skill.element === 'Ground')),
        ),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 50, delta: 0 })),
      },
    })
  }
}
