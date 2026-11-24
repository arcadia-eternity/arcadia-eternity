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

const FENGWEN = 'mark_fengwen'
const ZHONGDU = 'mark_zhongdu'
const MABI = 'mark_mabi'
const QINGFENGZHIWU = 'mark_qingfengzhiwu'

const FENGWEN_MAX = 3

@effectGroup({ id: 'fengyong' })
export class FengyongEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const fengwen = marks.get(FENGWEN)
    const mabi = marks.get(MABI)
    const qingfengzhiwu = marks.get(QINGFENGZHIWU)
    if (!fengwen || !mabi || !qingfengzhiwu) {
      throw new Error('Missing fengyong mark dependency')
    }

    const opponentFengwen = targets.opponentActive
      .flatMap(pet => pet.marks)
      .where(mark => mark.baseId === FENGWEN && mark.isActive)
    const opponentFengwenStack = opponentFengwen.first().attribute('stack')

    const opponentHasFengwen = opponentFengwen.condition((_, list) => list.length > 0)
    const opponentHasZhongdu = targets.opponentActive
      .flatMap(pet => pet.marks)
      .where(mark => mark.baseId === ZHONGDU && mark.isActive)
      .condition((_, list) => list.length > 0)

    const addFengwen = targets.opponentActive.apply(ops.addMark(fengwen!, { stack: 1 }))
    const addMabi = targets.opponentActive.apply(ops.addMark(mabi))

    const spendOneFengwen = opponentFengwen.apply(ops.consumeStacks(1))
    const spendAllFengwen = opponentFengwen.apply(ops.consumeStacks(opponentFengwen.first().attribute('stack')))

    function onHitAddFengwen(): Action {
      return actions.choose(conditions.selfUsesSkill, addFengwen)
    }

    function onHitConsumeFengwenForMabi(): Action {
      return actions.choose(
        conditions.all(conditions.selfUsesSkill, opponentHasFengwen),
        actions.sequence(spendOneFengwen, addMabi),
      )
    }

    function onHitConsumeFengwenForFixedDamage(amount: number): Action {
      const dealFixed = targets.opponentActive.apply(ops.dealDamage(amount))
      return actions.choose(
        conditions.all(conditions.selfUsesSkill, opponentHasFengwen),
        actions.sequence(spendOneFengwen, dealFixed),
      )
    }

    function statusSelfBuffWithFengwenBonus(
      baseStat: 'atk' | 'def' | 'spa' | 'spd' | 'spe',
      baseAmount: number,
      bonusStat: 'atk' | 'def' | 'spa' | 'spd' | 'spe',
      bonusAmount: number,
    ): Action {
      const baseApply = targets.ownerPet.apply(ops.changeStatStage(baseStat, baseAmount))
      const bonusApply = targets.ownerPet.apply(ops.changeStatStage(bonusStat, bonusAmount))
      return actions.choose(
        conditions.selfUsesSkill,
        actions.choose(opponentHasFengwen, actions.sequence(spendOneFengwen, bonusApply), baseApply),
      )
    }

    function statusHealPerFengwen(perStack: number): Action {
      const healAmount = values.combine(
        opponentFengwenStack,
        values.choose(opponentHasFengwen, 1, 0),
        (stack, present) => (present === 1 ? stack * perStack : 0),
      )
      const heal = targets.ownerPet.apply(ops.heal(healAmount))
      return actions.choose(conditions.selfUsesSkill, actions.sequence(heal, spendAllFengwen))
    }

    function statusSelfMark(mark: NonNullable<typeof qingfengzhiwu>): Action {
      const apply = targets.ownerPet.apply(ops.addMark(mark))
      return actions.choose(conditions.selfUsesSkill, apply)
    }

    function raiseFengwenToThree(): Action {
      const current = opponentFengwenStack
      const target = values.combine(current, values.choose(opponentHasFengwen, 1, 0), (stack, present) =>
        present === 1 ? Math.max(0, FENGWEN_MAX - stack) : 0,
      )
      const add = targets.opponentActive.apply(ops.addMark(fengwen!, { stack: target }))
      return actions.choose(conditions.all(conditions.selfUsesSkill, opponentHasFengwen), add)
    }

    return defineEffects({
      effect_ability_refresh_opponent_zhongdu_duration_on_damage: {
        triggers: [EffectTrigger.OnDamage] as const,
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentHasZhongdu),
        apply: targets.opponentActive
          .flatMap(pet => pet.marks)
          .where(mark => mark.baseId === ZHONGDU && mark.isActive)
          .apply(ops.refreshMarkDuration()),
      },
      effect_emblem_heal_10_percent_damage_dealt_to_opponent_if_has_fengwen: {
        triggers: [EffectTrigger.OnDamage] as const,
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.damageTargetBelongsToOtherPlayer, opponentHasFengwen),
        apply: targets.ownerPet.apply(
          ops.heal(contexts.damageResult.select(result => Math.floor(result.hpLoss * 0.1)).first()),
        ),
      },
      effect_skill_add_mark_opponent_fengwen: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        apply: onHitAddFengwen(),
      },
      effect_skill_consume_opponent_fengwen_1_to_add_mabi: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        apply: onHitConsumeFengwenForMabi(),
      },
      effect_skill_consume_opponent_fengwen_1_to_raise_spe_1_stage_else_raise_spa_1_stage: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.BeforeHit] as const,
        priority: 0,
        apply: statusSelfBuffWithFengwenBonus('spa', 1, 'spe', 1),
      },
      effect_skill_heal_self_60_per_opponent_fengwen_and_consume_all: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        apply: statusHealPerFengwen(60),
      },
      effect_skill_consume_opponent_fengwen_1_to_deal_fixed_damage_50: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        apply: onHitConsumeFengwenForFixedDamage(50),
      },
      effect_skill_add_multihit_per_opponent_fengwen_and_consume_all: {
        triggers: [EffectTrigger.BeforeMultiHit],
        when: conditions.all(conditions.selfUsesSkill, opponentHasFengwen),
        apply: actions.sequence(contexts.skillUse.apply(ops.addMultihitResult(opponentFengwenStack)), spendAllFengwen),
      },
      effect_skill_add_mark_self_qingfengzhiwu_after_check: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.AfterUseSkillCheck] as const,
        priority: 0,
        apply: statusSelfMark(qingfengzhiwu),
      },
      effect_skill_raise_existing_opponent_fengwen_to_3: {
        when: conditions.selfUsesSkill,
        triggers: [EffectTrigger.OnHit] as const,
        priority: 0,
        apply: raiseFengwenToThree(),
      },
      effect_mark_increase_owner_evasion_50_percent_before_damage: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage] as const,
        priority: 0,
        apply: targets.ownerPet.apply(ops.addAttributeModifier('evasion', 'percent', 50)),
      },
    })
  }
}
