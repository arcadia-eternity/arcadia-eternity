import {
  DamageType,
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
  type Action,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

const TANLI = 'mark_tanli'
const BENGHAUI = 'mark_benghuai'
const TANHUANG_TIZHI = 'mark_tanhuangtizhi'
const TANHUANG_BAOZHA = 'mark_tanhuangbaozha'

const TANLI_CAP = 200

@effectGroup({ id: 'mimi' })
export class MimiEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const tanli = marks.get(TANLI)
    const benghuai = marks.get(BENGHAUI)
    const tizhi = marks.get(TANHUANG_TIZHI)
    const baozha = marks.get(TANHUANG_BAOZHA)
    if (!tanli || !benghuai || !tizhi || !baozha) {
      throw new Error('Missing mimi marks')
    }

    const tanliStacks = targets.ownerMarks
      .where(mark => mark.baseId === TANLI && mark.isActive)
      .first()
      .attribute('stack')
    const hasBenghuai = targets.ownerMarks
      .where(mark => mark.baseId === BENGHAUI && mark.isActive)
      .condition((_, found) => found.length > 0)
    const tanliMark = targets.ownerMarks.where(mark => mark.baseId === TANLI && mark.isActive)
    const spendTanli = (amount: number) => tanliMark.apply(ops.consumeStacks(amount))
    const addTanli = (amount: number) => targets.ownerPet.apply(ops.addMark(tanli, { stack: amount }))

    const attackDamage = contexts.damage.condition((_, events) =>
      events.some(event => event.damageType === DamageType.Physical || event.damageType === DamageType.Special),
    )

    const benghuaiSkill = contexts.skillUse.condition((_, events) =>
      events.some(event => event.skill.baseId.startsWith('skill_benghuai')),
    )

    const benghuaiSkillDamage = conditions.all(conditions.ownerUsesSkill, benghuaiSkill)

    const healOnKill = (fraction: number): Action<EffectTrigger.OnDefeat> =>
      targets.ownerPet.apply(
        ops.heal(
          targets.ownerPet
            .first()
            .attribute('maxHp')
            .map(max => Math.floor(max * fraction)),
        ),
      )

    const selfLossHp = (amount: number): Action<EffectTrigger.AfterUseSkillCheck> =>
      targets.ownerPet.apply(
        ops.dealDamage(amount, { damageType: DamageType.Effect, policy: { skillModifiers: true } }),
      )

    const tanliGainOnHpLoss = {
      triggers: [EffectTrigger.OnDamage] as const,
      priority: 0,
      when: conditions.all(
        conditions.selfBeDamaged,
        conditions.not(hasBenghuai),
        contexts.damageResult.condition((_, results) => results.some(result => result.hpLoss > 0)),
      ),
      apply: (ctx => {
        const loss = ctx.read(contexts.damageResult.select(result => result.hpLoss).first()) ?? 0
        if (loss > 0) {
          const before = ctx.read(tanliStacks) ?? 0
          addTanli(loss)(ctx)
          if (before + loss >= TANLI_CAP) targets.ownerPet.apply(ops.addMark(benghuai))(ctx)
        }
      }) satisfies Action<EffectTrigger.OnDamage>,
    }

    const benghuaiPower = {
      triggers: [EffectTrigger.AfterUseSkillCheck] as const,
      priority: 0,
      when: conditions.all(benghuaiSkillDamage, hasBenghuai),
      apply: contexts.skillUse.apply(ops.addPower(contexts.skillUse.select(event => event.skill.power).first())),
    }

    const emblemReduction = {
      triggers: [EffectTrigger.OnBeforeCalculateDamage] as const,
      priority: 0,
      when: conditions.all(conditions.selfBeDamaged, attackDamage, hasBenghuai),
      apply: contexts.damage.apply(ops.modifyDamage({ percent: 0, delta: -25 })),
    }

    const emblemSelfLossReduction = {
      triggers: [EffectTrigger.OnBeforeCalculateDamage] as const,
      priority: 0,
      when: conditions.all(
        conditions.selfBeDamaged,
        hasBenghuai,
        contexts.damage.condition((_, events) =>
          events.some(event => event.damageType === DamageType.Effect && event.origin.petId === event.target.id),
        ),
      ),
      apply: contexts.damage.apply(ops.modifyDamage({ percent: 0, delta: -25 })),
    }

    const tanshe = {
      triggers: [EffectTrigger.AfterUseSkillCheck] as const,
      priority: 0,
      when: conditions.selfUsesSkill,
      apply: (ctx => {
        const stacks = ctx.read(tanliStacks) ?? 0
        if (stacks >= 40) {
          spendTanli(40)(ctx)
          contexts.skillUse.apply(ops.addPower(contexts.skillUse.select(event => event.skill.power).first()))(ctx)
        }
      }) satisfies Action<EffectTrigger.AfterUseSkillCheck>,
    }

    const xulitanshe = {
      triggers: [EffectTrigger.AfterUseSkillCheck] as const,
      priority: 0,
      when: conditions.selfUsesSkill,
      apply: (ctx => {
        const stacks = ctx.read(tanliStacks) ?? 0
        if (stacks >= 50) {
          spendTanli(50)(ctx)
          contexts.skillUse.apply(ops.addPower(contexts.skillUse.select(event => event.skill.power).first()))(ctx)
        }
      }) satisfies Action<EffectTrigger.AfterUseSkillCheck>,
    }

    const tanhuangtizhi = {
      triggers: [EffectTrigger.AfterUseSkillCheck] as const,
      priority: 0,
      when: conditions.selfUsesSkill,
      apply: targets.ownerPet.apply(ops.addMark(tizhi, { stack: 1 })),
    }

    const zhongyatanshe = {
      triggers: [EffectTrigger.AfterUseSkillCheck] as const,
      priority: 0,
      when: conditions.selfUsesSkill,
      apply: (ctx => {
        const stacks = ctx.read(tanliStacks) ?? 0
        if (stacks >= 50) {
          spendTanli(50)(ctx)
          contexts.skillUse.apply(ops.setSureHit())(ctx)
        }
      }) satisfies Action<EffectTrigger.AfterUseSkillCheck>,
    }

    const dantiaolianji = {
      triggers: [EffectTrigger.BeforeMultiHit] as const,
      priority: 0,
      when: conditions.selfUsesSkill,
      apply: (ctx => {
        const stacks = ctx.read(tanliStacks) ?? 0
        const extra = Math.min(5, Math.floor(stacks / 40))
        if (extra > 0) {
          spendTanli(extra * 40)(ctx)
          contexts.skillUse.apply(ops.addMultihitResult(extra))(ctx)
        }
      }) satisfies Action<EffectTrigger.BeforeMultiHit>,
    }

    const tanhuangtujin = {
      triggers: [EffectTrigger.AfterUseSkillCheck] as const,
      priority: 0,
      when: conditions.selfUsesSkill,
      apply: contexts.skillUse.apply(
        ops.addPower(contexts.skillUse.select(event => Math.min(2, event.pet.lastSkillUsedTimes - 1) * 50).first()),
      ),
    }

    const tanhuangbaozha = {
      triggers: [EffectTrigger.AfterUseSkillCheck] as const,
      priority: 0,
      when: conditions.selfUsesSkill,
      apply: targets.ownerPet.apply(ops.addMark(baozha, { stack: 1 })),
    }

    const benghuaizhongquanKill = {
      triggers: [EffectTrigger.OnDefeat] as const,
      priority: 0,
      when: conditions.all(conditions.selfUsesSkill, hasBenghuai),
      apply: healOnKill(0.17),
    }

    const benghuaizhinu = {
      triggers: [EffectTrigger.AfterUseSkillCheck] as const,
      priority: 0,
      when: conditions.selfUsesSkill,
      apply: (ctx => {
        selfLossHp(50)(ctx)
        if (hasBenghuai(ctx)) {
          contexts.skillUse.apply(ops.setSureHit())(ctx)
        }
      }) satisfies Action<EffectTrigger.AfterUseSkillCheck>,
    }

    const benghuaiyanmieKill = {
      triggers: [EffectTrigger.OnDefeat] as const,
      priority: 0,
      when: conditions.all(conditions.selfUsesSkill, hasBenghuai),
      apply: targets.ownerPet.apply(ops.changeStatStage('spa', 1)),
    }

    const tizhiReflect = {
      triggers: [EffectTrigger.OnDamage] as const,
      priority: 0,
      when: conditions.all(
        conditions.selfBeDamaged,
        attackDamage,
        targets.ownerMarks
          .where(mark => mark.baseId === TANHUANG_TIZHI && mark.isActive)
          .condition((_, found) => found.length > 0),
      ),
      apply: targets.damageOriginPet.apply(ops.dealDamage(30)),
    }

    const baozhaTrigger = {
      triggers: [EffectTrigger.OnDamage] as const,
      priority: 0,
      when: conditions.all(
        conditions.selfBeDamaged,
        targets.ownerMarks
          .where(mark => mark.baseId === TANHUANG_BAOZHA && mark.isActive)
          .condition((_, found) => found.length > 0),
      ),
      apply: (ctx => {
        const stacks = ctx.read(tanliStacks) ?? 0
        if (stacks > 0) {
          spendTanli(stacks)(ctx)
          targets.opponentActive.apply(ops.dealDamage(stacks, { damageType: DamageType.Effect }))(ctx)
        }
        targets.ownerMarks.where(mark => mark.baseId === TANHUANG_BAOZHA && mark.isActive).apply(ops.removeMark())(ctx)
      }) satisfies Action<EffectTrigger.OnDamage>,
    }

    return defineEffects({
      effect_ability_gain_tanli_on_hp_loss_and_add_benghuai_at_200: tanliGainOnHpLoss,
      effect_ability_double_benghuai_skill_power_with_benghuai_mark: benghuaiPower,
      effect_emblem_reduce_attack_damage_taken_25_with_benghuai: emblemReduction,
      effect_emblem_reduce_self_inflicted_effect_damage_25_with_benghuai: emblemSelfLossReduction,
      effect_skill_consume_40_tanli_to_double_power_after_check: tanshe,
      effect_skill_consume_50_tanli_to_double_power_after_check: xulitanshe,
      effect_skill_add_mark_self_tanhuangtizhi_after_check: tanhuangtizhi,
      effect_skill_consume_50_tanli_to_set_sure_hit_after_check: zhongyatanshe,
      effect_skill_consume_40_tanli_per_extra_hit_up_to_5: dantiaolianji,
      effect_skill_add_power_50_per_consecutive_use_up_to_100_after_check: tanhuangtujin,
      effect_skill_add_mark_self_tanhuangbaozha_after_check: tanhuangbaozha,
      effect_skill_deal_self_50_effect_damage_with_skill_modifiers_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: selfLossHp(50),
      },
      effect_skill_heal_self_17_percent_max_hp_on_defeat_if_benghuai: benghuaizhongquanKill,
      effect_skill_deal_self_50_effect_damage_then_set_sure_hit_if_benghuai_after_check: benghuaizhinu,
      effect_skill_raise_priority_1_with_benghuai: {
        triggers: [EffectTrigger.BeforeSort],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasBenghuai),
        apply: contexts.skillUse.property('priority').apply(ops.add(1)),
      },
      effect_skill_raise_spa_1_stage_on_defeat_if_benghuai: benghuaiyanmieKill,
      effect_mark_deal_30_fixed_damage_to_attacker_when_tanhuangtizhi_takes_attack_damage: tizhiReflect,
      effect_mark_consume_tanhuangbaozha_and_deal_damage_equal_to_tanli_spent_on_damage_taken: baozhaTrigger,
    })
  }
}
