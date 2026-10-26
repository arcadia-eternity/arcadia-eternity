import { afterEach, beforeAll, expect, it } from 'vitest'
import { Type } from '@sinclair/typebox'
import {
  AttackTargetOpinion,
  BaseMark,
  BattleMessageType,
  CapabilityRegistry,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  compileBehaviorUse,
  copyBehaviorUse,
  coreCapabilities,
  createCoreCapabilityRegistry,
  defineRuleOperation,
  defineRuleValue,
  encapsulateRule,
  expandBehaviorUse,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { ops, targets } from '@arcadia-eternity/battle/v4/authoring'
import { makeScenario } from './scenario'

interface DataNode {
  nodeId: string
  id: string
  params?: Record<string, unknown>
  inputs?: Record<string, unknown>
}
interface DataAction {
  stepId: string
  id: string
  params: Record<string, unknown>
  inputs: Record<string, unknown>
}
const owner = { kind: 'skill' as const, id: 'fixture/setup' }
const use = { useId: 'checked-use', definitionId: 'ugc/controlled' }
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})

function damageDefinition() {
  return {
    formatVersion: 1,
    id: use.definitionId,
    sourceKind: 'skill',
    parameters: {},
    implementation: {
      kind: 'rule',
      rule: {
        formatVersion: 1,
        id: 'ugc/controlled-rule',
        trigger: { nodeId: 'hit', id: 'core.selfSkillHit' },
        values: [
          { nodeId: 'target', id: 'core.opponentActive' },
          { nodeId: 'amount', id: 'core.number', params: { value: 10 } },
        ] as DataNode[],
        actions: [
          {
            stepId: 'damage',
            id: 'core.dealDamage',
            params: {},
            inputs: { target: { node: 'target' }, amount: { node: 'amount' } },
          },
        ] as DataAction[],
      },
    },
  }
}

type Candidate = ReturnType<typeof damageDefinition>
function compile(definition: unknown, registry = createCoreCapabilityRegistry()) {
  return compileBehaviorUse(definition, use, { owner, registry })
}
function rejected(
  result: ReturnType<typeof compileBehaviorUse>,
  expected?: { nodeId?: string; field?: RegExp; code?: string },
) {
  expect(result.ok).toBe(false)
  expect(result).not.toHaveProperty('effect')
  if (result.ok) throw new Error('Unsafe rule unexpectedly compiled')
  expect(result.diagnostics).not.toHaveLength(0)
  const diagnostic = result.diagnostics[0]
  expect(diagnostic).toMatchObject({ contentId: owner.id, useId: use.useId })
  if (expected?.nodeId) expect(diagnostic.nodeId).toBe(expected.nodeId)
  if (expected?.field) expect(diagnostic.field).toMatch(expected.field)
  else expect(diagnostic.field).toEqual(expect.any(String))
  if (expected?.code) expect(diagnostic.code).toBe(expected.code)
  expect(diagnostic.message).not.toBe('')
}

it('admits the saved damage graph before testing malformed variants', () => {
  expect(compile(JSON.parse(JSON.stringify(damageDefinition())))).toMatchObject({ ok: true })
})

