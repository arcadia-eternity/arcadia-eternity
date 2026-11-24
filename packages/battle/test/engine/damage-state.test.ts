import { afterEach, expect, it } from 'vitest'
import {
  BattleMessageType,
  Category,
  DamageContext,
  DamageType,
  EffectContext,
  EffectTrigger,
  SkillPhase,
  TurnContext,
  UseSkillContext,
  defineNativeEffect,
  effectAuthoring,
  type Battle,
  type effectId,
} from '@arcadia-eternity/battle/engine'
import { ExecuteLowHealthEffects } from '../../../../packs/base/src/effects/execute-low-health.effect'
import { makeScenario } from './scenario'

const battles: Battle[] = []
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})

function fixture() {
  const { battle, a, b } = makeScenario(872)
  battles.push(battle)
  const actor = a.activePet,
    target = b.activePet,
    skill = actor.skills[0]
  skill.effects.splice(0)
  const turn = new TurnContext(battle)
  const defeated: string[] = []
  battle.registerListener(message => {
    if (message.type === BattleMessageType.PetDefeated) defeated.push(message.data.pet)
  })
  return { battle, a, actor, target, skill, turn, defeated }
}

it('commits a non-skill knockout exactly once and attributes it without an enclosing skill action', () => {
  const f = fixture()
  const cause = new EffectContext(f.turn, EffectTrigger.TurnEnd, f.skill)
  const damage = () => f.target.damage(new DamageContext(cause, f.actor, f.target, 9999, DamageType.Effect))
  const reported: unknown[] = []
  f.skill.effects.push(
    defineNativeEffect({
      id: 'fixture/faint-observer' as effectId,
      triggers: [EffectTrigger.OnDefeat],
      apply: ctx => reported.push([ctx.parent.target.id, ctx.parent.killer?.id, ctx.parent.target.isAlive]),
    }),
  )
  damage()
  damage()
  expect(f.defeated).toEqual([f.target.id])
  expect(reported).toEqual([[f.target.id, f.actor.id, false]])
  expect(f.battle.lastKiller).toBe(f.a)
})

it('allows a zero-HP response before confirming a defeat and uses HP loss for rage after overkill', () => {
  const f = fixture()
  const cause = new EffectContext(f.turn, EffectTrigger.TurnEnd, f.skill)
  f.target.currentHp = Math.floor(f.target.stat.maxHp / 2)
  f.target.owner!.currentRage = 0
  const hpBefore = f.target.currentHp
  const checkpoint: unknown[] = []
  f.skill.effects.push(
    defineNativeEffect({
      id: 'fixture/dying-response' as effectId,
      triggers: [EffectTrigger.PostDamage],
      apply: ctx => {
        checkpoint.push([ctx.parent.target.currentHp, ctx.parent.target.isAlive, ctx.parent.result?.hpLoss])
        ctx.parent.target.currentHp = 8
      },
    }),
  )
  f.target.damage(new DamageContext(cause, f.skill, f.target, 9999, DamageType.Special))
  expect(checkpoint).toEqual([[0, true, hpBefore]])
  expect(f.target.currentHp).toBe(8)
  expect(f.target.isAlive).toBe(true)
  expect(f.defeated).toEqual([])
  expect(f.target.owner!.currentRage).toBe(Math.floor((hpBefore * 49) / f.target.stat.maxHp))
})

it('stops a multi-hit skill after its confirmed knockout and credits the skill instance', () => {
  const f = fixture()
  const use = new UseSkillContext(f.turn, f.a, f.actor, f.skill.target, f.skill)
  use.category = Category.Physical
  use.power = 300
  use.multihit = 4
  f.target.currentHp = 1
  const credits: string[] = []
  f.skill.effects.push(
    defineNativeEffect({
      id: 'fixture/skill-ko' as effectId,
      triggers: [EffectTrigger.OnDefeat],
      apply: ctx => {
        if (ctx.parent.skill) credits.push(ctx.parent.skill.id)
      },
    }),
  )
  const phase = new SkillPhase(use)
  expect(f.battle.phaseManager.run(phase).success).toBe(true)
  expect(f.defeated).toEqual([f.target.id])
  expect(f.turn.appledContexts[0]).toBe(use)
  expect(use.defeated).toBe(true)
  expect(use.currentHitCount).toBe(2)
  expect(credits).toEqual([f.skill.id])
})

