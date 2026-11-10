import { effectGroup } from '@arcadia-eternity/battle/effect-loading'
import { defineEffects, EffectTrigger, conditions, numberParam, ops, targets } from '@arcadia-eternity/battle/authoring'

@effectGroup({ id: 'execute-low-health' })
export class ExecuteLowHealthEffects {
  static build() {
    const threshold = numberParam({ default: 75 })
    return defineEffects({
      effect_skill_execute_opponent_hp_under_75_hit_or_miss: {
        triggers: [EffectTrigger.OnHit, EffectTrigger.OnMiss],
        priority: 100,
        parameters: { threshold },
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((ctx, pets) => pets.some(pet => pet.currentHp < ctx.read(threshold))),
        ),
        apply: targets.opponentActive.apply(ops.executeKill()),
      },
    })
  }
}
