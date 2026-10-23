import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  BattleMessageType,
  EffectTrigger,
  RageContext,
  TurnContext,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { createGeneratedRageAssignment } from '@arcadia-eternity/data-pack-base/native'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
function fixture() {
  const f = makeScenario(241)
  battles.push(f.battle)
  for (const p of [...f.a.team, ...f.b.team]) {
    p.marks.splice(0)
    for (const s of p.skills) s.effects.splice(0)
  }
  f.a.settingRage(40)
  return f
}
for (const kind of ['add', 'reduce'] as const)
  for (const cancel of [false, true])
    it(`${kind} dispatches modification before settlement, observation afterward; cancel=${cancel}`, () => {
      const { battle, a } = fixture()
      const before = kind === 'add' ? EffectTrigger.BeforeRageGain : EffectTrigger.BeforeRageLoss
      const after = kind === 'add' ? EffectTrigger.OnRageGain : EffectTrigger.OnRageLoss
      const trace: unknown[] = []
      a.activePet.skills[0].effects.push(
        defineNativeEffect({
          id: 'fixture/rage-lifecycle' as effectId,
          triggers: [before, after],
          apply(ctx) {
            trace.push([ctx.trigger, a.currentRage, ctx.parent.rageChangeResult])
            if (ctx.trigger === before) {
              ctx.parent.modified[0] += 50
              if (cancel) ctx.parent.available = false
            } else ctx.parent.modified[0] += 100
          },
        }),
      )
      battle.registerListener(m => {
        if (m.type === BattleMessageType.RageChange) trace.push(['message', m.data.before, m.data.after])
      })
      const rage = new RageContext(new TurnContext(battle), a, 'effect', kind, 10)
      a.addRage(rage)
      const final = kind === 'add' ? 55 : 25
      expect(trace).toEqual(
        cancel
          ? [[before, 40, 0]]
          : [
              [before, 40, 0],
              [after, final, 15],
              ['message', 40, final],
            ],
      )
      expect(rage.rageChangeResult).toBe(cancel ? 0 : 15)
      expect(a.currentRage).toBe(cancel ? 40 : final)
    })
it('before hooks can re-enable a context initially marked unavailable, as in later V1', () => {
  const { battle, a } = fixture()
  a.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/reenable-rage' as effectId,
      triggers: [EffectTrigger.BeforeRageGain],
      apply(ctx) {
        ctx.parent.available = true
      },
    }),
  )
  const rage = new RageContext(new TurnContext(battle), a, 'effect', 'add', 10)
  rage.available = false
  a.addRage(rage)
  expect(a.currentRage).toBe(50)
})
it('setting bypasses gain/loss hooks and retains its message even for unavailable contexts', () => {
  const { battle, a } = fixture()
  let calls = 0
  a.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/setting-hooks' as effectId,
      triggers: [
        EffectTrigger.BeforeRageGain,
        EffectTrigger.BeforeRageLoss,
        EffectTrigger.OnRageGain,
        EffectTrigger.OnRageLoss,
      ],
      apply() {
        calls++
      },
    }),
  )
  const changes: unknown[] = []
  battle.registerListener(m => {
    if (m.type === BattleMessageType.RageChange) changes.push([m.data.before, m.data.after])
  })
  const rage = new RageContext(new TurnContext(battle), a, 'effect', 'setting', 17)
  rage.available = false
  a.addRage(rage)
  expect(a.currentRage).toBe(17)
  expect(calls).toBe(0)
  expect(changes).toEqual([[40, 17]])
})
it('minimum rage observes the settled loss and emits the nested assignment before the outer loss message', () => {
  const { battle, a } = fixture()
  a.activePet.skills[0].effects.push(createGeneratedRageAssignment().effect_ability_keep_rage_at_least_25)
  const changes: unknown[] = []
  battle.registerListener(m => {
    if (m.type === BattleMessageType.RageChange) changes.push([m.data.before, m.data.after])
  })
  a.addRage(new RageContext(new TurnContext(battle), a, 'effect', 'reduce', 30))
  expect(a.currentRage).toBe(25)
  expect(changes).toEqual([
    [10, 25],
    [40, 25],
  ])
})
it('pins the exact later V1 rage operation body', () => {
  const text = readFileSync(new URL('../../src/v4/phase/rage.ts', import.meta.url), 'utf8')
  const body = text.slice(text.indexOf('export function executeRageOperation')).replace(/\s+/g, '')
  expect(createHash('sha256').update(body).digest('hex')).toBe(
    '19e34f156a55ff037269643709644ab076b591637ec57ed32f0b5b8da77639e3',
  )
})
