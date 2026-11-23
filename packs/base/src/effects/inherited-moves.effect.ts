import { effectGroup } from '@arcadia-eternity/battle/effect-loading'
import {
  checks,
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
} from '@arcadia-eternity/battle/authoring'

@effectGroup({ id: 'inherited-moves' })
export class InheritedMoveEffects {
  static build() {
    const whenTargetHas = (id: string) =>
      conditions.all(
        conditions.selfUsesSkill,
        targets.opponentMarks.where(mark => mark.baseId === id).condition(checks.exists()),
      )
    const whenMovingFirst = conditions.all(conditions.selfUsesSkill, conditions.firstSkillThisTurn)
    return defineEffects({
      effect_skill_duzhenlianshe: {
        triggers: [EffectTrigger.BeforeMultiHit],
        priority: 0,
        when: whenTargetHas('mark_zhongdu'),
        apply: contexts.skillUse.apply(ops.addMultihitResult(2)),
      },
      effect_skill_jinzhensheji: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: whenTargetHas('mark_mabi'),
        apply: contexts.skillUse.apply(ops.addPower(50)),
      },
      effect_skill_zhenchituji: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: whenMovingFirst,
        apply: contexts.skillUse.apply(ops.addPower(50)),
      },
      effect_skill_mizhenlianshe: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: whenMovingFirst,
        apply: contexts.skillUse.apply(ops.addCritRate(95)),
      },
      effect_skill_guaiyichongji: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: whenTargetHas('mark_shiquxiujue'),
        apply: targets.opponentActive.apply(ops.changeStatStage('def', -1)),
      },
      effect_skill_kusechouda: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: whenTargetHas('mark_shiquweijue'),
        apply: targets.opponentActive.apply(ops.changeStatStage('spd', -1)),
      },
    })
  }
}
