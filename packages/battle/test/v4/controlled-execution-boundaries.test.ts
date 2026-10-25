import { afterEach, beforeAll, expect, it } from 'vitest'
import { Type } from '@sinclair/typebox'
import {
  AddMarkContext,
  AttackTargetOpinion,
  BaseMark,
  CapabilityRegistry,
  ConfigModifierType,
  EffectContext,
  EffectPhase,
  EffectTrigger,
  ExecutionBudgetExceeded,
  Signal,
  TurnContext,
  UseSkillContext,
  compileBehaviorUse,
  createCoreCapabilityRegistry,
  defineAction,
  defineNativeEffect,
  defineTrigger,
  defineValue,
  executionBudgetPolicy,
  installValueModifier,
  lockContentEnvironment,
  setGlobalLogger,
  values,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function fixture() {
  const f = makeScenario()
  battles.push(f.battle)
  const source = f.a.activePet.skills[0]
  source.effects.splice(0)
  return { ...f, source }
}

it('shares the action allowance across saved behavior uses and stops subsequent effects only in that battle', () => {
  const calls: number[] = []
  const amount = Type.Number({ minimum: 0, maximum: 10 })
  const registry = new CapabilityRegistry(
    [
      defineAction({
        id: 'test.record',
        needs: [],
        params: Type.Object({ amount }, { additionalProperties: false }),
        publicParams: { amount: { effectiveSchema: amount, operations: [ConfigModifierType.override] } },
        execute: (_context, params) => calls.push(params.amount),
      }),
    ],
    {
      triggers: [
        defineTrigger({
          id: 'test.turn',
          trigger: EffectTrigger.TurnEnd,
          params: Type.Object({}, { additionalProperties: false }),
          provides: { skill: [] },
          resolve: () => ({}),
        }),
      ],
    },
  )
  const saved = JSON.stringify({
    definition: {
      formatVersion: 1,
      id: 'test/record',
      sourceKind: 'skill',
      parameters: { amount: { kind: 'number', default: 1, minimum: 0, maximum: 10 } },
      implementation: {
        kind: 'rule',
        rule: {
          formatVersion: 1,
          id: 'test/record-rule',
          parameters: { amount: { nodeId: 'amount', kind: 'number', value: 1 } },
          trigger: { nodeId: 'trigger', id: 'test.turn' },
          actions: [{ stepId: 'record', id: 'test.record', params: { amount: { parameter: 'amount' } } }],
        },
      },
    },
    uses: [
      { useId: 'first', definitionId: 'test/record', params: { amount: 1 } },
      { useId: 'second', definitionId: 'test/record', params: { amount: 2 } },
    ],
  })
  const install = () => {
    const f = fixture()
    const data = JSON.parse(saved)
    for (const use of data.uses) {
      const compiled = compileBehaviorUse(data.definition, use, {
        registry,
        owner: { kind: 'skill', id: f.source.baseId },
      })
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
      compiled.parameters.install(f.battle.configSystem)
      f.source.effects.push(compiled.effect)
    }
    f.source.effects.push(
      defineNativeEffect({
        id: 'test/after-budget' as effectId,
        triggers: [EffectTrigger.TurnEnd],
        priority: -1,
        apply: () => calls.push(99),
      }),
    )
    return f
  }
  const first = install(),
    other = install()
  first.battle.executionBudget.restoreState({
    turn: first.battle.currentTurn,
    turnActions: executionBudgetPolicy.turnActions - 1,
    turnComputations: 0,
  })
  const run = (f: ReturnType<typeof install>) =>
    f.battle.applyEffects(new TurnContext(f.battle), EffectTrigger.TurnEnd, f.source)
  expect(() => run(first)).toThrow(ExecutionBudgetExceeded)
  expect(first.battle.executionBudget.fault?.dimension).toBe('turnActions')
  expect(calls).toEqual([1])
  expect(() => run(first)).toThrow(first.battle.executionBudget.fault)
  run(other)
  expect(calls).toEqual([1, 1, 2, 99])
  expect(other.battle.executionBudget.fault).toBeUndefined()
})

it('does not let phase error tolerance swallow recursively triggered budget exhaustion', () => {
  const { battle, source } = fixture()
  const effect = defineNativeEffect({
    id: 'test/recursive-capability' as effectId,
    triggers: [EffectTrigger.TurnEnd],
    apply: () => battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source),
  })
  source.effects.push(effect)
  const phase = new EffectPhase(battle, new TurnContext(battle), EffectTrigger.TurnEnd, source, effect)
  battle.phaseManager.registerPhase(phase)
  expect(() => battle.phaseManager.executePhase(phase.id, { skipOnError: true })).toThrow(ExecutionBudgetExceeded)
  expect(battle.executionBudget.fault?.dimension).toBe('depth')
  expect(battle.victor).toBeUndefined()
})

