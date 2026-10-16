// Trusted, deliberately small test adaptation for #201; not the official migrated catalog.
import { EffectRegistry, EffectTrigger, Skill, Mark, type StageStat } from '@arcadia-eternity/battle/core'
export const ref = (id: string) => ({ id, version: 'test-201-v1', params: {} })
export const registry = new EffectRegistry([
  {
    id: 'effect_skill_add_mark_hunzhuoshuiyu',
    version: 'test-201-v1',
    triggers: [EffectTrigger.OnHit],
    execute(ctx, source) {
      if (ctx.kind === 'skill' && source === ctx.skill) ctx.battle.addMark(ctx.pet, 'mark_hunzhuoshuiyu')
    },
  },
  {
    id: 'effect_skill_raise_atk_1_stage',
    version: 'test-201-v1',
    triggers: [EffectTrigger.BeforeHit],
    execute(ctx, source) {
      if (ctx.kind === 'skill' && source === ctx.skill) ctx.battle.addStatStage(ctx.pet, 'atk', 1)
    },
  },
  ...(['def', 'spd'] as StageStat[]).map(stat => ({
    id: `effect_skill_reduce_opponent_${stat}_1_stage_5_percent`,
    version: 'test-201-v1',
    triggers: [EffectTrigger.BeforeHit],
    execute(
      ctx: Parameters<import('@arcadia-eternity/battle/core').TrustedEffect['execute']>[0],
      source: Skill | Mark,
    ) {
      if (ctx.kind === 'skill' && source === ctx.skill && ctx.battle.random() < 0.05)
        ctx.battle.addStatStage(ctx.target, stat, -1)
    },
  })),
  {
    id: 'effect_mark_double_stage_debuff',
    version: 'test-201-v1',
    triggers: [EffectTrigger.OnBeforeAddMark],
    execute(ctx, source) {
      if (ctx.kind === 'stage' && source instanceof Mark && source.owner === ctx.pet && ctx.amount < 0) ctx.amount *= 2
    },
  },
])
