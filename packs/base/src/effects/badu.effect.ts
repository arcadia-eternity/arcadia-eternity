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

function spdStageUp(percent: number) {
  return {
    triggers: [EffectTrigger.OnHit] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, conditions.chance(percent)),
    apply: targets.ownerPet.apply(ops.changeStatStage('spd', 1)),
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
      effect_badu_ability_spd_reduction: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, specialDamage, ctx => (ctx.read(specialDefense) ?? 0) > 500),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -10, delta: 0 })),
      },
      effect_badu_emblem_linggui_reduction: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          attackDamage,
          hasLinggui.condition((_, found) => found.length > 0),
        ),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -5, delta: 0 })),
      },
      effect_badu_skill_shihunlinggui: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(linggui, { stack: 1 })),
      },
      effect_badu_skill_linghunzhifa: spdBonusDamage(5, 100),
      effect_badu_skill_linghunsuiji: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: opponentActive.apply(ops.addMark(suiji, { stack: 1 })),
      },
      effect_badu_skill_linghunlianda: spdMultihit(100, 6),
      effect_badu_skill_hunguituji: spdStageUp(10),
      effect_badu_skill_zhuhunyiji: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(ops.setIgnoreStageStrategy('positive')),
      },
      effect_badu_skill_youhunlinggui: {
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
      effect_badu_skill_dizhishang: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: opponentActive.apply(ops.addMark(dizhishang, { stack: 1 })),
      },
      effect_badu_skill_linghunzhuanzhu: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_badu_skill_linghunjidang: {
        triggers: [EffectTrigger.AfterUseSkillCheck, EffectTrigger.OnHit],
        priority: 0,
        when: (ctx =>
          ctx.trigger === EffectTrigger.AfterUseSkillCheck
            ? conditions.selfUsesSkill(ctx)
            : conditions.all(conditions.selfUsesSkill, conditions.chance(20))(ctx)) satisfies Condition<
          EffectTrigger.AfterUseSkillCheck | EffectTrigger.OnHit
        >,
        apply: (ctx => {
          if (ctx.trigger === EffectTrigger.AfterUseSkillCheck) {
            contexts.skillUse.apply(ops.setSureHit())(ctx)
          } else {
            targets.ownerPet.apply(ops.changeStatStage('spd', 1))(ctx)
          }
        }) satisfies Action<EffectTrigger.AfterUseSkillCheck | EffectTrigger.OnHit>,
      },
      effect_badu_skill_lihunsuiji: spdBonusDamage(10, 100),
      effect_badu_skill_lihunlianda: spdMultihit(100, 6),
      effect_badu_skill_fankangyishi: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(fankang, { stack: 1 })),
      },
      effect_badu_skill_lihunlinggui: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(lihunlinggui, { stack: 1 })),
      },
      effect_badu_mark_shihunlinggui_trigger: {
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
      effect_badu_mark_lihunlinggui_shield: {
        triggers: [EffectTrigger.OnDamageReplacement],
        when: conditions.all(conditions.selfBeDamaged, strikeDamage),
        apply: contexts.damage.apply(
          ops.preventDamage({ amount: targets.ownerPet.first().map(pet => pet.currentRage * 2), stacks: 1 }),
        ),
      },
      effect_badu_mark_fankangyishi_rage: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.ownerUsesSkill, conditions.ownerIsActive),
        apply: targets.ownerPet.apply(ops.addRage(10)),
      },
      effect_badu_mark_linghunsuiji_weaken: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, attackDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -50, delta: 0 })),
      },
      effect_badu_mark_linghunsuiji_consume: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.sourceMark.apply(ops.removeMark()),
      },
      effect_badu_mark_dizhishang_amplify: {
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
