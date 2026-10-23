import { readFileSync } from 'node:fs'
import { Type } from '@sinclair/typebox'
import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  CapabilityRegistry,
  coreCapabilities,
  definePredicate,
  compileRule,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  setGlobalLogger,
  type Battle,
  type ConditionData,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function registry(events: string[] = []) {
  return new CapabilityRegistry(coreCapabilities.actions, {
    triggers: coreCapabilities.triggers,
    predicates: [
      ...coreCapabilities.predicates,
      definePredicate({
        id: 'test',
        needs: [],
        params: Type.Object(
          { label: Type.String(), result: Type.Boolean({ default: true }) },
          { additionalProperties: false },
        ),
        test(_ctx, args) {
          events.push(args.label)
          return args.result
        },
      }),
      definePredicate({
        id: 'needs-damage',
        needs: ['pendingDamage'],
        params: Type.Object({}, { additionalProperties: false }),
        test() {
          return true
        },
      }),
    ],
  })
}
const leaf = (label: string, result = true) => ({ nodeId: label, id: 'test', params: { label, result } })
function rule<T>(when: T) {
  return {
    formatVersion: 1,
    id: 'condition-tree',
    trigger: { nodeId: 'trigger', id: 'core.selfSkillHit' },
    when,
    actions: [{ stepId: 'heal', id: 'core.healOwner', params: { amount: 10 } }],
  }
}
function compile(when: unknown, events: string[] = []) {
  return compileRule(rule(when), registry(events), { contentId: 'tree', sourceKind: 'skill' })
}
function dispatch(when: unknown) {
  const events: string[] = []
  const result = compile(when, events)
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  const { battle, a } = makeScenario()
  battles.push(battle)
  a.activePet.currentHp = 1
  const source = a.activePet.skills[0]
  source.effects.push(result.effect)
  const use = new UseSkillContext(new TurnContext(battle), a, a.activePet, AttackTargetOpinion.opponent, source)
  battle.applyEffects(use, EffectTrigger.OnHit, source)
  return { events, hp: a.activePet.currentHp, result }
}

it('evaluates nested all/any/not in declared order with short-circuiting', () => {
  const actual = dispatch({
    nodeId: 'all',
    kind: 'all',
    conditions: [
      leaf('first'),
      { nodeId: 'any', kind: 'any', conditions: [leaf('false', false), leaf('true'), leaf('skip-any')] },
      { nodeId: 'not', kind: 'not', condition: leaf('negated', false) },
    ],
  })
  expect(actual.events).toEqual(['first', 'false', 'true', 'negated'])
  expect(actual.hp).toBe(11)
  const failed = dispatch({ nodeId: 'all', kind: 'all', conditions: [leaf('stop', false), leaf('skip-all')] })
  expect(failed.events).toEqual(['stop'])
  expect(failed.hp).toBe(1)
})

it('normalizes leaf defaults and preserves nested parameter references through JSON recompilation', () => {
  const input = {
    ...rule({
      nodeId: 'all',
      kind: 'all',
      conditions: [
        { nodeId: 'default', id: 'test', params: { label: 'default' } },
        { nodeId: 'hp', id: 'core.ownerHpBelowRatio', params: { ratio: { parameter: 'threshold' } } },
      ],
    }),
    parameters: { threshold: { nodeId: 'threshold-param', kind: 'number', value: 0.5 } },
  }
  const result = compileRule(input, registry(), { contentId: 'tree', sourceKind: 'skill' })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  const condition = result.rule.when!
  if (!('kind' in condition) || condition.kind !== 'all') throw new Error('Expected all')
  expect(condition.conditions[0]).toEqual({ nodeId: 'default', id: 'test', params: { label: 'default', result: true } })
  expect(condition.conditions[1]).toEqual(input.when.conditions[1])
  const copy = compileRule(JSON.parse(JSON.stringify(result.rule)), registry(), {
    contentId: 'copy',
    sourceKind: 'skill',
  })
  expect(copy.ok).toBe(true)
  if (copy.ok)
    expect(copy.parameterDefinitions.map(p => p.address)).toEqual(result.parameterDefinitions.map(p => p.address))
})

it.each(['unknown', 'needs-damage'])('validates even a short-circuited branch: %s', id => {
  const result = compile({ nodeId: 'all', kind: 'all', conditions: [leaf('false', false), { nodeId: 'bad-leaf', id }] })
  expect(result.ok).toBe(false)
  if (!result.ok)
    expect(result.diagnostics[0]).toMatchObject({
      nodeId: 'bad-leaf',
      field: 'when',
      code: id === 'unknown' ? 'UNKNOWN_CAPABILITY' : 'CAPABILITY_MISMATCH',
    })
})

it('rejects duplicate IDs across nested branches and action nodes', () => {
  const result = compile({
    nodeId: 'all',
    kind: 'all',
    conditions: [leaf('same'), { nodeId: 'not', kind: 'not', condition: leaf('same') }],
  })
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.diagnostics[0]).toMatchObject({ code: 'DUPLICATE_ID', nodeId: 'same' })
  expect(compile({ nodeId: 'heal', kind: 'not', condition: leaf('x') }).ok).toBe(false)
})

it('accepts depth 8 and 64 nodes but rejects the first node beyond either boundary', () => {
  let when: ConditionData = leaf('base')
  for (let i = 0; i < 7; i++) when = { nodeId: `not-${i}`, kind: 'not', condition: when }
  expect(compile(when).ok).toBe(true)
  const deep = compile({ nodeId: 'too-deep', kind: 'not', condition: when })
  expect(deep.ok).toBe(false)
  if (!deep.ok) expect(deep.diagnostics[0].code).toBe('LIMIT_EXCEEDED')
  expect(
    compile({ nodeId: 'all', kind: 'all', conditions: Array.from({ length: 63 }, (_, i) => leaf(`leaf-${i}`)) }).ok,
  ).toBe(true)
  const wide = compile({
    nodeId: 'all',
    kind: 'all',
    conditions: Array.from({ length: 64 }, (_, i) => leaf(`leaf-${i}`)),
  })
  expect(wide.ok).toBe(false)
  if (!wide.ok) expect(wide.diagnostics[0].code).toBe('LIMIT_EXCEEDED')
})

it.each([
  { nodeId: 'empty', kind: 'all', conditions: [] },
  { nodeId: 'empty', kind: 'any', conditions: [] },
  { nodeId: 'not', kind: 'not', condition: leaf('x'), extra: true },
])('rejects malformed compound nodes', when => {
  expect(compile(when).ok).toBe(false)
})

it('executes the saved compound example with live linked parameters', () => {
  const input = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/examples/ugc-conditional-healing.json', import.meta.url), 'utf8'),
  )
  const result = compileRule(input, registry(), { contentId: 'band', sourceKind: 'skill' })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  const { battle, a } = makeScenario()
  battles.push(battle)
  result.parameters.install(battle.configSystem)
  a.activePet.attributeSystem.updateBaseValue('maxHp', 400)
  const source = a.activePet.skills[0]
  source.effects.push(result.effect)
  const use = new UseSkillContext(new TurnContext(battle), a, a.activePet, AttackTargetOpinion.opponent, source)
  for (const [before, after] of [
    [20, 20],
    [40, 140],
    [100, 200],
    [200, 200],
  ]) {
    a.activePet.currentHp = before
    battle.applyEffects(use, EffectTrigger.OnHit, source)
    expect(a.activePet.currentHp).toBe(after)
  }
})
