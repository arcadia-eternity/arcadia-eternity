import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser, Operators } from '@arcadia-eternity/battle/v4/legacy'
import {
  BattleMessageType,
  EffectContext,
  EffectTrigger,
  TurnContext,
  setGlobalLogger,
  type Battle,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
function fixture() {
  const f = makeScenario(2026)
  battles.push(f.battle)
  for (const p of [...f.a.team, ...f.b.team]) for (const s of p.skills) s.effects.splice(0)
  const ctx = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, f.a.activePet.skills[0])
  return { ...f, ctx }
}
for (const target of ['pet', 'player'] as const)
  for (const amount of [-10, 0, 25, 10000, 12.5])
    it(`historical setting phase ${target}/${amount}`, () => {
      const f = fixture()
      f.a.settingRage(40)
      const changes: { before: number; after: number; reason: string }[] = []
      f.battle.registerListener(m => {
        if (m.type === BattleMessageType.RageChange) changes.push(m.data)
      })
      Operators.setRage(amount)(f.ctx, [target === 'pet' ? f.a.activePet : f.a])
      expect(f.a.currentRage).toBe(Math.max(0, Math.min(amount, f.a.maxRage)))
      expect(changes).toEqual([expect.objectContaining({ before: 40, after: f.a.currentRage, reason: 'effect' })])
    })
it('reads the first value once and preserves duplicate-target phase messages', () => {
  const f = fixture()
  let reads = 0
  const changes: unknown[] = []
  f.battle.registerListener(m => {
    if (m.type === BattleMessageType.RageChange) changes.push(m.data)
  })
  Operators.setRage(() => {
    reads++
    return [17, 90]
  })(f.ctx, [f.a.activePet, f.a, f.b])
  expect(reads).toBe(1)
  expect([f.a.currentRage, f.b.currentRage]).toEqual([17, 17])
  expect(changes).toHaveLength(3)
  Operators.setRage(() => [])(f.ctx, [f.a])
  expect(changes).toHaveLength(3)
})
it('restores the exact historical operation body', () => {
  const s = readFileSync(new URL('../../src/v4/legacy/effectBuilder/src/operator.ts', import.meta.url), 'utf8')
  const body = s.slice(s.indexOf('  setRage:'), s.indexOf('  modifyStat:')).replace(/\s+/g, '')
  expect(createHash('sha256').update(body).digest('hex')).toBe(
    '6e4ae0559c2780932fa943601fc41a3a2efe0a4cac78d828dbdc490ff2725dde',
  )
})
for (const kind of ['ability', 'mark', 'skill']) {
  const definitions = parse(
    readFileSync(new URL(`../../../../packs/base/data/effect_${kind}.yaml`, import.meta.url), 'utf8'),
    { merge: true },
  )
  for (const d of definitions.filter((d: { apply?: { type?: string } }) => d.apply?.type === 'setRage'))
    it(`parses unchanged ${d.id}`, () => expect(EffectParser.parse(d).id).toBe(d.id))
}
it('parses and executes assignment through the restored schema and parser', () => {
  const f = fixture()
  f.a.settingRage(40)
  const effect = EffectParser.parse({
    id: 'fixture/set-rage',
    trigger: 'TurnStart',
    priority: 0,
    apply: { type: 'setRage', target: 'self', value: 25 },
  })
  f.a.activePet.skills[0].effects.push(effect)
  f.battle.applyEffects(new TurnContext(f.battle), EffectTrigger.TurnStart, f.a.activePet.skills[0])
  expect(f.a.currentRage).toBe(25)
})