it('saves, copies and expands a bounded damage preset without linking the expanded copy to later source edits', () => {
  const rule = {
    ...damageDefinition().implementation.rule,
    parameters: { amount: { nodeId: 'public-amount', kind: 'number', value: 10 } },
    values: [
      { nodeId: 'target', id: 'core.opponentActive' },
      { nodeId: 'factor', id: 'core.number', params: { value: 1 } },
      {
        nodeId: 'amount',
        id: 'core.multiply',
        inputs: { left: { parameter: 'amount' }, right: { node: 'factor' } },
      },
    ],
  }
  const definition = encapsulateRule(rule, {
    id: use.definitionId,
    sourceKind: 'skill',
    parameters: { amount: { kind: 'number', default: 10, minimum: 0, maximum: 20 } },
  })
  const originalUse = { ...use, params: { amount: 10 } }
  const copiedUse = copyBehaviorUse({ ...originalUse, params: { amount: 15 } }, 'expanded-copy')
  const options = { owner, registry: createCoreCapabilityRegistry() }
  const expansion = expandBehaviorUse(definition, copiedUse, 'ugc/expanded-damage', options)
  if (!expansion.ok) throw new Error(JSON.stringify(expansion.diagnostics))
  const saved = JSON.parse(
    JSON.stringify({
      definition,
      originalUse,
      expandedDefinition: expansion.expandedDefinition,
      expandedUse: expansion.expandedUse,
    }),
  )
  expect(saved.expandedUse.useId).toBe('expanded-copy')
  expect(saved.expandedDefinition.parameters.amount).toMatchObject({ minimum: 0, maximum: 20, default: 15 })
  expect(saved.expandedDefinition.implementation.rule.values).toEqual(saved.definition.implementation.rule.values)
  expect(saved.expandedDefinition.implementation.rule.actions).toEqual(saved.definition.implementation.rule.actions)

  // A later upstream revision triples damage; the saved expanded rule keeps its own factor and references.
  saved.definition.implementation.rule.values[1].params.value = 3
  const original = compileBehaviorUse(saved.definition, saved.originalUse, options)
  const expanded = compileBehaviorUse(saved.expandedDefinition, saved.expandedUse, options)
  if (!original.ok || !expanded.ok) throw new Error('Expected both saved damage presets to compile')
  expect(original.effect.id).not.toBe(expanded.effect.id)
  const fixture = makeScenario(243)
  battles.push(fixture.battle)
  const skill = fixture.a.activePet.skills[0]
  skill.effects.splice(0, skill.effects.length, original.effect, expanded.effect)
  for (const compiled of [original, expanded]) compiled.parameters.install(fixture.battle.configSystem)
  fixture.b.activePet.attributeSystem.updateBaseValue('maxHp', 200)
  fixture.b.activePet.currentHp = 200
  const amounts: number[] = []
  fixture.battle.registerListener(message => {
    if (message.type === BattleMessageType.Damage) amounts.push(message.data.damage)
  })
  const apply = () =>
    fixture.battle.applyEffects(
      new UseSkillContext(
        new TurnContext(fixture.battle),
        fixture.a,
        fixture.a.activePet,
        AttackTargetOpinion.opponent,
        skill,
      ),
      EffectTrigger.OnHit,
      skill,
    )
  apply()
  original.parameters.set(fixture.battle.configSystem, original.parameterAddresses.amount, 6)
  apply()
  expect(amounts).toEqual([30, 15, 18, 15])
  expect(fixture.b.activePet.currentHp).toBe(122)
  expect(() => original.parameters.set(fixture.battle.configSystem, original.parameterAddresses.amount, 21)).toThrow()
  expect(() => expanded.parameters.set(fixture.battle.configSystem, expanded.parameterAddresses.amount, -1)).toThrow()
})

