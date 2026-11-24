import {
  DamageType,
  actions,
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

const BURN = 'mark_shaoshang'
const CONFUSION = 'mark_hunmi'
const DAMAGE_UP = 'mark_shanghaizengjia'
const SPARK_MARK = 'mark_huohuayinji'
const FLAME_BODY = 'mark_huohuaquti'

const attackDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Physical || event.damageType === DamageType.Special),
)

const opponentBurned = targets.opponentActive.condition((_, pets) =>
  pets.some(pet => pet.marks.some(mark => mark.baseId === BURN && mark.isActive)),
)

const critDamage = contexts.damage.condition((_, events) => events.some(event => event.crit))

@effectGroup({ id: 'huohuali' })
export class HuohualiEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const burn = marks.get(BURN)
    const confusion = marks.get(CONFUSION)
    const damageUp = marks.get(DAMAGE_UP)
    const sparkMark = marks.get(SPARK_MARK)
    const flameBody = marks.get(FLAME_BODY)
    if (!burn || !confusion || !damageUp || !sparkMark || !flameBody) {
      throw new Error('Missing required marks for huohuali family')
    }

    const burnOpponent = targets.opponentActive.apply(ops.addMark(burn))
    const confuseOpponent = targets.opponentActive.apply(ops.addMark(confusion))

    return defineEffects({
      effect_ability_increase_crit_damage_10_percent: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, attackDamage, critDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 10, delta: 0 })),
      },
      effect_emblem_add_crit_rate_5_percent_for_huohuakeyin_and_chirekeyin: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_, events) =>
            events.some(event => ['skill_huohuakeyin', 'skill_chirekeyin'].includes(event.skill.baseId)),
          ),
        ),
        apply: contexts.skillUse.apply(ops.addCritRate(5)),
      },
      effect_skill_add_mark_opponent_shaoshang_on_crit: {
        triggers: [EffectTrigger.OnHit],
        when: ctx => conditions.selfUsesSkill(ctx) && ctx.parent.crit,
        apply: burnOpponent,
      },
      effect_skill_consume_opponent_shaoshang_deal_100_fixed_damage: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentBurned),
        apply: actions.sequence(
          targets.opponentActive
            .flatMap(pet => pet.marks)
            .where(mark => mark.baseId === BURN && mark.isActive)
            .apply(ops.removeMark()),
          targets.opponentActive.apply(ops.dealDamage(100, { damageType: DamageType.Effect })),
        ),
      },
      effect_skill_add_mark_opponent_hunmi_if_opponent_has_mark_shaoshang: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentBurned),
        apply: confuseOpponent,
      },
      effect_skill_add_mark_self_shanghaizengjia_90_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(damageUp, { stack: 90 })),
      },
      effect_skill_add_mark_opponent_huohuayinji_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.opponentActive.apply(ops.addMark(sparkMark)),
      },
      effect_skill_add_mark_self_huohuaquti_after_check: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(flameBody)),
      },
      effect_skill_power_2x_if_opponent_has_mark_shaoshang_before_check: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentBurned),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      },
      effect_skill_sure_hit_if_opponent_has_mark_shaoshang_before_check: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentBurned),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_mark_incoming_non_status_skill_sure_crit: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerIsSkillTarget,
          contexts.skillUse.condition((_, events) => events.some(event => event.skill.category !== 'Status')),
        ),
        apply: contexts.skillUse.apply(ops.setSureCrit()),
      },
      effect_mark_add_mark_attacker_shaoshang_30_percent_on_damage: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(conditions.ownerIsActive, conditions.selfBeDamaged, conditions.chance(30)),
        apply: targets.damageOriginPet.apply(ops.addMark(burn)),
      },
    })
  }
}
