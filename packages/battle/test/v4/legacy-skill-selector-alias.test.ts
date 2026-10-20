import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { BaseSelector, EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  DamageContext,
  AttackTargetOpinion,
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
  const f = makeScenario()
  battles.push(f.battle)
  const skill = f.a.activePet.skills[0]
  const use = new UseSkillContext(new TurnContext(f.battle), f.a, f.a.activePet, AttackTargetOpinion.opponent, skill)
  return { ...f, skill, use }
}
it('historical and imported names share one selector object', () =>
  expect(BaseSelector.useSkillContext).toBe(BaseSelector.usingSkillContext))
for (const name of ['useSkillContext', 'usingSkillContext'] as const)
  for (const nesting of ['direct', 'damage', 'missing', 'effect'] as const)
    it(`${name}/${nesting} queries current context ancestry`, () => {
      const f = fixture()
      const parent =
        nesting === 'direct'
          ? f.use
          : nesting === 'damage'
            ? new DamageContext(f.use, f.a.activePet, f.b.activePet, 10)
            : nesting === 'effect'
              ? new EffectContext(f.use, EffectTrigger.BeforeHit, f.skill)
              : new TurnContext(f.battle)
      const ctx = new EffectContext<EffectTrigger>(parent, EffectTrigger.BeforeHit, f.skill)
      const selector = BaseSelector[name].build()
      expect(selector(ctx)).toEqual(nesting === 'missing' ? [] : [f.use])
      const other = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, f.skill)
      expect(selector(other)).toEqual([])
    })
for (const name of ['useSkillContext', 'usingSkillContext'])
  for (const target of [name, { base: name }])
    it(`parses ${JSON.stringify(target)} as a skill operation target`, () => {
      const f = fixture()
      const effect = EffectParser.parse({
        id: `fixture/skill-alias/${JSON.stringify(target)}`,
        trigger: 'BeforeHit',
        priority: 0,
        apply: { type: 'addPower', target, value: 7 },
      })
      const before = f.use.power
      f.battle.executionBudget.run(0, () =>
        effect.innerApply(new EffectContext(f.use, EffectTrigger.BeforeHit, f.skill, effect)),
      )
      expect(f.use.power).toBe(before + 7)
    })
it('does not invent an entity field alias for skillId', () => {
  expect(() =>
    EffectParser.parse({
      id: 'fixture/no-field-alias',
      trigger: 'BeforeHit',
      priority: 0,
      condition: {
        type: 'evaluate',
        target: { base: 'useSkillContext', chain: [{ type: 'selectPath', arg: 'skillId' }] },
        evaluator: { type: 'exist' },
      },
      apply: { type: 'addPower', target: 'useSkillContext', value: 1 },
    }),
  ).toThrow(/skillId/)
})

// Compare the catalog's original spelling with the imported spelling without
// repairing unrelated paths/operators. Those must remain rejected on both sides.
for (const kind of ['global', 'ability', 'emblem', 'mark', 'skill']) {
  const definitions = parse(
    readFileSync(new URL(`../../../../packs/base/data/effect_${kind}.yaml`, import.meta.url), 'utf8'),
    { merge: true },
  )
  for (const definition of definitions) {
    if (!JSON.stringify(definition).includes('useSkillContext')) continue
    it(`${definition.id}: original and imported selector names have equal parser acceptance`, () => {
      const rename = (value: unknown): unknown =>
        Array.isArray(value)
          ? value.map(rename)
          : value && typeof value === 'object'
            ? Object.fromEntries(
                Object.entries(value).map(([key, child]) => [
                  key,
                  ['base', 'target'].includes(key) && child === 'useSkillContext' ? 'usingSkillContext' : rename(child),
                ]),
              )
            : value
      const acceptance = (source: unknown) => {
        try {
          const effect = EffectParser.parse(source)
          return { accepted: true, id: effect.id, triggers: effect.triggers, priority: effect.priority }
        } catch {
          return { accepted: false }
        }
      }
      expect(acceptance(definition)).toEqual(acceptance(rename(definition)))
    })
  }
}
