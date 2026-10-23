import { afterEach, beforeAll, expect, it } from 'vitest'
import { Type } from '@sinclair/typebox'
import {
  defineAction,
  defineTrigger,
  CapabilityRegistry,
  compileRule,
  EffectTrigger,
  Pet,
  TurnContext,
  ConfigModifier,
  ConfigModifierType,
  ConfigDurationType,
  parameterAddress,
  setGlobalLogger,
  type Battle,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const empty = Type.Object({}, { additionalProperties: false })
const trigger = defineTrigger({
  id: 'turn',
  trigger: EffectTrigger.TurnEnd,
  params: empty,
  provides: { skill: ['ownerPet'] },
  resolve(ctx) {
    return ctx.source.owner instanceof Pet ? { ownerPet: ctx.source.owner } : {}
  },
})
const healing = (id: string, max = 200) =>
  defineAction({
    id,
    needs: ['ownerPet'],
    params: Type.Object(
      { amount: Type.Number({ minimum: 0, maximum: 100, default: 10 }) },
      { additionalProperties: false },
    ),
    publicParams: {
      amount: {
        effectiveSchema: Type.Number({ minimum: 0, maximum: max }),
        operations: [ConfigModifierType.delta],
        tags: ['healing'],
      },
    },
    execute(ctx, args) {
      ctx.ops.heal(ctx.ownerPet, args.amount)
    },
  })
function rule() {
  return {
    formatVersion: 1,
    id: 'shared/heal',
    parameters: { amount: { nodeId: 'shared-amount', kind: 'number', value: 10 } },
    trigger: { nodeId: 'turn', id: trigger.id },
    actions: [
      { stepId: 'first', id: 'heal', params: { amount: { parameter: 'amount' } } },
      { stepId: 'second', id: 'heal', params: { amount: { parameter: 'amount' } } },
    ],
  }
}

it('preserves a shared parameter reference and reads scoped effective values for each use', () => {
  const { battle, a, b } = makeScenario()
  battles.push(battle)
  const registry = new CapabilityRegistry([healing('heal')], { triggers: [trigger] })
  const result = compileRule(rule(), registry, { contentId: 'heal', sourceKind: 'skill' })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  expect(result.parameterDefinitions).toHaveLength(1)
  expect(result.rule.actions.map(action => action.params)).toEqual([
    { amount: { parameter: 'amount' } },
    { amount: { parameter: 'amount' } },
  ])
  result.parameters.install(battle.configSystem)
  const address = parameterAddress('shared/heal', 'shared-amount', 'amount')
  const sourceA = a.activePet.skills[0],
    sourceB = b.activePet.skills[0]
  sourceA.effects.push(result.effect)
  sourceB.effects.push(result.effect)
  a.activePet.currentHp = b.activePet.currentHp = 1
  const remove = result.parameters.modify(
    battle.configSystem,
    address,
    new ConfigModifier(ConfigDurationType.binding, 'increase', 5, ConfigModifierType.delta, 0),
    sourceA,
  )
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, sourceA)
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, sourceB)
  expect(a.activePet.currentHp).toBe(31)
  expect(b.activePet.currentHp).toBe(21)
  remove()
  expect(result.parameters.read(battle.configSystem, address, sourceA)).toBe(10)
})

it('re-reads a shared Config value after an earlier action modifies it', () => {
  const { battle, a } = makeScenario()
  battles.push(battle)
  let change = () => {}
  const boost = defineAction({
    id: 'boost',
    params: empty,
    needs: [],
    execute() {
      change()
    },
  })
  const registry = new CapabilityRegistry([healing('heal'), boost], { triggers: [trigger] })
  const input = rule()
  const result = compileRule(
    { ...input, actions: [input.actions[0], { stepId: 'boost', id: 'boost' }, input.actions[1]] },
    registry,
    { contentId: 'heal', sourceKind: 'skill' },
  )
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  result.parameters.install(battle.configSystem)
  const source = a.activePet.skills[0]
  change = () => {
    result.parameters.modify(
      battle.configSystem,
      result.parameterDefinitions[0],
      new ConfigModifier(ConfigDurationType.binding, 'boost', 5, ConfigModifierType.delta, 0),
      source,
    )
  }
  source.effects.push(result.effect)
  a.activePet.currentHp = 1
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source)
  expect(a.activePet.currentHp).toBe(26)
})

