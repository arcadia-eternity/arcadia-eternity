import {
  DamageType,
  actions,
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  ops,
  values,
  targets,
  type Action,
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

    const critBurn: Action = actions.sequence(targets.opponentActive.apply(ops.addMark(burn)))

    return defineEffects({
      effect_huohuali_ability_crit_damage: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, attackDamage, critDamage),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 10, delta: 0 })),
      },
      effect_huohuali_emblem_mark_crit: {
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
      effect_huohuali_skill_huohuakeyin: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, critDamage),
        apply: critBurn,
      },
      effect_huohuali_skill_chirekeyin: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, critDamage),
        apply: critBurn,
      },
      effect_huohuali_skill_huohuayinbao: {
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
      effect_huohuali_skill_xuanmuhuoguang: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentBurned),
        apply: confuseOpponent,
      },
      effect_huohuali_skill_huohuanengliang: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(damageUp, { stack: 90 })),
      },
      effect_huohuali_skill_huohuayinji: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.opponentActive.apply(ops.addMark(sparkMark)),
      },
      effect_huohuali_skill_huohuaquti: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(flameBody)),
      },
      effect_huohuali_skill_huolongjianglin: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.chance(15)),
        apply: burnOpponent,
      },
      effect_huohuali_skill_chirelieyan: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentBurned),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      },
      effect_huohuali_skill_chireyandan: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(ops.setMultihit(values.randomInt(2, 3))),
      },
      effect_huohuali_skill_chiretuji: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentBurned),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_huohuali_mark_spark_crit: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.ownerIsSkillTarget),
        apply: contexts.skillUse.apply(ops.setSureCrit()),
      },
      effect_huohuali_mark_flame_body_burn: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(conditions.ownerIsActive, conditions.selfBeDamaged, conditions.chance(30)),
        apply: targets.damageOriginPet.apply(ops.addMark(burn)),
      },
    })
  }
}
