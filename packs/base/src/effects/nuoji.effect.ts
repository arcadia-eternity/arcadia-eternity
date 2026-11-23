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
      effect_nuoji_ability_plan_rage: {
        triggers: [EffectTrigger.TurnEnd],
        priority: 0,
        when: conditions.all(conditions.ownerIsActive, planActive),
        apply: ownerPet.apply(ops.addRage(5)),
      },
      effect_nuoji_emblem_dongfeng: {
        triggers: [EffectTrigger.OnBattleStart, EffectTrigger.OnOwnerSwitchIn],
        priority: 0,
        when: conditions.ownerIsActive,
        apply: ownerPet.apply(ops.addMark(countdown, { duration: 3 })),
      },
      effect_nuoji_dongfeng_countdown: {
        triggers: [EffectTrigger.OnMarkDurationEnd],
        priority: 0,
        apply: ownerPet.apply(ops.addMark(dongFeng)),
      },
      effect_nuoji_skill_njihua: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(removeB, removeNB, ownerPet.apply(ops.addMark(nPlan, { stack: 1 }))),
      },
      effect_nuoji_skill_bjihua: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(removeN, removeNB, ownerPet.apply(ops.addMark(bPlan, { stack: 1 }))),
      },
      effect_nuoji_skill_nbjihua: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.addMark(nbPlan, { stack: 1, duration: 3 })),
      },
      effect_nuoji_skill_qianglisaowei_power: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, nPlanActive),
        apply: contexts.skillUse.apply(ops.addPower(40)),
      },
      effect_nuoji_skill_qianglisaowei_sure: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, bPlanActive),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_nuoji_skill_feiyuliantu_multihit: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, nActive, conditions.not(nbActive)),
        apply: contexts.skillUse.apply(ops.setMultihit(2)),
      },
      effect_nuoji_skill_feiyuliantu_nb_multihit: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, nbActive),
        apply: contexts.skillUse.apply(ops.setMultihit(3)),
      },
      effect_nuoji_skill_feiyuliantu_nb_priority: {
        triggers: [EffectTrigger.BeforeSort],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, nbActive),
        apply: contexts.skillUse.property('priority').apply(ops.add(1)),
      },
      effect_nuoji_skill_feiyuliantu_priority: {
        triggers: [EffectTrigger.BeforeSort],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, bActive, conditions.not(nbActive)),
        apply: contexts.skillUse.property('priority').apply(ops.add(1)),
      },
      effect_nuoji_skill_feiyuyaji_sure: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, nPlanActive),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_nuoji_skill_feiyuyaji_bonus: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, bPlanActive),
        apply: contexts.skillUse
          .flatMap(event => (event.actualTarget ? [event.actualTarget] : []))
          .apply(ops.dealDamage(80)),
      },
      effect_nuoji_skill_lianxusaowei_priority: {
        triggers: [EffectTrigger.BeforeSort],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, nPlanActive),
        apply: contexts.skillUse.property('priority').apply(ops.add(1)),
      },
      effect_nuoji_skill_lianxusaowei_multihit: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, bPlanActive),
        apply: contexts.skillUse.apply(ops.setMultihit(2)),
      },
      effect_nuoji_skill_jihuapochan: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(removeN, removeB, removeNB, ownerPet.apply(ops.heal(150))),
      },
      effect_nuoji_skill_jihuamibu: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
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
      effect_nuoji_skill_wanshijubei: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.addMark(wanshi, { stack: 1 })),
      },
      effect_nuoji_skill_feiyiliancixi_floor: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, planActive, attackDamage),
        apply: contexts.damage.apply(ops.setDamageThreshold({ min: 165 })),
      },
      effect_nuoji_skill_dongfeng: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.addMark(dongFeng, { stack: 1 })),
      },
      effect_nuoji_skill_guailisaowei_power: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, nPlanActive),
        apply: contexts.skillUse.apply(ops.addPower(25)),
      },
      effect_nuoji_skill_guailisaowei_rage: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, bPlanActive),
        apply: ownerPet.apply(ops.addRage(20)),
      },
      effect_nuoji_skill_feiyuxiji_bonus: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, bPlanActive),
        apply: contexts.skillUse
          .flatMap(event => (event.actualTarget ? [event.actualTarget] : []))
          .apply(ops.dealDamage(65)),
      },
      effect_nuoji_mark_njihua_damage: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, attackDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 20, delta: 0 })),
      },
      effect_nuoji_mark_nbjihua_damage: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, attackDamage, conditions.not(nActive)),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 20, delta: 0 })),
      },
      effect_nuoji_mark_nbjihua_reduction: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, conditions.not(bActive)),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -20, delta: 0 })),
      },
      effect_nuoji_mark_dongfeng_speed: {
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        apply: ownerPet.apply(ops.addAttributeModifier('spe', 'delta', 50)),
      },
      effect_nuoji_mark_wanshi_consume: {
        triggers: [EffectTrigger.TurnEnd],
        priority: 0,
        when: conditions.all(
          conditions.ownerIsActive,
          windMarks.condition((_, marks) => marks.length > 0),
        ),
        apply: actions.sequence(windMarks.apply(ops.removeMark()), ownerPet.apply(ops.addMark(pendingHeal))),
      },
      effect_nuoji_mark_dongfeng_heal: {
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
