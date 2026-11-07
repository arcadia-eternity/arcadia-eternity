import {
  AttackTargetOpinion,
  effectAuthoring,
  EffectTrigger,
  setGlobalLogger,
  TurnContext,
  UseSkillContext,
  type Battle,
} from '@arcadia-eternity/battle/v4'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { makeScenario } from './scenario'
const { compileEffect, defineEffect, ops, selectFrom } = effectAuthoring
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
const operations = [
  'addCritRate',
  'addAccuracy',
  'setAccuracy',
  'setSureHit',
  'setSureMiss',
  'setSureCrit',
  'setSureNoCrit',
] as const
it.each(['addCritRate', 'addAccuracy', 'setAccuracy'] as const)(
  'pins %s query counts across two contexts',
  operation => {
    const { battle, a } = makeScenario()
    battles.push(battle)
    const skill = a.activePet.skills[0],
      turn = new TurnContext(battle)
    const events = [0, 1].map(() => new UseSkillContext(turn, a, a.activePet, AttackTargetOpinion.opponent, skill))
    events.forEach(event => {
      event.accuracy = 50
      event.critRate = 40
    })
    let reads = 0
    const values = selectFrom([0])
      .select(() => {
        reads++
        return [80, -30]
      })
      .first()
    const effect = compileEffect(
      defineEffect({
        id: 'fixture/count',
        triggers: [EffectTrigger.TurnStart],
        apply: selectFrom(events).apply(ops[operation](values)),
      }),
    )
    skill.effects.splice(0, skill.effects.length, effect)
    battle.applyEffects(turn, EffectTrigger.TurnStart, skill)
    expect(reads).toBe(operation === 'addCritRate' ? 2 : 1)
    expect(events.map(e => (operation === 'addCritRate' ? e.critRate : e.accuracy))).toEqual(
      operation === 'addCritRate' ? [70, 70] : operation === 'addAccuracy' ? [100, 100] : [80, 80],
    )
  },
)
it.each(['setSureHit', 'setSureMiss', 'setSureCrit', 'setSureNoCrit'] as const)(
  '%s rejects nonfinite priorities',
  operation => {
    for (const priority of [NaN, Infinity, -Infinity])
      expect(() => ops[operation](priority)).toThrow(/finite override priority/)
  },
)
it.each(operations)('%s rejects foreign contexts without changing them', operation => {
  const f = makeScenario(),
    other = makeScenario()
  battles.push(f.battle, other.battle)
  const skill = f.a.activePet.skills[0]
  const foreign = new UseSkillContext(
    new TurnContext(other.battle),
    other.a,
    other.a.activePet,
    AttackTargetOpinion.opponent,
    other.a.activePet.skills[0],
  )
  foreign.accuracy = 50
  foreign.critRate = 40
  const apply = ops[operation](10)
  let checked = false
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/foreign-outcome',
      triggers: [EffectTrigger.TurnStart],
      apply(ctx) {
        expect(() => apply(ctx, [foreign])).toThrow(/Cross-battle skill context/)
        checked = true
      },
    }),
  )
  skill.effects.splice(0, skill.effects.length, effect)
  f.battle.applyEffects(new TurnContext(f.battle), EffectTrigger.TurnStart, skill)
  expect(checked).toBe(true)
  expect([foreign.accuracy, foreign.critRate, foreign.hitOverrides, foreign.critOverrides]).toEqual([50, 40, [], []])
})
it.each(['addCritRate', 'addAccuracy', 'setAccuracy'] as const)('%s keeps empty-target read timing', operation => {
  const f = makeScenario()
  battles.push(f.battle)
  const skill = f.a.activePet.skills[0]
  let reads = 0
  const query = selectFrom([1])
    .select(() => {
      reads++
      return 5
    })
    .first()
  const apply = ops[operation](query)
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/empty-outcome',
      triggers: [EffectTrigger.TurnStart],
      apply(ctx) {
        apply(ctx, [])
      },
    }),
  )
  skill.effects.splice(0, skill.effects.length, effect)
  f.battle.applyEffects(new TurnContext(f.battle), EffectTrigger.TurnStart, skill)
  expect(reads).toBe(operation === 'addCritRate' ? 0 : 1)
})
