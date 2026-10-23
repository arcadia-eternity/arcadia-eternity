import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  BaseMark,
  EffectContext,
  EffectTrigger,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { createExperiencePlaceholder } from '@arcadia-eternity/data-pack-base/native'

const id = 'effect_ability_exp_boost_50_percent'
const original = parse(
  readFileSync(new URL('./fixtures/effect-regression/effect_ability.yaml', import.meta.url), 'utf8'),
  { merge: true },
).find((d: { id: string }) => d.id === id)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
for (const kind of ['skill', 'mark'] as const)
  it(`${kind}: retains the TODO without changing battle state`, () => {
    const results = []
    for (const native of [false, true]) {
      const { battle, a, b, debuff } = makeScenario(842)
      battles.push(battle)
      for (const pet of [...a.team, ...b.team]) for (const skill of pet.skills) skill.effects.splice(0)
      const mark = new BaseMark('fixture/experience-source' as baseMarkId, [], debuff.config).createInstance()
      mark.setOwner(a.activePet, battle.emitter)
      a.activePet.marks.push(mark)
      const source = kind === 'skill' ? a.activePet.skills[0] : mark
      const effect = native ? createExperiencePlaceholder() : EffectParser.parse(original)
      source.effects.push(effect)
      const state = () => [
        a.currentRage,
        b.currentRage,
        ...[...a.team, ...b.team].flatMap(p => [p.currentHp, p.level]),
        mark.stack,
      ]
      const before = state()
      const ctx = new EffectContext(battle, EffectTrigger.OnBattleStart, source)
      expect(effect.condition?.(ctx)).toBe(false)
      battle.applyEffects(battle, EffectTrigger.OnBattleStart)
      // The empty body also stays empty if explicitly invoked by a trusted caller.
      battle.executionBudget.run(0, () => effect.innerApply(ctx))
      expect(state()).toEqual(before)
      expect(effect.id).toBe(id)
      expect(effect.triggers).toEqual([EffectTrigger.OnBattleStart])
      expect(effect.priority).toBe(0)
      expect(effect.consumesStacks).toBeUndefined()
      results.push(state())
    }
    expect(results[0]).toEqual(results[1])
  })
it('pins the source placeholder rather than silently implementing an experience rule', () => {
  expect(original).toEqual({
    id,
    trigger: 'OnBattleStart',
    priority: 0,
    condition: { type: 'checkSelf' },
    apply: { type: 'TODO' },
  })
})
