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
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_tanshe')),
      ),
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
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_xulitanshe')),
      ),
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
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_tanhuangtizhi')),
      ),
      apply: targets.ownerPet.apply(ops.addMark(tizhi, { stack: 1 })),
    }

    const zhongyatanshe = {
      triggers: [EffectTrigger.AfterUseSkillCheck] as const,
      priority: 0,
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_zhongyatanshe')),
      ),
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
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_dantiaolianji')),
      ),
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
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_tanhuangtujin')),
      ),
      apply: contexts.skillUse.apply(
        ops.addPower(contexts.skillUse.select(event => Math.min(2, event.pet.lastSkillUsedTimes - 1) * 50).first()),
      ),
    }

    const tanhuangbaozha = {
      triggers: [EffectTrigger.AfterUseSkillCheck] as const,
      priority: 0,
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_tanhuangbaozha')),
      ),
      apply: targets.ownerPet.apply(ops.addMark(baozha, { stack: 1 })),
    }

    const benghuaizhongquan = {
      triggers: [EffectTrigger.AfterUseSkillCheck] as const,
      priority: 0,
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.skillUse.condition((_, events) =>
          events.some(event => event.skill.baseId === 'skill_benghuaizhongquan'),
        ),
      ),
      apply: (ctx => {
        selfLossHp(50)(ctx)
      }) satisfies Action<EffectTrigger.AfterUseSkillCheck>,
    }

    const benghuaizhongquanKill = {
      triggers: [EffectTrigger.OnDefeat] as const,
      priority: 0,
      when: conditions.all(
        conditions.selfUsesSkill,
        hasBenghuai,
        contexts.skillUse.condition((_, events) =>
          events.some(event => event.skill.baseId === 'skill_benghuaizhongquan'),
        ),
      ),
      apply: healOnKill(0.17),
    }

    const benghuaizhinu = {
      triggers: [EffectTrigger.AfterUseSkillCheck] as const,
      priority: 0,
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_benghuaizhinu')),
      ),
      apply: (ctx => {
        selfLossHp(50)(ctx)
        if (hasBenghuai(ctx)) {
          contexts.skillUse.apply(ops.setSureHit())(ctx)
        }
      }) satisfies Action<EffectTrigger.AfterUseSkillCheck>,
    }

    const benghuaituji = {
      triggers: [EffectTrigger.AfterUseSkillCheck] as const,
      priority: 0,
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_benghuaituji')),
      ),
      apply: (ctx => {
        selfLossHp(50)(ctx)
      }) satisfies Action<EffectTrigger.AfterUseSkillCheck>,
    }

    const benghuaiyanmie = {
      triggers: [EffectTrigger.AfterUseSkillCheck] as const,
      priority: 0,
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_benghuaiyanmie')),
      ),
      apply: (ctx => {
        selfLossHp(50)(ctx)
      }) satisfies Action<EffectTrigger.AfterUseSkillCheck>,
    }

    const benghuaiyanmieKill = {
      triggers: [EffectTrigger.OnDefeat] as const,
      priority: 0,
      when: conditions.all(
        conditions.selfUsesSkill,
        hasBenghuai,
        contexts.skillUse.condition((_, events) => events.some(event => event.skill.baseId === 'skill_benghuaiyanmie')),
      ),
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
      effect_mimi_ability_tanli_on_hp_loss: tanliGainOnHpLoss,
      effect_mimi_ability_benghuai_power: benghuaiPower,
      effect_mimi_emblem_benghuai_reduction: emblemReduction,
      effect_mimi_emblem_benghuai_selfloss_reduction: emblemSelfLossReduction,
      effect_mimi_skill_tanshe: tanshe,
      effect_mimi_skill_xulitanshe: xulitanshe,
      effect_mimi_skill_tanhuangtizhi: tanhuangtizhi,
      effect_mimi_skill_zhongyatanshe: zhongyatanshe,
      effect_mimi_skill_dantiaolianji: dantiaolianji,
      effect_mimi_skill_tanhuangtujin: tanhuangtujin,
      effect_mimi_skill_tanhuangbaozha: tanhuangbaozha,
      effect_mimi_skill_benghuaizhongquan: benghuaizhongquan,
      effect_mimi_skill_benghuaizhongquan_kill: benghuaizhongquanKill,
      effect_mimi_skill_benghuaizhinu: benghuaizhinu,
      effect_mimi_skill_benghuaituji: benghuaituji,
      effect_mimi_skill_benghuaituji_priority: {
        triggers: [EffectTrigger.BeforeSort],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasBenghuai),
        apply: contexts.skillUse.property('priority').apply(ops.add(1)),
      },
      effect_mimi_skill_benghuaiyanmie: benghuaiyanmie,
      effect_mimi_skill_benghuaiyanmie_kill: benghuaiyanmieKill,
      effect_mimi_mark_tizhi_reflect: tizhiReflect,
      effect_mimi_mark_baozha_trigger: baozhaTrigger,
    })
  }
}