it('charges each saved graph operation before damage and suppresses later actions after exhaustion', () => {
  const registry = createCoreCapabilityRegistry()
  const saved = JSON.stringify({
    definition: {
      formatVersion: 1,
      id: 'test/graph-budget',
      sourceKind: 'skill',
      parameters: {},
      implementation: {
        kind: 'rule',
        rule: {
          formatVersion: 1,
          id: 'test/graph-budget-rule',
          trigger: { nodeId: 'hit', id: 'core.selfSkillHit', params: {} },
          values: [
            { nodeId: 'target', id: 'core.ownerPet', params: {} },
            { nodeId: 'amount', id: 'core.number', params: { value: 1 } },
          ],
          actions: ['one', 'two'].map(stepId => ({
            stepId,
            id: 'core.dealDamage',
            params: {},
            inputs: { target: { node: 'target' }, amount: { node: 'amount' } },
          })),
        },
      },
    },
    use: { useId: 'damage', definitionId: 'test/graph-budget', params: {} },
  })
  let subsequentEffects = 0
  const install = () => {
    const f = fixture()
    const data = JSON.parse(saved)
    const compiled = compileBehaviorUse(data.definition, data.use, {
      registry,
      owner: { kind: 'skill', id: f.source.baseId },
    })
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
    compiled.parameters.install(f.battle.configSystem)
    f.source.effects.push(
      compiled.effect,
      defineNativeEffect({
        id: 'test/after-graph-budget' as effectId,
        triggers: [EffectTrigger.OnHit],
        priority: -1,
        apply: () => subsequentEffects++,
      }),
    )
    return f
  }
  const first = install(),
    other = install()
  const firstHp = first.a.activePet.currentHp,
    otherHp = other.a.activePet.currentHp
  first.battle.executionBudget.restoreState({
    turn: first.battle.currentTurn,
    turnActions: executionBudgetPolicy.turnActions - 1,
    turnComputations: 0,
  })
  const hit = (f: ReturnType<typeof install>) =>
    f.battle.applyEffects(
      new UseSkillContext(new TurnContext(f.battle), f.a, f.a.activePet, AttackTargetOpinion.self, f.source),
      EffectTrigger.OnHit,
      f.source,
    )
  expect(() => hit(first)).toThrow(ExecutionBudgetExceeded)
  expect(first.battle.executionBudget.fault?.dimension).toBe('turnActions')
  expect(first.a.activePet.currentHp).toBe(firstHp - 1)
  expect(subsequentEffects).toBe(0)
  hit(other)
  expect(other.a.activePet.currentHp).toBe(otherHp - 2)
  expect(other.battle.executionBudget.exportState().turnActions).toBe(2)
  expect(other.battle.executionBudget.fault).toBeUndefined()
  expect(subsequentEffects).toBe(1)
})

it('rejects a caught persistent-computation fault before publishing the fallback contribution', () => {
  const { battle, a, source, debuff } = fixture()
  const context = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, source)
  const mark = new BaseMark('test/budget-source' as baseMarkId, [], { ...debuff.config, persistent: true })
  battle.addMark(new AddMarkContext(context, a.activePet, mark))
  const input = new Signal(1)
  let caught: unknown
  const definition = defineValue('test/caught-computation', () =>
    values.reactive(input).map(value => {
      if (value === 2) {
        try {
          for (let i = 0; i <= executionBudgetPolicy.computations; i++) battle.executionBudget.chargeComputation()
        } catch (error) {
          caught = error
        }
        return 999
      }
      return value
    }),
  )
  const handle = installValueModifier({
    definition,
    args: undefined,
    source: a.activePet.marks[0],
    effectId: 'test/persistent-budget',
    bindingKey: 'power',
    target: a.activePet,
    attribute: 'atk',
    operation: 'override',
  })
  expect(handle.value).toBe(1)
  expect(() => input.next(2)).toThrow(ExecutionBudgetExceeded)
  expect(caught).toBe(battle.executionBudget.fault)
  expect(battle.executionBudget.fault?.dimension).toBe('computations')
  expect(a.activePet.stat.atk).toBe(1)
  expect(handle.value).toBe(1)
  expect(() => battle.assertRunning()).toThrow(battle.executionBudget.fault)
  const other = fixture()
  expect(other.battle.executionBudget.fault).toBeUndefined()
  expect(other.a.activePet.stat.atk).toBeGreaterThan(0)
})

it.each(['coreBuildId', 'registryBuildId', 'build', 'capabilities'])(
  'rejects author-supplied %s instead of letting data impersonate trusted capabilities',
  async field => {
    const host = { formatVersion: 1 as const, coreBuildId: 'a'.repeat(64), registryBuildId: 'b'.repeat(64) }
    const pack = { formatVersion: 1, id: 'test' }
    const environment = await lockContentEnvironment([JSON.stringify(pack)], host)
    await expect(
      lockContentEnvironment(
        [JSON.stringify({ ...pack, [field]: field === 'registryBuildId' ? host.registryBuildId : host })],
        host,
        environment.manifest.environmentDigest,
      ),
    ).rejects.toThrow('Invalid environment pack')
    expect(environment.manifest.registryBuildId).toBe(host.registryBuildId)
  },
)
