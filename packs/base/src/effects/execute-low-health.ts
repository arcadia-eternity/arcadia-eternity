import {
  compileEffect,
  conditions,
  defineEffect,
  numberParam,
  ops,
  targets,
} from '@arcadia-eternity/battle/v4/authoring'

export function createLowHealthExecution() {
  const threshold = numberParam({ default: 75 })
  return Object.freeze({
    effect_skill_execute_opponent_hp_under_75_hit_or_miss: compileEffect(
      defineEffect({
        id: 'effect_skill_execute_opponent_hp_under_75_hit_or_miss',
        on: ['OnHit', 'OnMiss'],
        priority: 100,
        parameters: { threshold },
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((ctx, pets) => pets.some(pet => pet.currentHp < ctx.read(threshold))),
        ),
        execute: targets.opponentActive.apply(ops.executeKill()),
      }),
    ),
  })
}
