// Trusted, deliberately small test adaptation for #201; not the official migrated catalog.
import { EffectRegistry, EffectTrigger, Mark, defineEffect } from '@arcadia-eternity/battle/core'
export const ref = (id: string) => ({ id, version: 'test-201-v1', params: {} })
export const registry = new EffectRegistry([
  defineEffect({
    id: 'effect_skill_add_mark_hunzhuoshuiyu',
    version: 'test-201-v1',
    triggers: [EffectTrigger.OnHit],
    execute(effect) {
      const ctx = effect.parent
      if (effect.source === ctx.skill) ctx.battle.addMark(ctx.pet, 'mark_hunzhuoshuiyu')
    },
  }),
  defineEffect({
    id: 'effect_skill_raise_atk_1_stage',
    version: 'test-201-v1',
    triggers: [EffectTrigger.BeforeHit],
    execute(effect) {
      const ctx = effect.parent
      if (effect.source === ctx.skill) ctx.battle.addStatStage(ctx.pet, 'atk', 1)
    },
  }),
  ...(['def', 'spd'] as const).map(stat =>
    defineEffect({
      id: `effect_skill_reduce_opponent_${stat}_1_stage_5_percent`,
      version: 'test-201-v1',
      triggers: [EffectTrigger.BeforeHit],
      execute(effect) {
        const ctx = effect.parent
        if (effect.source === ctx.skill && ctx.battle.random() < 0.05) ctx.battle.addStatStage(ctx.target, stat, -1)
      },
    }),
  ),
  defineEffect({
    id: 'effect_mark_double_stage_debuff',
    version: 'test-201-v1',
    triggers: [EffectTrigger.OnBeforeAddMark],
    execute(effect) {
      const ctx = effect.parent,
        source = effect.source
      if (source instanceof Mark && source.owner === ctx.target && ctx.statStage && ctx.statStage.level < 0)
        ctx.statStage.level *= 2
    },
  }),
])
