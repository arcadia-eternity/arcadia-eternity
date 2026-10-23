import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { EffectParser, Operators, type Action } from '@arcadia-eternity/battle/v4/legacy'
import {
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  setGlobalLogger,
  type Battle,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  vi.restoreAllMocks()
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function fixture() {
  const f = makeScenario(241)
  battles.push(f.battle)
  const skill = f.a.activePet.skills[0]
  const use = new UseSkillContext(new TurnContext(f.battle), f.a, f.a.activePet, AttackTargetOpinion.opponent, skill)
  return { ...f, ctx: new EffectContext(use, EffectTrigger.BeforeHit, skill) }
}
const rage = (value: number) => ({ type: 'setRage', target: 'self', value })
for (const grouped of [false, true])
  for (const reverse of [false, true]) {
    it(`historical selection execution timing grouped=${grouped} reverse=${reverse}`, () => {
      const f = fixture()
      f.a.currentRage = 0
      const atSelection: number[] = []
      vi.spyOn(f.battle, 'shuffle').mockImplementation(items => {
        atSelection.push(f.a.currentRage)
        return reverse ? [...items].reverse() : [...items]
      })
      const effect = EffectParser.parse({
        id: 'fixture/action-selection',
        trigger: 'BeforeHit',
        priority: 0,
        apply: {
          type: 'executeActions',
          target: {
            type: 'selectorValue',
            value: grouped
              ? [
                  [rage(10), rage(20)],
                  [rage(30), rage(40)],
                ]
              : [rage(10), rage(20)],
            chain: [{ type: 'randomPick', arg: 1 }, ...(grouped ? [{ type: 'flat' }] : [])],
          },
        },
      })
      expect(f.a.currentRage).toBe(0)
      effect.innerApply(f.ctx)
      // Flat action values execute eagerly. Nested groups preserve function values until selection.
      expect(atSelection).toEqual([grouped ? 0 : 20])
      expect(f.a.currentRage).toBe(grouped && reverse ? 40 : 20)
    })
  }
it('historical operator invokes selected functions in order, preserving duplicates', () => {
  const f = fixture(),
    seen: number[] = []
  const first: Action = ctx => {
    expect(ctx).toBe(f.ctx)
    seen.push(1)
  }
  Operators.executeActions()(f.ctx, [first, (() => seen.push(2)) as Action, first, undefined as unknown as Action])
  expect(seen).toEqual([1, 2, 1])
  Operators.executeActions()(f.ctx, [])
  expect(seen).toEqual([1, 2, 1])
})
const originals = parse(
  readFileSync(new URL('./fixtures/effect-regression/effect_skill.yaml', import.meta.url), 'utf8'),
  { merge: true },
).filter((d: { apply?: { type?: string } }) => d.apply?.type === 'executeActions')
it('pins the current action-selection inventory', () => expect(originals).toHaveLength(3))
for (const original of originals)
  it(`parses unchanged ${original.id}`, () => expect(EffectParser.parse(original).id).toBe(original.id))

it('pins the restored historical operator body', () => {
  const source = readFileSync(new URL('../../src/v4/legacy/effectBuilder/src/operator.ts', import.meta.url), 'utf8')
  const body = source.slice(source.indexOf('  executeActions:'), source.indexOf('  conditional:')).replace(/\s+/g, '')
  expect(createHash('sha256').update(body).digest('hex')).toBe(
    '0018eac025797dc90473db8f31fd09fd6f05d44b1a2505b422a23e252573db1d',
  )
})
it('rejects malformed nested actions instead of accepting opaque objects', () => {
  expect(() =>
    EffectParser.parse({
      id: 'fixture/invalid-action',
      trigger: 'BeforeHit',
      priority: 0,
      apply: {
        type: 'executeActions',
        target: { type: 'selectorValue', value: [{ type: 'setRage', target: 'self' }] },
      },
    }),
  ).toThrow()
})