it.each([
  {
    name: 'unknown value capability',
    mutate: (data: Candidate) => {
      data.implementation.rule.values[0].id = 'untrusted.eval'
    },
    nodeId: 'target',
    field: /id$/,
    code: 'UNKNOWN_CAPABILITY',
  },
  {
    name: 'unknown operation capability',
    mutate: (data: Candidate) => {
      data.implementation.rule.actions[0].id = 'untrusted.writeHp'
    },
    nodeId: 'damage',
    field: /id$/,
    code: 'UNKNOWN_CAPABILITY',
  },
  {
    name: 'selector in a numeric slot',
    mutate: (data: Candidate) => {
      data.implementation.rule.actions[0].inputs.amount = { node: 'target' }
    },
    nodeId: 'damage',
    field: /inputs.*amount$/,
    code: 'CAPABILITY_MISMATCH',
  },
  {
    name: 'number in a selector slot',
    mutate: (data: Candidate) => {
      data.implementation.rule.actions[0].inputs.target = { node: 'amount' }
    },
    nodeId: 'damage',
    field: /inputs.*target$/,
    code: 'CAPABILITY_MISMATCH',
  },
  {
    name: 'missing required slot',
    mutate: (data: Candidate) => {
      delete data.implementation.rule.actions[0].inputs.target
    },
    nodeId: 'damage',
    field: /inputs.*target$/,
  },
  {
    name: 'unknown slot',
    mutate: (data: Candidate) => {
      data.implementation.rule.actions[0].inputs.extra = { node: 'amount' }
    },
    nodeId: 'damage',
    field: /inputs.*extra$/,
  },
  {
    name: 'dangling graph reference',
    mutate: (data: Candidate) => {
      data.implementation.rule.actions[0].inputs.amount = { node: 'absent' }
    },
    nodeId: 'damage',
    field: /inputs.*amount\/node$/,
    code: 'MISSING_REFERENCE',
  },
  {
    name: 'dangling public parameter',
    mutate: (data: Candidate) => {
      data.implementation.rule.actions[0].inputs.amount = { parameter: 'absent' }
    },
    nodeId: 'damage',
    field: /inputs.*amount$/,
    code: 'MISSING_REFERENCE',
  },
  {
    name: 'mark-only value on a skill source',
    mutate: (data: Candidate) => {
      data.implementation.rule.values[0].id = 'core.sourceMark'
    },
    nodeId: 'target',
    field: /values/,
    code: 'CAPABILITY_MISMATCH',
  },
  {
    name: 'unknown number parameter',
    mutate: (data: Candidate) => {
      data.implementation.rule.values[1].params = { value: 10, expression: 'Math.random()' }
    },
    nodeId: 'amount',
    field: /params.*expression$/,
  },
] as const)('rejects $name with a use, node and field before activation', ({ mutate, ...expected }) => {
  const data = damageDefinition()
  mutate(data)
  rejected(compile(data), expected)
})

it('rejects a missing trigger context even for an otherwise registered capability', () => {
  const contextOnly = defineRuleValue({
    id: 'test.pendingDamageAmount',
    params: Type.Object({}, { additionalProperties: false }),
    inputs: {},
    needs: ['pendingDamage'],
    output: 'number',
    missing: 'skip',
    build: () => targets.ownerPet.first().attribute('maxHp'),
  })
  const registry = new CapabilityRegistry(coreCapabilities.actions, {
    ...coreCapabilities,
    values: [...coreCapabilities.values, contextOnly],
  })
  const data = damageDefinition()
  data.implementation.rule.values[1] = { nodeId: 'amount', id: contextOnly.id }
  rejected(compile(data, registry), { nodeId: 'amount', code: 'CAPABILITY_MISMATCH', field: /values/ })
})

it('rejects cycles rather than recursively constructing persistent queries', () => {
  const data = damageDefinition()
  data.implementation.rule.values[1] = {
    nodeId: 'amount',
    id: 'core.multiply',
    inputs: { left: { node: 'other' }, right: { node: 'other' } },
  }
  data.implementation.rule.values.push({
    nodeId: 'other',
    id: 'core.multiply',
    inputs: { left: { node: 'amount' }, right: { node: 'amount' } },
  })
  rejected(compile(data), { field: /values/ })
})

it.each(['value', 'action'] as const)('rejects a duplicate stable identity shared by a %s', kind => {
  const data = damageDefinition()
  if (kind === 'value') data.implementation.rule.values[1].nodeId = 'target'
  else data.implementation.rule.actions[0].stepId = 'target'
  rejected(compile(data), { nodeId: 'target', code: 'DUPLICATE_ID' })
})

it('rejects a graph whose reference depth exceeds the bounded contract', () => {
  const data = damageDefinition()
  for (let index = 0; index < 24; index++) {
    const previous = index ? `multiply-${index - 1}` : 'amount'
    data.implementation.rule.values.push({
      nodeId: `multiply-${index}`,
      id: 'core.multiply',
      inputs: { left: { node: previous }, right: { node: 'amount' } },
    })
  }
  data.implementation.rule.actions[0].inputs.amount = { node: 'multiply-23' }
  rejected(compile(data), { code: 'LIMIT_EXCEEDED', field: /values/ })
})

it('rejects too many declared value nodes even when they are not executed', () => {
  const data = damageDefinition()
  for (let index = 0; index < 129; index++)
    data.implementation.rule.values.push({ nodeId: `unused-${index}`, id: 'core.number', params: { value: 1 } })
  rejected(compile(data), { field: /values/ })
})

