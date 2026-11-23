import {
  actions,
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
  values,
  type Action,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup } from '@arcadia-eternity/battle/effect-loading'

function afterCheck(apply: Action<EffectTrigger.AfterUseSkillCheck>) {
  return { triggers: [EffectTrigger.AfterUseSkillCheck] as const, when: conditions.selfUsesSkill, apply }
}

function onHit(apply: Action<EffectTrigger.OnHit>) {
  return { triggers: [EffectTrigger.OnHit] as const, when: conditions.selfUsesSkill, apply }
}

function onHitDrop(stat: 'atk' | 'spe', percent: number) {
  return {
    triggers: [EffectTrigger.OnHit] as const,
    when: conditions.all(conditions.selfUsesSkill, conditions.chance(percent)),
    apply: targets.opponentActive.apply(ops.changeStatStage(stat, -1)),
  }
}

// Some skills roll when their queued effect executes. Moving that roll into `when` changes battle RNG order.
function rollOnApplySpeedDrop(percent: number) {
  return onHit(actions.choose(conditions.chance(percent), targets.opponentActive.apply(ops.changeStatStage('spe', -1))))
}

@effectGroup({ id: 'shared-skill-outcomes' })
export class SharedSkillOutcomes {
  static build() {
    return defineEffects({
      effect_skill_lower_atk_5_percent_on_hit: onHitDrop('atk', 5),
      effect_skill_lower_spe_20_percent_on_hit_on_apply: rollOnApplySpeedDrop(20),
      effect_skill_lower_spe_5_percent_on_hit: onHitDrop('spe', 5),
      effect_skill_multihit_2_to_3_after_check: afterCheck(
        contexts.skillUse.apply(ops.setMultihit(values.randomInt(2, 3))),
      ),
      effect_skill_multihit_3_to_4_after_check: afterCheck(
        contexts.skillUse.apply(ops.setMultihit(values.randomInt(3, 4))),
      ),
      effect_skill_raise_atk_after_check: afterCheck(targets.ownerPet.apply(ops.changeStatStage('atk', 1))),
      effect_skill_raise_atk_spa_after_check: afterCheck(
        actions.sequence(
          targets.ownerPet.apply(ops.changeStatStage('atk', 1)),
          targets.ownerPet.apply(ops.changeStatStage('spa', 1)),
        ),
      ),
      effect_skill_raise_def_after_check: afterCheck(targets.ownerPet.apply(ops.changeStatStage('def', 1))),
      effect_skill_raise_def_spd_after_check: afterCheck(
        actions.sequence(
          targets.ownerPet.apply(ops.changeStatStage('def', 1)),
          targets.ownerPet.apply(ops.changeStatStage('spd', 1)),
        ),
      ),
      effect_skill_raise_spa_after_check: afterCheck(targets.ownerPet.apply(ops.changeStatStage('spa', 1))),
      effect_skill_raise_spd_after_check: afterCheck(targets.ownerPet.apply(ops.changeStatStage('spd', 1))),
      effect_skill_raise_spe_after_check: afterCheck(targets.ownerPet.apply(ops.changeStatStage('spe', 1))),
      effect_skill_sure_hit_before_check: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(ops.setSureHit()),
      },
    })
  }
}
