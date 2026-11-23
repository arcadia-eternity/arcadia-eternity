import {
  actions,
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
  type Condition,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

const BLUE_WAVE = 'mark_lanbo'
const BERSERK = 'mark_baozou'
const CONFUSION = 'mark_hunmi'
const FEAR = 'mark_kongju'
const BLEED = 'mark_liuxie'
const VULNERABLE = 'mark_yishang'
const SHY_DODGE = 'mark_haixiuduobi'

@effectGroup({ id: 'qiaoba' })
export class QiaobaEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const blueWave = marks.get(BLUE_WAVE)
    const berserk = marks.get(BERSERK)
    const confusion = marks.get(CONFUSION)
    const fear = marks.get(FEAR)
    const bleed = marks.get(BLEED)
    const vulnerable = marks.get(VULNERABLE)
    const shyDodge = marks.get(SHY_DODGE)
    if (!blueWave || !berserk || !confusion || !fear || !bleed || !vulnerable || !shyDodge) {
      throw new Error('Missing qiaoba mark dependency')
    }

    const blueWaveStacks = targets.ownerMarks
      .where(mark => mark.baseId === BLUE_WAVE && mark.isActive)
      .first()
      .attribute('stack')
    const hasBlueWave =
      (minimum: number): Condition =>
      ctx =>
        (ctx.read(blueWaveStacks) ?? 0) >= minimum

    const addBlueWave = targets.ownerPet.apply(ops.addMark(blueWave, { stack: 1 }))
    const addBerserk = targets.ownerPet.apply(ops.addMark(berserk, { stack: 1 }))

    const opponentActive = targets.opponentActive
    const addConfusion = opponentActive.apply(ops.addMark(confusion, { stack: 1 }))
    const addFear = opponentActive.apply(ops.addMark(fear, { stack: 1 }))
    const addBleed = opponentActive.apply(ops.addMark(bleed, { stack: 50 }))
    const addVulnerable = opponentActive.apply(ops.addMark(vulnerable, { stack: 50 }))

    const selfAtkUp = targets.ownerPet.apply(ops.changeStatStage('atk', 1))
    const selfSpaUp = targets.ownerPet.apply(ops.changeStatStage('spa', 1))
    const selfSpdUp = targets.ownerPet.apply(ops.changeStatStage('spd', 1))

    const healQuarter = targets.ownerPet.apply(
      ops.heal(targets.ownerPet.select(pet => Math.floor(pet.stat.maxHp * 0.25)).first()),
    )

    const selfSkillUse = contexts.skillUse
    const selfSkillPower = selfSkillUse.apply(ops.addPower(35))
    const selfSkillSureHit = selfSkillUse.apply(ops.setSureHit())
    const selfSkillDoublePower = selfSkillUse.apply(ops.amplifyPower(2))
    const selfSkillSetMultihit4 = selfSkillUse.apply(ops.setMultihit(4))
    const selfSkillFreeRage = selfSkillUse.property('rage').apply(ops.assign(0))

    const firstThisTurn = conditions.firstSkillThisTurn

    return defineEffects({
      effect_qiaoba_ability_blue_wave_on_damage: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged),
        apply: addBlueWave,
      },
      effect_qiaoba_ability_berserk_on_three_waves: {
        triggers: [EffectTrigger.OnStack],
        priority: 0,
        when: ctx =>
          ctx.parent.existingMark.owner === ctx.read(targets.ownerPet.first()) &&
          ctx.parent.existingMark.baseId === BLUE_WAVE &&
          ctx.parent.stacksBefore < 3 &&
          ctx.parent.stacksAfter >= 3,
        apply: addBerserk,
      },
      effect_qiaoba_emblem_berserk_extra_turn: {
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_, additions) => additions.some(addition => addition.baseMark.id === BERSERK)),
        ),
        apply: contexts.addMark.apply(
          ops.setMarkDuration(
            contexts.addMark.select(event => (event.duration ?? event.baseMark.config.duration ?? 1) + 1).first(),
          ),
        ),
      },
      effect_qiaoba_skill_chongji_atk: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.chance(5)),
        apply: selfAtkUp,
      },
      effect_qiaoba_skill_jiaopao_spa: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.chance(5)),
        apply: selfSpaUp,
      },
      effect_qiaoba_skill_qianglizhijiao_power: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasBlueWave(1)),
        apply: selfSkillPower,
      },
      effect_qiaoba_skill_maopiqianghua_spd: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasBlueWave(1)),
        apply: selfSpdUp,
      },
      effect_qiaoba_skill_hongbo_heal: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(healQuarter, addBlueWave),
      },
      effect_qiaoba_skill_zhonglitieti_bleed: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasBlueWave(2)),
        apply: addBleed,
      },
      effect_qiaoba_skill_jiaoliqianghua_free: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasBlueWave(2)),
        apply: selfSkillFreeRage,
      },
      effect_qiaoba_skill_tiaoyuechongzhuang_first: {
        triggers: [EffectTrigger.BeforeSort],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, firstThisTurn),
        apply: selfSkillDoublePower,
      },
      effect_qiaoba_skill_wanliqianghua_spa: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasBlueWave(1)),
        apply: selfSpaUp,
      },
      effect_qiaoba_skill_ketichongpo_surehit: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasBlueWave(2)),
        apply: selfSkillSureHit,
      },
      effect_qiaoba_skill_naoliqianghua_vulnerable: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasBlueWave(2)),
        apply: addVulnerable,
      },
      effect_qiaoba_skill_chuixuezhiti_multihit: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasBlueWave(3)),
        apply: selfSkillSetMultihit4,
      },
      effect_qiaoba_skill_shizipaoti_confusion: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasBlueWave(3), conditions.chance(50)),
        apply: addConfusion,
      },
      effect_qiaoba_skill_haixiuduobi_mark: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(shyDodge, { stack: 1 })),
      },
      effect_qiaoba_skill_wuxianpohuai_fear: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasBlueWave(3)),
        apply: addFear,
      },
      effect_qiaoba_berserk_damage_out: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.damage.condition((_, hits) => hits.some(hit => hit.policy.skillReactions)),
        ),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 100, delta: 0 })),
      },
      effect_qiaoba_berserk_damage_in: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          contexts.damage.condition((_, hits) => hits.some(hit => hit.policy.skillReactions)),
        ),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 50, delta: 0 })),
      },
      effect_qiaoba_berserk_end_clear: {
        triggers: [EffectTrigger.OnMarkDurationEnd],
        priority: 0,
        when: contexts.consumeStack.condition((_, events) => events.some(event => event.mark.baseId === BERSERK)),
        apply: targets.ownerMarks.where(mark => mark.baseId === BLUE_WAVE).apply(ops.removeMark()),
      },
      effect_qiaoba_shy_dodge_evade: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.ownerIsSkillTarget,
        apply: contexts.skillUse.apply(ops.setSureMiss()),
      },
    })
  }
}