it('rejects cyclic programmatic input before any capability can execute', () => {
  const data = damageDefinition()
  const params: Record<string, unknown> = { value: 10 }
  params.self = params
  data.implementation.rule.values[1].params = params
  rejected(compile(data))
})

it('rejects deeply nested programmatic data before capability construction', () => {
  const data = damageDefinition()
  let nested: Record<string, unknown> = { value: 1 }
  for (let index = 0; index < 48; index++) nested = { nested }
  data.implementation.rule.values[1].params = nested
  rejected(compile(data), { code: 'LIMIT_EXCEEDED' })
})

it.each([
  ['function', () => ({ value: () => 10 })],
  ['non-finite number', () => ({ value: Infinity })],
  ['prototype-bearing object', () => Object.assign(Object.create({ inherited: 1 }), { value: 10 })],
  ['prototype key', () => JSON.parse('{"value":10,"__proto__":{"polluted":true}}')],
] as const)('rejects %s in saved capability arguments', (_name, params) => {
  const data = damageDefinition()
  data.implementation.rule.values[1].params = params()
  rejected(compile(data), { field: /values.*params/ })
  expect(Object.prototype).not.toHaveProperty('polluted')
})

function boundDefinition() {
  const data = damageDefinition()
  data.sourceKind = 'petMark'
  data.implementation.rule.trigger.id = 'core.markCreated'
  data.implementation.rule.values = [
    { nodeId: 'owner', id: 'core.ownerPet' },
    { nodeId: 'opponent', id: 'core.opponentActive' },
    { nodeId: 'selected', id: 'core.firstPet', inputs: { target: { node: 'opponent' } } },
    { nodeId: 'following', id: 'core.followPet', inputs: { target: { node: 'selected' } } },
    {
      nodeId: 'defense',
      id: 'core.boundPetAttribute',
      params: { attribute: 'def', mode: 'capture', scope: 'input' },
      inputs: { target: { node: 'following' } },
    },
  ]
  data.implementation.rule.actions = [
    {
      stepId: 'bound',
      id: 'core.bindAttribute',
      params: { attribute: 'atk', operation: 'delta', lifetime: 'sourceMark', missing: 'detach' },
      inputs: { target: { node: 'owner' }, value: { node: 'defense' } },
    },
  ]
  return data
}
function compileBound(data: unknown) {
  const sourceMark = new BaseMark(owner.id as baseMarkId, [])
  return compileBehaviorUse(data, use, {
    owner: { ...owner, kind: 'petMark' },
    sourceMark,
    registry: createCoreCapabilityRegistry(),
  })
}

it('admits the explicit per-entry capture contract', () => {
  expect(compileBound(JSON.parse(JSON.stringify(boundDefinition())))).toMatchObject({ ok: true })
})
it.each([
  {
    name: 'instant target in a persistent attribute slot',
    mutate: (data: Candidate) => {
      data.implementation.rule.values[4].inputs!.target = { node: 'selected' }
    },
    nodeId: 'defense',
    field: /inputs.*target$/,
  },
  {
    name: 'persistent number in an immediate damage slot',
    mutate: (data: Candidate) => {
      data.implementation.rule.actions[0] = {
        stepId: 'bound',
        id: 'core.dealDamage',
        params: {},
        inputs: { target: { node: 'owner' }, amount: { node: 'defense' } },
      }
    },
    nodeId: 'bound',
    field: /inputs.*amount$/,
  },
  {
    name: 'arbitrary property path',
    mutate: (data: Candidate) => {
      data.implementation.rule.values[4].params!.attribute = 'owner.battle'
    },
    nodeId: 'defense',
    field: /params.*attribute$/,
  },
  {
    name: 'undefined capture scope',
    mutate: (data: Candidate) => {
      data.implementation.rule.values[4].params!.scope = 'turn'
    },
    nodeId: 'defense',
    field: /params.*scope$/,
  },
  {
    name: 'capture without a temporal scope',
    mutate: (data: Candidate) => {
      delete data.implementation.rule.values[4].params!.scope
    },
    nodeId: 'defense',
    field: /params/,
  },
  {
    name: 'follow combined with a capture scope',
    mutate: (data: Candidate) => {
      data.implementation.rule.values[4].params!.mode = 'follow'
    },
    nodeId: 'defense',
    field: /params/,
  },
  {
    name: 'unsupported contribution lifetime',
    mutate: (data: Candidate) => {
      data.implementation.rule.actions[0].params.lifetime = 'forever'
    },
    nodeId: 'bound',
    field: /params.*lifetime$/,
  },
  {
    name: 'invented zero for a missing input',
    mutate: (data: Candidate) => {
      data.implementation.rule.actions[0].params.missing = 'zero'
    },
    nodeId: 'bound',
    field: /params.*missing$/,
  },
] as const)('rejects $name', ({ mutate, ...expected }) => {
  const data = boundDefinition()
  mutate(data)
  rejected(compileBound(data), expected)
})