it('enforces every receiving slot and separates effective ranges from content editing ranges', () => {
  const { battle, a } = makeScenario()
  battles.push(battle)
  const registry = new CapabilityRegistry([healing('heal'), healing('limited', 12)], { triggers: [trigger] })
  const input = rule()
  input.actions[1].id = 'limited'
  const limited = compileRule(input, registry, { contentId: 'heal', sourceKind: 'skill' })
  if (!limited.ok) throw new Error(JSON.stringify(limited.diagnostics))
  limited.parameters.install(battle.configSystem)
  const remove = limited.parameters.modify(
    battle.configSystem,
    limited.parameterDefinitions[0],
    new ConfigModifier(ConfigDurationType.binding, 'too-high', 5, ConfigModifierType.delta, 0),
  )
  expect(() => limited.parameters.read(battle.configSystem, limited.parameterDefinitions[0])).toThrow('effective')
  remove()
  const broad = compileRule({ ...rule(), id: 'broad', actions: [rule().actions[0]] }, registry, {
    contentId: 'heal',
    sourceKind: 'skill',
  })
  if (!broad.ok) throw new Error(JSON.stringify(broad.diagnostics))
  broad.parameters.install(battle.configSystem)
  broad.parameters.modify(
    battle.configSystem,
    broad.parameterDefinitions[0],
    new ConfigModifier(ConfigDurationType.binding, 'above-content-limit', 140, ConfigModifierType.delta, 0),
  )
  const source = a.activePet.skills[0]
  source.effects.push(broad.effect)
  a.activePet.currentHp = 1
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source)
  expect(a.activePet.currentHp).toBe(Math.min(a.activePet.stat.maxHp, 151))
})

it('rejects missing references, mismatched kinds and effective schemas that widen inferred literal types', () => {
  const registry = new CapabilityRegistry([healing('heal')], { triggers: [trigger] })
  expect(
    compileRule({ ...rule(), parameters: {} }, registry, { contentId: 'heal', sourceKind: 'skill' }),
  ).toMatchObject({ ok: false, diagnostics: [{ code: 'MISSING_REFERENCE' }] })
  expect(
    compileRule({ ...rule(), parameters: { amount: { nodeId: 'amount', kind: 'boolean', value: 10 } } }, registry, {
      contentId: 'heal',
      sourceKind: 'skill',
    }).ok,
  ).toBe(false)
  expect(() =>
    defineAction({
      id: 'literal',
      needs: [],
      params: Type.Object({ amount: Type.Literal(1) }, { additionalProperties: false }),
      publicParams: { amount: { effectiveSchema: Type.Number(), operations: [ConfigModifierType.delta] } },
      execute() {},
    }),
  ).toThrow('widens')
})

it('keeps literal content constants separate from Config readers and preserves links through JSON recompilation', () => {
  const registry = new CapabilityRegistry([healing('heal', 12)], { triggers: [trigger] })
  const constant = compileRule(
    { ...rule(), parameters: {}, actions: [{ stepId: 'constant', id: 'heal', params: { amount: 20 } }] },
    registry,
    { contentId: 'heal', sourceKind: 'skill' },
  )
  if (!constant.ok) throw new Error(JSON.stringify(constant.diagnostics))
  expect(constant.parameterDefinitions).toHaveLength(0)
  expect(constant.rule.actions[0].params).toEqual({ amount: 20 })
  const linked = compileRule(rule(), registry, { contentId: 'heal', sourceKind: 'skill' })
  if (!linked.ok) throw new Error(JSON.stringify(linked.diagnostics))
  const restored = compileRule(JSON.parse(JSON.stringify(linked.rule)), registry, {
    contentId: 'heal',
    sourceKind: 'skill',
  })
  if (!restored.ok) throw new Error(JSON.stringify(restored.diagnostics))
  expect(restored.rule).toEqual(linked.rule)
  expect(restored.parameterDefinitions.map(parameter => parameter.address)).toEqual(
    linked.parameterDefinitions.map(parameter => parameter.address),
  )
  const reordered = compileRule({ ...linked.rule, actions: [...linked.rule.actions].reverse() }, registry, {
    contentId: 'heal',
    sourceKind: 'skill',
  })
  if (!reordered.ok) throw new Error(JSON.stringify(reordered.diagnostics))
  expect(reordered.parameterDefinitions[0].address).toBe(linked.parameterDefinitions[0].address)
})
