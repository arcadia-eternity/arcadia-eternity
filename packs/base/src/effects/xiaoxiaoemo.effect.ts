import {
  actions,
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
  type Action,
  type Condition,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

const CONTRACT = 'mark_emoqiyue'
const FEAR = 'mark_kongju'

const opponentHasContract = targets.opponentActive.condition((_, pets) =>
  pets.some(pet => pet.marks.some(mark => mark.baseId === CONTRACT && mark.isActive)),
)

const ownerHpBelowOpponent: Condition = ctx => {
  const owner = ctx.read(targets.ownerPet.first())
  const opponent = ctx.read(targets.opponentActive.first())
  return !!owner && !!opponent && owner.currentHp < opponent.currentHp
}

const ownerHpBelowFraction = (fraction: number) =>
  targets.ownerPet.condition((_, pets) => {
    const owner = pets[0]
    return owner ? owner.currentHp < owner.stat.maxHp * fraction : false
  })

const critDamage = contexts.damage.condition((_, events) => events.some(event => event.crit))

const opponentActive = targets.opponentActive
const ownerActive = targets.ownerPet

function contractConditional(action: Action) {
  return actions.choose(opponentHasContract, action)
}

@effectGroup({ id: 'xiaoxiaoemo' })
export class XiaoxiaoemoEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const contract = marks.get(CONTRACT)
    const fear = marks.get(FEAR)
    if (!contract || !fear) throw new Error('Missing contract or fear mark')

    return defineEffects({
      effect_mark_heal_self_30_on_non_crit_damage_taken: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, conditions.not(critDamage)),
        apply: ownerActive.apply(ops.heal(30)),
      },
      effect_ability_heal_self_60_on_crit_damage_if_opponent_has_mark_emoqiyue: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, critDamage, opponentHasContract),
        apply: ownerActive.apply(ops.heal(60)),
      },
      effect_emblem_reduce_incoming_crit_damage_20_percent_if_last_ally_alive: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          critDamage,
          targets.ownerPet.condition((_, pets) =>
            pets.some(pet => pet.owner?.team.every(ally => ally === pet || !ally.isAlive)),
          ),
        ),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -20, delta: 0 })),
      },
      effect_skill_reduce_opponent_atk_1_stage_and_spa_1_stage_if_opponent_has_mark_emoqiyue: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          opponentActive.apply(ops.changeStatStage('atk', -1)),
          contractConditional(opponentActive.apply(ops.changeStatStage('spa', -1))),
        ),
      },
      effect_skill_add_mark_opponent_emoqiyue: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: opponentActive.apply(ops.addMark(contract)),
      },
      effect_skill_sure_hit_if_opponent_has_mark_emoqiyue_before_check: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasContract),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_skill_raise_spa_1_stage_on_miss: {
        triggers: [EffectTrigger.OnMiss],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerActive.apply(ops.changeStatStage('spa', 1)),
      },
      effect_skill_add_multihit_2_if_opponent_has_mark_emoqiyue: {
        triggers: [EffectTrigger.BeforeMultiHit],
        when: conditions.all(conditions.selfUsesSkill, opponentHasContract),
        apply: contexts.skillUse.apply(ops.addMultihitResult(2)),
      },
      effect_skill_add_opponent_rage_10_on_hit: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: opponentActive.apply(ops.addRage(10)),
      },
      effect_skill_heal_self_60_if_hp_lt_opponent_on_hit: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ownerHpBelowOpponent),
        apply: ownerActive.apply(ops.heal(60)),
      },
      effect_skill_add_mark_opponent_kongju_20_percent_if_opponent_has_mark_emoqiyue: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasContract, conditions.chance(20)),
        apply: opponentActive.apply(ops.addMark(fear)),
      },
      effect_skill_add_crit_rate_30_percent_if_hp_lt_opponent: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ownerHpBelowOpponent),
        apply: contexts.skillUse.apply(ops.addCritRate(30)),
      },
      effect_skill_add_power_30_if_opponent_has_mark_emoqiyue: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasContract),
        apply: contexts.skillUse.apply(ops.addPower(30)),
      },
      effect_skill_heal_self_25_percent_max_hp_if_hp_below_12_5_percent_on_hit: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ownerHpBelowFraction(0.125)),
        apply: ownerActive.apply(ops.heal(targets.ownerPet.select(pet => pet.stat.maxHp * 0.25).first())),
      },
      effect_skill_deal_self_25_percent_max_hp_damage_and_add_rage_35: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          ownerActive.apply(ops.dealDamage(targets.ownerPet.select(pet => pet.stat.maxHp * 0.25).first())),
          ownerActive.apply(ops.addRage(35)),
        ),
      },
      effect_skill_add_priority_1_if_opponent_has_mark_emoqiyue: {
        triggers: [EffectTrigger.BeforeSort],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasContract),
        apply: contexts.skillUse.property('priority').apply(ops.add(1)),
      },
      effect_skill_increase_damage_50_percent_if_opponent_has_mark_emoqiyue: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasContract),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 50, delta: 0 })),
      },
    })
  }
}
