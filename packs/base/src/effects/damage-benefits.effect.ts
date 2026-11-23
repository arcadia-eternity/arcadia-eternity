import { effectGroup } from '@arcadia-eternity/battle/effect-loading'
import {
  defineEffects,
  EffectTrigger,
  conditions,
  contexts,
  targets,
  ops,
  type EffectFrame,
} from '@arcadia-eternity/battle/authoring'

/** Count only prevention committed by this mark, even when several defenses cover one hit. */
export function preventedBySourceMark(ctx: EffectFrame<EffectTrigger.OnConsumeStack>): number {
  const mark = ctx.parent.mark
  const ruleIds = mark.effects.map(effect => JSON.stringify([mark.id, effect.id]))
  const trace = ctx.read(contexts.damageResult.first())?.trace ?? []
  return trace.reduce(
    (amount, step) =>
      step.kind === 'prevent' && ruleIds.includes(step.id) ? amount + step.before - step.after : amount,
    0,
  )
}

export const officialDamageBenefitEffects = defineEffects({
  effect_mark_reflect_prevented_attack_damage: {
    triggers: [EffectTrigger.OnConsumeStack],
    when: ctx => ctx.parent.reason === 'rule' && ctx.parent.mark === ctx.read(targets.sourceMark.first()),
    apply: ctx => targets.damageOriginPet.apply(ops.dealDamage(preventedBySourceMark(ctx)))(ctx),
  },
  effect_mark_consume_on_incoming_attack_hit: {
    triggers: [EffectTrigger.BeforeHit],
    when: conditions.all(
      conditions.ownerIsSkillTarget,
      contexts.skillUse.condition((_, uses) => uses.some(use => use.category !== 'Status')),
    ),
    apply: targets.sourceMark.apply(ops.removeMark()),
  },
  effect_mark_spend_half_rage_on_damage_prevention: {
    triggers: [EffectTrigger.OnConsumeStack],
    when: ctx => ctx.parent.reason === 'rule' && ctx.parent.mark === ctx.read(targets.sourceMark.first()),
    apply: targets.ownerPet.apply(ops.reduceRage(targets.ownerPet.first().map(pet => Math.floor(pet.currentRage / 2)))),
  },
  effect_skill_heal_25_percent_damage_dealt: {
    triggers: [EffectTrigger.OnDamage],
    when: conditions.selfUsesSkill,
    apply: targets.ownerPet.apply(
      ops.heal(contexts.damageResult.select(event => Math.floor(event.hpLoss * 0.25)).first()),
    ),
  },
  effect_skill_add_rage_25_if_damage_over_100: {
    triggers: [EffectTrigger.OnDamage],
    when: conditions.all(
      conditions.selfUsesSkill,
      contexts.damageResult.condition((_ctx, events) => events.some(event => event.hpLoss > 100)),
    ),
    apply: targets.ownerPet.apply(ops.addRage(25)),
  },
  effect_skill_crit_gain_rage_20: {
    triggers: [EffectTrigger.OnCritPostDamage],
    when: conditions.selfUsesSkill,
    apply: targets.ownerPet.apply(ops.addRage(20)),
  },
})

@effectGroup({ id: 'damage-benefits' })
export class DamageBenefitsEffects {
  static build() {
    return officialDamageBenefitEffects
  }
}
