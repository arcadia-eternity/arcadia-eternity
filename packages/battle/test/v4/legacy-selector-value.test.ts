import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import { EffectContext, EffectTrigger, TurnContext, setGlobalLogger, type Battle } from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
for (const tag of ['selectorValue', 'selector'])
  for (const nested of [false, true])
    it(`accepts ${tag} in ${nested ? 'dynamic selector' : 'value'} position`, () => {
      const f = makeScenario()
      battles.push(f.battle)
      const selector = { type: tag, value: [2, 5], chain: [{ type: 'avg' }] }
      const effect = EffectParser.parse({
        id: `fixture/${tag}/${nested}`,
        trigger: 'TurnStart',
        priority: 0,
        apply: { type: 'setRage', target: 'self', value: nested ? { type: 'dynamic', selector } : selector },
      })
      f.battle.executionBudget.run(0, () =>
        effect.innerApply(
          new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, f.a.activePet.skills[0], effect),
        ),
      )
      expect(f.a.currentRage).toBe(3.5)
    })
it('nested historical values query the current source at action time', () => {
  const f = makeScenario()
  battles.push(f.battle)
  const effect = EffectParser.parse({
    id: 'fixture/nested-selector-value',
    trigger: 'TurnStart',
    priority: 0,
    apply: {
      type: 'setRage',
      target: 'opponent',
      value: {
        type: 'selectorValue',
        value: {
          type: 'dynamic',
          selector: { base: 'selfPlayer', chain: [{ type: 'select', arg: { type: 'base', arg: 'rage' } }] },
        },
        chain: [{ type: 'add', arg: 2 }],
      },
    },
  })
  const ctx = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, f.a.activePet.skills[0], effect)
  f.a.settingRage(31)
  f.battle.executionBudget.run(0, () => effect.innerApply(ctx))
  expect(f.b.currentRage).toBe(33)
  f.a.settingRage(47)
  f.battle.executionBudget.run(0, () => effect.innerApply(ctx))
  expect(f.b.currentRage).toBe(49)
})
for (const tag of ['selectorValues', 'selectValue'])
  it(`rejects unknown tag ${tag}`, () => {
    expect(() =>
      EffectParser.parse({
        id: 'fixture/invalid-tag',
        trigger: 'TurnStart',
        priority: 0,
        apply: { type: 'setRage', target: 'self', value: { type: tag, value: 20 } },
      }),
    ).toThrow()
  })
