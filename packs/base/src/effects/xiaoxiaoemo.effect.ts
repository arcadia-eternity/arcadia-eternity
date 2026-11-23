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

const CONTRACT = 'mark_emoqiyue'
const FEAR = 'mark_kongju'

const opponentHasContract = targets.opponentActive.condition((_, pets) =>
  pets.some(pet => pet.marks.some(mark => mark.baseId === CONTRACT && mark.isActive)),
)

const ownerHpBelowOpponent: Condition = ctx => {
  const owner = ctx.read(targets.ownerPet.first())
  const opponent = ctx.read(targets.opponentActive.first())
  return !!owner && !!opponent && owner.currentHp < opponent.currentHp
}

const ownerHpBelowFraction = (fraction: number) =>
  targets.ownerPet.condition((_, pets) => {
    const owner = pets[0]
    return owner ? owner.currentHp < owner.stat.maxHp * fraction : false
  })

const critDamage = contexts.damage.condition((_, events) => events.some(event => event.crit))

const opponentActive = targets.opponentActive
const ownerActive = targets.ownerPet

function contractConditional(action: Action) {
  return actions.choose(opponentHasContract, action)
}

function skillIs(skillId: string) {
  return contexts.skillUse.condition((_, uses) => uses.some(use => use.skill.baseId === skillId))
}

@effectGroup({ id: 'xiaoxiaoemo' })
export class XiaoxiaoemoEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const contract = marks.get(CONTRACT)
    const fear = marks.get(FEAR)
    if (!contract || !fear) throw new Error('Missing contract or fear mark')

    return defineEffects({
      effect_mark_emoqiyue_heal: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged, conditions.not(critDamage)),
        apply: ownerActive.apply(ops.heal(30)),
      },
      effect_xiaoxiaoemo_ability_contract_crit_heal: {
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, critDamage, opponentHasContract),
        apply: ownerActive.apply(ops.heal(60)),
      },
      effect_xiaoxiaoemo_emblem_last_ally_crit_reduction: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfBeDamaged,
          critDamage,
          targets.ownerPet.condition((_, pets) =>
            pets.some(pet => pet.owner?.team.every(ally => ally === pet || !ally.isAlive)),
          ),
        ),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -20, delta: 0 })),
      },
      effect_xiaoxiaoemo_skill_emozhiwen: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_emozhiwen')),
        apply: actions.sequence(
          opponentActive.apply(ops.changeStatStage('atk', -1)),
          contractConditional(opponentActive.apply(ops.changeStatStage('spa', -1))),
        ),
      },
      effect_xiaoxiaoemo_skill_emoqiyue: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_emoqiyue')),
        apply: opponentActive.apply(ops.addMark(contract)),
      },
      effect_xiaoxiaoemo_skill_diyuchongji_surehit: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_diyuchongji'), opponentHasContract),
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
      effect_xiaoxiaoemo_skill_xuweizhihun_miss_spa: {
        triggers: [EffectTrigger.OnMiss],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_xuweizhihun')),
        apply: ownerActive.apply(ops.changeStatStage('spa', 1)),
      },
      effect_xiaoxiaoemo_skill_diyuzhiyu_multihit: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_diyuzhiyu')),
        apply: actions.sequence(
          contexts.skillUse.apply(ops.setMultihit(2)),
          contractConditional(contexts.skillUse.apply(ops.setMultihit(4))),
        ),
      },
      effect_xiaoxiaoemo_skill_emozhiai: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_emozhiai')),
        apply: actions.sequence(
          opponentActive.apply(ops.changeStatStage('spa', -1)),
          opponentActive.apply(ops.addRage(10)),
        ),
      },
      effect_xiaoxiaoemo_skill_shouhuzhihun_heal: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_shouhuzhihun'), ownerHpBelowOpponent),
        apply: ownerActive.apply(ops.heal(60)),
      },
      effect_xiaoxiaoemo_skill_diyuaihao_fear: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          skillIs('skill_diyuaihao'),
          opponentHasContract,
          conditions.chance(20),
        ),
        apply: opponentActive.apply(ops.addMark(fear)),
      },
      effect_xiaoxiaoemo_skill_guduzhihun_crit: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_guduzhihun'), ownerHpBelowOpponent),
        apply: contexts.skillUse.apply(ops.addCritRate(30)),
      },
      effect_xiaoxiaoemo_skill_diyushenyuan_power: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_diyushenyuan'), opponentHasContract),
        apply: contexts.skillUse.apply(ops.addPower(30)),
      },
      effect_xiaoxiaoemo_skill_anyesuohunqu_fear: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_anyesuohunqu'), conditions.chance(20)),
        apply: opponentActive.apply(ops.addMark(fear)),
      },
      effect_xiaoxiaoemo_skill_chongshengzhihun_heal: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_chongshengzhihun'), ownerHpBelowFraction(0.125)),
        apply: ownerActive.apply(ops.heal(targets.ownerPet.select(pet => pet.stat.maxHp * 0.25).first())),
      },
      effect_xiaoxiaoemo_skill_juewangzhihun_cost: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_juewangzhihun')),
        apply: actions.sequence(
          ownerActive.apply(ops.dealDamage(targets.ownerPet.select(pet => pet.stat.maxHp * 0.25).first())),
          ownerActive.apply(ops.addRage(35)),
        ),
      },
      effect_xiaoxiaoemo_skill_taobizhihun_priority: {
        triggers: [EffectTrigger.BeforeSort],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_taobizhihun'), opponentHasContract),
        apply: contexts.skillUse.property('priority').apply(ops.add(1)),
      },
      effect_xiaoxiaoemo_skill_diyupaoxiao_damage: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, skillIs('skill_diyupaoxiao'), opponentHasContract),
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 50, delta: 0 })),
      },
    })
  }
}
