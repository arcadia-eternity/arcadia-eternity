import {
  DamageType,
  actions,
  checks,
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
  type Action,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

import { preventedBySourceMark } from './damage-benefits.effect'

const ABILITY = 'mark_ability_abu'
const EMBLEM = 'mark_emblem_abu'
const CURSE = 'mark_zuzhou'
const BANDAGE_SUBSTITUTE = 'mark_bengdaitishen'
const ABU_RESENTMENT = 'mark_abuzhiyuan'
const MENTAL_RESTRAINT = 'mark_xinlingzhiyue'

const opponentActive = targets.opponentActive
const ownerPet = targets.ownerPet

function debuffOnHit(stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe', chance: number, amount: number): Action {
  return actions.choose(
    conditions.all(conditions.selfUsesSkill, conditions.chance(chance)),
    opponentActive.apply(ops.changeStatStage(stat, amount)),
  )
}

@effectGroup({ id: 'abu' })
export class AbuEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const curse = marks.get(CURSE)
    const bandageSubstitute = marks.get(BANDAGE_SUBSTITUTE)
    const abuResentment = marks.get(ABU_RESENTMENT)
    const mentalRestraint = marks.get(MENTAL_RESTRAINT)
    if (!curse || !bandageSubstitute || !abuResentment || !mentalRestraint) {
      throw new Error('Missing required Abu marks')
    }

    const ownerHasAbility = targets.ownerMarks.where(mark => mark.baseId === ABILITY && mark.isActive)
    const ownerHasEmblem = targets.ownerMarks.where(mark => mark.baseId === EMBLEM && mark.isActive)
    const ownerHasResentment = targets.ownerMarks.where(mark => mark.baseId === ABU_RESENTMENT && mark.isActive)

    return defineEffects({
      effect_abu_ability_rage_drain: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          conditions.firstSkillThisTurn,
          conditions.ownerIsActive,
          ownerHasAbility.condition(checks.exists()),
        ),
        apply: targets.opponentPlayer.apply(ops.reduceRage(10)),
      },
      effect_abu_emblem_curse_reduction: {
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerAddsMark,
          ownerHasEmblem.condition(checks.exists()),
          contexts.addMark.condition((_, events) => events.some(({ baseMark }) => baseMark.id === CURSE)),
        ),
        apply: contexts.addMark.apply(ops.setMarkDuration(2)),
      },
      effect_abu_skill_zuzhoubengdai: {
        triggers: [EffectTrigger.BeforeHit],
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, events) =>
            events.some(({ pet, skill }) => pet.lastSkillUsedTimes > 1 && pet.lastMissedSkillId !== skill.baseId),
          ),
        ),
        apply: opponentActive.apply(ops.changeStatStage('def', -1)),
      },
      effect_abu_skill_bengdaichanrao: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: debuffOnHit('spe', 1, -1),
      },
      effect_abu_skill_bengdaitishen: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.addMark(bandageSubstitute, { stack: 1 })),
      },
      effect_abu_skill_abuzuzhou: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: opponentActive.apply(ops.addMark(curse, { stack: 1 })),
      },
      effect_abu_skill_beishangfanji: {
        triggers: [EffectTrigger.BeforeSort],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.property('priority').apply(ops.add(-1)),
      },
      effect_abu_skill_abuzhiyuan: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.addMark(abuResentment, { stack: 1 })),
      },
      effect_abu_skill_abuhaoku: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: ownerPet.apply(ops.addMark(mentalRestraint, { stack: 1 })),
      },
      effect_abu_skill_yuanqixiaosan: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ownerHasResentment.condition(checks.exists())),
        apply: actions.sequence(
          ownerHasResentment.apply(ops.removeMark()),
          opponentActive.apply(ops.dealDamage(100, { damageType: DamageType.Effect, policy: { shields: false } })),
        ),
      },
      effect_abu_resentment_rage_shield: {
        triggers: [EffectTrigger.OnDamageReplacement],
        when: ctx =>
          conditions.selfBeDamaged(ctx) &&
          ctx.parent.origin.trigger !== 'effect' &&
          (ctx.parent.damageType === DamageType.Physical || ctx.parent.damageType === DamageType.Special),
        apply: contexts.damage.apply(
          ops.preventDamage({
            amount: targets.ownerPet.first().map(pet => pet.currentRage * 2),
            stacks: 1,
          }),
        ),
      },
      effect_abu_resentment_spend_rage: {
        triggers: [EffectTrigger.OnConsumeStack],
        when: ctx => ctx.parent.reason === 'rule' && ctx.parent.mark === ctx.read(targets.sourceMark.first()),
        apply: ctx => {
          // The stack authorizes each hit. Rage pays for prevention until the mark expires.
          targets.sourceMark.apply(ops.addStacks(1))(ctx)
          ownerPet.apply(ops.reduceRage(Math.ceil(preventedBySourceMark(ctx) / 2)))(ctx)
        },
      },
      effect_abu_resentment_no_rage_cost: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          ownerHasResentment.condition(checks.exists()),
          contexts.skillUse.condition((_, events) => events.some(event => event.category !== 'Climax')),
        ),
        apply: contexts.skillUse.property('rage').apply(ops.assign(0)),
      },
      effect_abu_bandage_substitute_double_rage: {
        triggers: [EffectTrigger.BeforeRageGain],
        priority: 0,
        when: conditions.ownerReceivesDamageRage,
        apply: actions.sequence(
          contexts.rage.apply(ops.modifyRage({ percent: 100, delta: 0 })),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      },
    })
  }
}
