import {
  actions,
  conditions,
  contexts,
  DamageType,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
  type Condition,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

const N_PLAN = 'mark_nuoji_njihua'
const B_PLAN = 'mark_nuoji_bjihua'
const NB_PLAN = 'mark_nuoji_nbjihua'
const DONG_FENG = 'mark_nuoji_dongfeng'
const WANSHI = 'mark_nuoji_wanshijubei'

const attackDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Physical || event.damageType === DamageType.Special),
)

@effectGroup({ id: 'nuoji' })
export class NuojiEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const nPlan = marks.get(N_PLAN)
    const bPlan = marks.get(B_PLAN)
    const nbPlan = marks.get(NB_PLAN)
    const dongFeng = marks.get(DONG_FENG)
    const countdown = marks.get('mark_nuoji_dongfeng_countdown')
    const wanshi = marks.get(WANSHI)
    const pendingHeal = marks.get('mark_nuoji_dongfeng_heal')
    if (!pendingHeal || !nPlan || !bPlan || !nbPlan || !dongFeng || !wanshi || !countdown) {
      throw new Error('Missing Nuoji plan marks')
    }

    const hasN = targets.ownerMarks.where(mark => mark.baseId === N_PLAN && mark.isActive).first()
    const hasB = targets.ownerMarks.where(mark => mark.baseId === B_PLAN && mark.isActive).first()
    const hasNB = targets.ownerMarks.where(mark => mark.baseId === NB_PLAN && mark.isActive).first()
    const hasPlan = targets.ownerMarks
      .where(mark => (mark.baseId === N_PLAN || mark.baseId === B_PLAN || mark.baseId === NB_PLAN) && mark.isActive)
      .first()

    const nActive: Condition = ctx => ctx.read(hasN) !== undefined
    const bActive: Condition = ctx => ctx.read(hasB) !== undefined
    const nbActive: Condition = ctx => ctx.read(hasNB) !== undefined
    const planActive: Condition = ctx => ctx.read(hasPlan) !== undefined
    const nPlanActive: Condition = ctx => nActive(ctx) || nbActive(ctx)
    const bPlanActive: Condition = ctx => bActive(ctx) || nbActive(ctx)

    const removeN = targets.ownerMarks.where(mark => mark.baseId === N_PLAN && mark.isActive).apply(ops.removeMark())
    const removeB = targets.ownerMarks.where(mark => mark.baseId === B_PLAN && mark.isActive).apply(ops.removeMark())
    const removeNB = targets.ownerMarks.where(mark => mark.baseId === NB_PLAN && mark.isActive).apply(ops.removeMark())

    const ownerPet = targets.ownerPet

    const windMarks = targets.ownerMarks.where(mark => mark.baseId === DONG_FENG && mark.isActive)
    const incoming = contexts.switchPet.select(event => event.switchInPet)

    return defineEffects({
      effect_ability_add_rage_self_5_at_turn_end_with_any_plan: {
        triggers: [EffectTrigger.TurnEnd],
        priority: 0,
        when: conditions.all(conditions.ownerIsActive, planActive),
        apply: ownerPet.apply(ops.addRage(5)),
      },
      effect_emblem_add_dongfeng_countdown_on_battle_start_and_switch_in: {
        triggers: [EffectTrigger.OnBattleStart, EffectTrigger.OnOwnerSwitchIn],
        priority: 0,
        when: conditions.ownerIsActive,
        apply: ownerPet.apply(ops.addMark(countdown, { duration: 3 })),
      },
      effect_mark_add_dongfeng_on_duration_end: {
        triggers: [EffectTrigger.OnMarkDurationEnd],
        priority: 0,
        apply: ownerPet.apply(ops.addMark(dongFeng)),
      },
      effect_skill_replace_b_or_nb_plan_with_n_plan: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(removeB, removeNB, ownerPet.apply(ops.addMark(nPlan, { stack: 1 }))),
      },
      effect_skill_replace_n_or_nb_plan_with_b_plan: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(removeN, removeNB, ownerPet.apply(ops.addMark(bPlan, { stack: 1 }))),
      },
      effect_skill_add_mark_self_nb_plan_for_3_turns: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.addMark(nbPlan, { stack: 1, duration: 3 })),
      },
      effect_skill_add_power_40_with_n_or_nb_plan: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, nPlanActive),
        apply: contexts.skillUse.apply(ops.addPower(40)),
      },
      effect_skill_set_sure_hit_with_b_or_nb_plan: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, bPlanActive),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_skill_set_2_hits_with_n_plan_without_nb_plan: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, nActive, conditions.not(nbActive)),
        apply: contexts.skillUse.apply(ops.setMultihit(2)),
      },
      effect_skill_set_3_hits_with_nb_plan: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, nbActive),
        apply: contexts.skillUse.apply(ops.setMultihit(3)),
      },
      effect_skill_raise_priority_1_with_nb_plan: {
        triggers: [EffectTrigger.BeforeSort],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, nbActive),
        apply: contexts.skillUse.property('priority').apply(ops.add(1)),
      },
      effect_skill_raise_priority_1_with_b_plan_without_nb_plan: {
        triggers: [EffectTrigger.BeforeSort],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, bActive, conditions.not(nbActive)),
        apply: contexts.skillUse.property('priority').apply(ops.add(1)),
      },
      effect_skill_set_sure_hit_with_n_or_nb_plan: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, nPlanActive),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_skill_deal_80_fixed_damage_on_hit_with_b_or_nb_plan: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, bPlanActive),
        apply: contexts.skillUse
          .flatMap(event => (event.actualTarget ? [event.actualTarget] : []))
          .apply(ops.dealDamage(80)),
      },
      effect_skill_raise_priority_1_with_n_or_nb_plan: {
        triggers: [EffectTrigger.BeforeSort],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, nPlanActive),
        apply: contexts.skillUse.property('priority').apply(ops.add(1)),
      },
      effect_skill_set_2_hits_with_b_or_nb_plan: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, bPlanActive),
        apply: contexts.skillUse.apply(ops.setMultihit(2)),
      },
      effect_skill_remove_all_plans_and_heal_self_150: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(removeN, removeB, removeNB, ownerPet.apply(ops.heal(150))),
      },
      effect_skill_raise_atk_1_stage_plus_spa_1_without_any_plan: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.choose(
          planActive,
          ownerPet.apply(ops.changeStatStage('atk', 1)),
          actions.sequence(
            ownerPet.apply(ops.changeStatStage('atk', 1)),
            ownerPet.apply(ops.changeStatStage('spa', 1)),
          ),
        ),
      },
      effect_skill_add_mark_self_wanshijubei_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.addMark(wanshi, { stack: 1 })),
      },
      effect_skill_min_attack_damage_165_with_any_plan: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, planActive, attackDamage),
        apply: contexts.damage.apply(ops.setDamageThreshold({ min: 165 })),
      },
      effect_skill_add_mark_self_dongfeng_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.addMark(dongFeng, { stack: 1 })),
      },
      effect_skill_add_power_25_with_n_or_nb_plan: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, nPlanActive),
        apply: contexts.skillUse.apply(ops.addPower(25)),
      },
      effect_skill_add_rage_self_20_on_hit_with_b_or_nb_plan: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, bPlanActive),
        apply: ownerPet.apply(ops.addRage(20)),
      },
      effect_skill_deal_65_fixed_damage_on_hit_with_b_or_nb_plan: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, bPlanActive),
        apply: contexts.skillUse
          .flatMap(event => (event.actualTarget ? [event.actualTarget] : []))
          .apply(ops.dealDamage(65)),
      },
      effect_mark_increase_attack_damage_dealt_20_percent: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, attackDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 20, delta: 0 })),
      },
      effect_mark_increase_attack_damage_dealt_20_percent_without_n_plan: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, attackDamage, conditions.not(nActive)),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 20, delta: 0 })),
      },
      effect_mark_reduce_damage_taken_20_percent_without_b_plan: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, conditions.not(bActive)),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -20, delta: 0 })),
      },
      effect_mark_add_speed_50_on_creation: {
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        apply: ownerPet.apply(ops.addAttributeModifier('spe', 'delta', 50)),
      },
      effect_mark_consume_dongfeng_at_turn_end_to_prepare_switch_in_heal: {
        triggers: [EffectTrigger.TurnEnd],
        priority: 0,
        when: conditions.all(
          conditions.ownerIsActive,
          windMarks.condition((_, marks) => marks.length > 0),
        ),
        apply: actions.sequence(windMarks.apply(ops.removeMark()), ownerPet.apply(ops.addMark(pendingHeal))),
      },
      effect_mark_heal_other_nuojibo_half_max_hp_on_switch_in_and_consume: {
        triggers: [EffectTrigger.OnSwitchIn],
        priority: 0,
        when: ctx => {
          const donor = ctx.read(ownerPet.first())
          const { origin, switchInPet } = ctx.parent
          return donor?.owner === origin && donor !== switchInPet && switchInPet.originalSpecies.id === 'pet_nuojibo'
        },
        apply: actions.sequence(
          incoming.apply(ops.heal(incoming.select(pet => Math.floor(pet.stat.maxHp / 2)).first())),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      },
    })
  }
}
