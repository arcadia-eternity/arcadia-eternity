import { afterEach, beforeAll, expect, it } from 'vitest'
import { Operators } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  EffectContext,
  EffectTrigger,
  TurnContext,
  DamageContext,
  RageContext,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const { compileEffect, defineEffect, selectFrom, ops } = effectAuthoring
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
const variants = ['normal', 'empty', 'missing', 'duplicate', 'cancel', 'negative'] as const
function run(native: boolean, type: 'damage' | 'rage', variant: (typeof variants)[number]) {
  const { battle, a, b } = makeScenario(511)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) {
    for (const s of p.skills) s.effects.splice(0)
    p.currentHp = 100
  }
  a.currentRage = 20
  b.currentRage = 20
  let reads = 0
  const amount = variant === 'negative' ? -5 : 7
  const get = () => {
    reads++
    return amount
  }
  const source = a.activePet.skills[0]
  const ctx = new EffectContext<EffectTrigger>(new TurnContext(battle), EffectTrigger.TurnEnd, source)
  const trace: number[] = []
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/vital-hook' as effectId,
      triggers: [EffectTrigger.OnDamage, EffectTrigger.BeforeRageGain, EffectTrigger.BeforeRageLoss],
      when: c => c.parent.parent === ctx,
      apply(c) {
        const event = c.parent
        if (event instanceof DamageContext) {
          trace.push(event.damageResult)
          if (variant === 'cancel') event.available = false
        }
        if (event instanceof RageContext) {
          trace.push(event.value)
          if (variant === 'cancel') event.available = false
        }
      },
    }),
  )
  if (type === 'damage') {
    const selected =
      variant === 'empty' ? [] : variant === 'duplicate' ? [a.activePet, a.activePet] : [a.activePet, b.activePet]
    if (native) {
      const value = selectFrom(variant === 'missing' ? [] : [1])
        .select(get)
        .first()
      const e = compileEffect(
        defineEffect({
          id: 'fixture/damage',
          triggers: [EffectTrigger.TurnEnd],
          apply: selectFrom(selected).apply(ops.dealDamage(value)),
        }),
      )
      if (typeof e.apply !== 'function') throw new Error('Expected action')
      battle.executionBudget.run(battle.currentTurn, () => {
        if (typeof e.apply === 'function') e.apply(ctx)
      })
    } else Operators.dealDamage(() => (variant === 'missing' ? [] : [get()]))(ctx, selected)
  } else {
    const selected = variant === 'empty' ? [] : variant === 'duplicate' ? [a, a] : [a.activePet, b]
    if (native) {
      const value = selectFrom(variant === 'missing' ? [] : [1])
        .select(get)
        .first()
      const e = compileEffect(
        defineEffect({
          id: 'fixture/rage',
          triggers: [EffectTrigger.TurnEnd],
          apply: selectFrom(selected).apply(ops.addRage(value)),
        }),
      )
      if (typeof e.apply !== 'function') throw new Error('Expected action')
      battle.executionBudget.run(battle.currentTurn, () => {
        if (typeof e.apply === 'function') e.apply(ctx)
      })
    } else Operators.addRage(() => (variant === 'missing' ? [] : [get()]))(ctx, selected)
  }
  return {
    hp: [a.activePet.currentHp, b.activePet.currentHp],
    rage: [a.currentRage, b.currentRage],
    reads,
    trace,
    next: battle.random(),
  }
}
for (const type of ['damage', 'rage'] as const)
  for (const variant of variants)
    it(`${type} shared operator ${variant}`, () => {
      const actual = run(true, type, variant)
      expect(actual).toEqual(run(false, type, variant))
      expect(actual.reads).toBe(variant === 'missing' ? 0 : 1)
      if (variant === 'normal') {
        if (type === 'damage') expect(actual.hp).toEqual([93, 93])
        else expect(actual.rage).toEqual([27, 27])
      }
    })
for (const type of ['damage', 'rage'] as const)
  it(`${type} rejects a foreign target before any write`, () => {
    const own = makeScenario(1),
      foreign = makeScenario(2)
    battles.push(own.battle, foreign.battle)
    own.a.currentRage = 20
    own.a.activePet.currentHp = 100
    const action =
      type === 'damage'
        ? selectFrom([own.a.activePet, foreign.a.activePet]).apply(ops.dealDamage(5))
        : selectFrom([own.a, foreign.a]).apply(ops.addRage(5))
    const e = compileEffect(defineEffect({ id: 'fixture/foreign', triggers: [EffectTrigger.TurnEnd], apply: action }))
    const ctx = new EffectContext<EffectTrigger>(
      new TurnContext(own.battle),
      EffectTrigger.TurnEnd,
      own.a.activePet.skills[0],
    )
    expect(() =>
      own.battle.executionBudget.run(own.battle.currentTurn, () => {
        if (typeof e.apply === 'function') e.apply(ctx)
      }),
    ).toThrow('Cross-battle')
    expect(own.a.activePet.currentHp).toBe(100)
    expect(own.a.currentRage).toBe(20)
  })
