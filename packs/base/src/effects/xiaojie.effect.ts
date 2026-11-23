import {
  actions,
  conditions,
  contexts,
  DamageType,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
  values,
  type Action,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

const SHIQIESHI = 'mark_shiqieshi'
const CHENSHOUSHI = 'mark_chenshoushi'
const DUNJUSHI = 'mark_dunjushi'
const WUSHUANGSHI = 'mark_wushuangshi'
const WUSHUANGLI = 'mark_wushuangli'
const SHANGHAIZENGJIA = 'mark_shanghaizengjia'

const physicalDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Physical),
)
const specialDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Special),
)
const attackDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Physical || event.damageType === DamageType.Special),
)

const selfSpeUp = targets.ownerPet.apply(ops.changeStatStage('spe', 1))

function secondaryDebuff(roll: number, debuff: Action): Action {
  return actions.choose(conditions.chance(roll), debuff)
}

function weightPower(base: number): Action {
  return contexts.skillUse.apply(
    ops.addPower(
      values.choose(
        targets.ownerPet.condition((_, pets) => (pets[0]?.weight ?? 0) > 100),
        base,
        0,
      ),
    ),
  )
}

@effectGroup({ id: 'xiaojie' })
export class XiaojieEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const shiqieshi = marks.get(SHIQIESHI)
    const chenshoushi = marks.get(CHENSHOUSHI)
    const dunjushi = marks.get(DUNJUSHI)
    const wushuangshi = marks.get(WUSHUANGSHI)
    const wushuangli = marks.get(WUSHUANGLI)
    const shanghaizengjia = marks.get(SHANGHAIZENGJIA)
    if (!shiqieshi || !chenshoushi || !dunjushi || !wushuangshi || !wushuangli || !shanghaizengjia) {
      throw new Error('Missing xiaojie mark definitions')
    }

    return defineEffects({
      effect_xiaojie_ability_spe_down_atk_up: {
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: -1,
        when: conditions.all(
          conditions.ownerReceivesMark,
          conditions.statStageChange('spe', 'down'),
          contexts.addMark.condition((_, events) => events.some(event => event.available)),
        ),
        apply: targets.ownerPet.apply(ops.changeStatStage('atk', 1)),
      },
      effect_xiaojie_emblem_stance_next_attack: {
        triggers: [EffectTrigger.SkillUseEnd],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, events) =>
            events.some(event =>
              ['skill_shiqieshi', 'skill_chenshoushi', 'skill_dunjushi', 'skill_wushuangshi'].includes(
                event.skill.baseId,
              ),
            ),
          ),
        ),
        apply: targets.ownerPet.apply(ops.addMark(shanghaizengjia, { stack: 10 })),
      },
      effect_xiaojie_skill_shiqieshi: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(shiqieshi, { stack: 1 })),
      },
      effect_xiaojie_skill_bailietui: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(ops.setMultihit(values.randomInt(3, 5))),
      },
      effect_xiaojie_skill_baiguanluo: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: weightPower(65),
      },
      effect_xiaojie_skill_chenshoushi: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.firstSkillThisTurn),
        apply: targets.ownerPet.apply(ops.addMark(chenshoushi, { stack: 1 })),
      },
      effect_xiaojie_skill_dunjushi: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.firstSkillThisTurn),
        apply: targets.ownerPet.apply(ops.addMark(dunjushi, { stack: 1 })),
      },
      effect_xiaojie_skill_lishizhan: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(ops.setIgnoreShield()),
      },
      effect_xiaojie_skill_guiwushuang: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(shanghaizengjia, { stack: 40 })),
      },
      effect_xiaojie_skill_lishitu: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: secondaryDebuff(20, selfSpeUp),
      },
      effect_xiaojie_skill_chaojibaiguanluo: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: weightPower(70),
      },
      effect_xiaojie_skill_wushuangshi: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(wushuangshi, { stack: 1 })),
      },
      effect_xiaojie_mark_shiqieshi_damage: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          attackDamage,
          ctx => ctx.read(targets.sourceMark.first())?.duration === 1,
        ),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 40, delta: 0 })),
      },
      effect_xiaojie_mark_chenshoushi_block: {
        triggers: [EffectTrigger.OnDamageReplacement],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, physicalDamage),
        apply: contexts.damage.apply(ops.preventDamage({ fraction: 0.5, stacks: 1 })),
      },
      effect_xiaojie_mark_dunjushi_block: {
        triggers: [EffectTrigger.OnDamageReplacement],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, specialDamage),
        apply: contexts.damage.apply(ops.preventDamage({ fraction: 0.5, stacks: 1 })),
      },
      effect_xiaojie_mark_wushuangshi_absorb: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, attackDamage),
        apply: (ctx => {
          const lost = ctx.read(contexts.damageResult.select(result => result.hpLoss).first()) ?? 0
          const stacks = Math.floor(lost / 2)
          if (stacks > 0) targets.ownerPet.apply(ops.addMark(wushuangli, { stack: stacks }))(ctx)
          targets.ownerMarks.where(mark => mark.baseId === WUSHUANGSHI && mark.isActive).apply(ops.removeMark())(ctx)
        }) satisfies Action<EffectTrigger.OnDamage>,
      },
      effect_xiaojie_mark_wushuangli_consume: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: -1,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, events) => events[0]?.category !== 'Status'),
        ),
        apply: targets.sourceMark.apply(ops.removeMark()),
      },
    })
  }
}