it('executes a host-registered capability from saved data and denies it when the host omits registration', () => {
  let builds = 0
  const amount = defineRuleValue({
    id: 'example.ownerDefenseFraction',
    params: Type.Object({ ratio: Type.Number({ minimum: 0, maximum: 1 }) }, { additionalProperties: false }),
    inputs: {},
    needs: ['ownerPet'],
    output: 'number',
    missing: 'skip',
    build: ({ params }) => {
      builds++
      return targets.ownerPet
        .first()
        .attribute('def')
        .map(value => Math.floor(value * params.ratio))
    },
  })
  const heal = defineRuleOperation({
    id: 'example.healSelected',
    params: Type.Object({}, { additionalProperties: false }),
    inputs: { target: 'selectorPet', amount: 'number' },
    needs: [],
    missing: 'skip',
    build: ({ inputs }) => inputs.target.apply(ops.heal(inputs.amount)),
  })
  const registry = new CapabilityRegistry(coreCapabilities.actions, {
    ...coreCapabilities,
    values: [...coreCapabilities.values, amount],
    operations: [...coreCapabilities.operations, heal],
  })
  const data = damageDefinition()
  data.implementation.rule.values[0].id = 'core.ownerPet'
  data.implementation.rule.values[1] = { nodeId: 'amount', id: amount.id, params: { ratio: 0.5 } }
  data.implementation.rule.actions[0].id = heal.id
  const saved = JSON.parse(JSON.stringify(data))
  rejected(compile(saved), { code: 'UNKNOWN_CAPABILITY', nodeId: 'amount' })
  expect(builds).toBe(0)
  const invalid = structuredClone(saved)
  invalid.implementation.rule.values[1].params.ratio = 2
  rejected(compile(invalid, registry), { nodeId: 'amount', field: /params.*ratio$/ })
  expect(builds).toBe(0)
  const result = compile(saved, registry)
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  const fixture = makeScenario(242)
  battles.push(fixture.battle)
  const pet = fixture.a.activePet
  pet.attributeSystem.updateBaseValue('def', 40)
  pet.currentHp = 1
  const skill = pet.skills[0]
  skill.effects.splice(0, skill.effects.length, result.effect)
  result.parameters.install(fixture.battle.configSystem)
  fixture.battle.applyEffects(
    new UseSkillContext(new TurnContext(fixture.battle), fixture.a, pet, AttackTargetOpinion.opponent, skill),
    EffectTrigger.OnHit,
    skill,
  )
  expect(pet.currentHp).toBe(21)
  expect(builds).toBeGreaterThan(0)
})

it('keeps the action identity for a malformed saved slot before behavior schema normalization', () => {
  const data = damageDefinition()
  data.implementation.rule.actions[0].inputs.amount = 1
  rejected(compile(data), {
    nodeId: 'damage',
    field: /^\/implementation\/rule\/actions\/0\/inputs\/amount$/,
    code: 'INVALID_PARAMETERS',
  })
})

it('retains structural identities for non-finite rule data rejected by aggregate admission', () => {
  const data = damageDefinition()
  data.implementation.rule.values[1].params = { value: Infinity }
  const result = compile(data)
  rejected(result, {
    nodeId: 'amount',
    field: /^\/implementation\/rule\/values\/1\/params\/value$/,
    code: 'INVALID_PARAMETERS',
  })
  if (result.ok) throw new Error('Non-finite value admitted')
  expect(result.diagnostics[0].ruleId).toBe('ugc/controlled-rule')
})
