import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  BaseMark,
  RageContext,
  EffectContext,
  EffectTrigger,
  TurnContext,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { createRageGainLimit } from '@arcadia-eternity/data-pack-base/native'

const id = 'effect_mark_limit_rage_gain'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function fixture(stack = 3) {
  const f = makeScenario()
  battles.push(f.battle)
  for (const pet of [...f.a.team, ...f.b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const mark = new BaseMark('mark_xinlingzhiyue' as baseMarkId, [createRageGainLimit()], {
    ...f.debuff.config,
    maxStacks: 100,
    persistent: true,
    duration: -1,
  }).createInstance({ stack })
  mark.setOwner(f.a.activePet, f.battle.emitter)
  f.a.activePet.marks.push(mark)
  f.a.settingRage(10)
  f.b.settingRage(10)
  const turn = new TurnContext(f.battle)
  return { ...f, mark, turn }
}
for (const reason of ['turn', 'damage', 'skill', 'skillHit', 'switch', 'effect'] as const)
  for (const amount of [0, 2, 20])
    it(`caps ${reason} gain ${amount} at the current stack`, () => {
      const f = fixture()
      const event = new RageContext(f.turn, f.a, reason, 'add', amount)
      f.a.addRage(event)
      expect(event.rageChangeResult).toBe(Math.min(3, amount))
      expect(f.a.currentRage).toBe(10 + Math.min(3, amount))
    })
for (const priority of [-10, 10])
  it(`caps the final modified gain with modifier priority ${priority}`, () => {
    const f = fixture()
    f.a.activePet.skills[0].effects.push(
      defineNativeEffect({
        id: 'fixture/rage-modifier' as effectId,
        triggers: [EffectTrigger.BeforeRageGain],
        priority,
        apply: ctx => {
          if (ctx.parent instanceof RageContext) ctx.parent.addModified(100, 10)
        },
      }),
    )
    const event = new RageContext(f.turn, f.a, 'effect', 'add', 2)
    f.a.addRage(event)
    expect(event.modified).toEqual([100, 10])
    expect(event.rageChangeResult).toBe(3)
    expect(f.a.currentRage).toBe(13)
  })
it('reads late stack changes once and re-queries on the next gain', () => {
  const f = fixture()
  f.b.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/rage-stack' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id,
      apply: () => {
        f.mark.stack = 7
      },
    }),
  )
  const first = new RageContext(f.turn, f.a, 'effect', 'add', 20)
  f.a.addRage(first)
  expect(first.rageChangeResult).toBe(7)
  f.b.activePet.skills[0].effects.splice(0)
  f.mark.stack = 2
  f.a.addRage(new RageContext(f.turn, f.a, 'effect', 'add', 20))
  expect(first.rageChangeResult).toBe(7)
  expect(f.a.currentRage).toBe(19)
})
for (const type of ['reduce', 'setting'] as const)
  it(`does not cap ${type} operations`, () => {
    const f = fixture()
    f.a.addRage(new RageContext(f.turn, f.a, 'effect', type, 8))
    expect(f.a.currentRage).toBe(type === 'reduce' ? 2 : 8)
  })
it('does not cap another player', () => {
  const f = fixture()
  f.b.addRage(new RageContext(f.turn, f.b, 'effect', 'add', 20))
  expect(f.b.currentRage).toBe(30)
})
it('composes limits by minimum and floors the final amount', () => {
  const f = fixture(5)
  const event = new RageContext(f.turn, f.a, 'effect', 'add', 20, false, [50, 1])
  event.limitGain(2.5)
  f.a.addRage(event)
  expect(event.rageChangeResult).toBe(2)
  expect(f.a.currentRage).toBe(12)
})
it('zero gain limit, cancellation and invalid limits', () => {
  const f = fixture()
  const event = new RageContext(f.turn, f.a, 'effect', 'add', 20)
  event.limitGain(0)
  f.a.addRage(event)
  expect(f.a.currentRage).toBe(10)
  for (const invalid of [-1, NaN, Infinity]) expect(() => event.limitGain(invalid)).toThrow()
  const cancelled = new RageContext(f.turn, f.a, 'effect', 'add', 20)
  cancelled.available = false
  f.a.addRage(cancelled)
  expect(cancelled.rageChangeResult).toBe(0)
  expect(f.a.currentRage).toBe(10)
})