it('credits the official on-hit execution once even though the status move dealt no damage', () => {
  const f = fixture()
  const use = new UseSkillContext(f.turn, f.a, f.actor, f.skill.target, f.skill)
  f.target.currentHp = 10
  const execute = ExecuteLowHealthEffects.build().effect_skill_execute_opponent_hp_under_75_hit_or_miss
  effectAuthoring.effectParameters(execute).install(f.battle.configSystem)
  f.skill.effects.push(execute)
  const phase = new SkillPhase(use)
  expect(f.battle.phaseManager.run(phase).success).toBe(true)
  expect(f.defeated).toEqual([f.target.id])
  expect(use.defeated).toBe(true)
  expect(f.battle.lastKiller).toBe(f.a)
})

it('attributes a nested lethal hit to its own source after the first hit was survived', () => {
  const f = fixture()
  const childActor = f.a.team[1]
  const cause = new EffectContext(f.turn, EffectTrigger.TurnEnd, f.skill)
  const credits: unknown[] = []
  f.skill.effects.push(
    defineNativeEffect({
      id: 'fixture/revive-then-hit' as effectId,
      triggers: [EffectTrigger.PostDamage, EffectTrigger.OnDefeat],
      apply: ctx => {
        if (ctx.trigger === EffectTrigger.OnDefeat) {
          credits.push(ctx.parent.killer?.id)
        } else {
          f.target.currentHp = 1
          f.target.damage(new DamageContext(ctx, childActor, f.target, 1, DamageType.Effect))
        }
      },
    }),
  )
  f.target.damage(new DamageContext(cause, f.skill, f.target, 9999, DamageType.Special))
  expect(credits).toEqual([childActor.id])
  expect(f.defeated).toEqual([f.target.id])
})

it.each([false, true])('a bench knockout preserves the existing active-pet switch reward (prior KO %s)', priorKo => {
  const { battle, a, actor, target, skill, turn, defeated } = fixture()
  const cause = new EffectContext(turn, EffectTrigger.TurnEnd, skill)
  if (priorKo) target.damage(new DamageContext(cause, actor, target, 9999, DamageType.Effect))
  const bench = a.team[1]
  const counterSource = target.owner!.team[1]
  bench.damage(new DamageContext(cause, counterSource, bench, 9999, DamageType.Effect))
  expect(defeated).toEqual(priorKo ? [target.id, bench.id] : [bench.id])
  expect(battle.lastKiller).toBe(priorKo ? a : undefined)
  expect(battle.faintSwitchPlayer).toBe(priorKo ? a : undefined)
})

it('does not award hit rage when a knockout before the first hit ends the attack', () => {
  const f = fixture()
  const use = new UseSkillContext(f.turn, f.a, f.actor, f.skill.target, f.skill)
  use.category = Category.Physical
  f.target.currentHp = 1
  f.skill.effects.push(
    defineNativeEffect({
      id: 'fixture/before-multihit-hit' as effectId,
      triggers: [EffectTrigger.BeforeMultiHit],
      apply: ctx => {
        f.target.damage(new DamageContext(ctx, f.skill, f.target, 1))
      },
    }),
  )
  const reasons: string[] = []
  f.battle.registerListener(event => {
    if (event.type === BattleMessageType.RageChange) reasons.push(event.data.reason)
  })
  const phase = new SkillPhase(use)
  expect(f.battle.phaseManager.run(phase).success).toBe(true)
  expect(f.defeated).toEqual([f.target.id])
  expect(reasons).toEqual(['skill'])
})
