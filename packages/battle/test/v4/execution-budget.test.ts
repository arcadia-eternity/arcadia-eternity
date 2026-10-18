import { afterEach, beforeAll, expect, it } from 'vitest'
import { Type } from '@sinclair/typebox'
import {
  CapabilityRegistry,
  defineAction,
  defineNativeEffect,
  defineTrigger,
  compileRule,
  BattleMessageType,
  EffectTrigger,
  TurnContext,
  ExecutionBudgetExceeded,
  executionBudgetPolicy,
  setGlobalLogger,
  type Battle,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function setup() {
  const fixture = makeScenario()
  battles.push(fixture.battle)
  return { ...fixture, source: fixture.a.activePet.skills[0] }
}

it('stops recursive triggers at the shared depth limit and permanently faults only that battle', () => {
  const { battle, source } = setup()
  let calls = 0
  source.effects.push(
    defineNativeEffect({
      id: 'recursive' as effectId,
      triggers: [EffectTrigger.TurnEnd],
      apply() {
        calls++
        battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source)
      },
    }),
  )
  expect(() => battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source)).toThrow(
    ExecutionBudgetExceeded,
  )
  expect(calls).toBe(executionBudgetPolicy.depth - 1)
  expect(battle.executionBudget.fault?.dimension).toBe('depth')
  expect(battle.victor).toBeUndefined()
  const log = battle.getActionLog()
  const selection = battle.playerA.selection
  expect(() => battle.setSelection({ type: 'surrender', player: battle.playerA.id })).toThrow(ExecutionBudgetExceeded)
  expect(battle.getActionLog()).toEqual(log)
  expect(battle.playerA.selection).toBe(selection)
  expect(battle.isSnapshotBoundary()).toBe(false)
  const failure = battle.executionBudget.fault
  expect(() => battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd)).toThrow(failure)
  expect(() => battle.assertRunning()).toThrow(failure)
  const other = setup()
  expect(() => other.battle.applyEffects(new TurnContext(other.battle), EffectTrigger.TurnEnd)).not.toThrow()
})

it('counts registered action invocations across nested contexts and stops before the over-limit write', () => {
  const { battle, source } = setup()
  let writes = 0
  const empty = Type.Object({}, { additionalProperties: false })
  const registry = new CapabilityRegistry(
    [
      defineAction({
        id: 'write',
        needs: [],
        params: empty,
        execute() {
          writes++
        },
      }),
    ],
    {
      triggers: [
        defineTrigger({
          id: 'turn',
          trigger: EffectTrigger.TurnEnd,
          params: empty,
          provides: { skill: [] },
          resolve() {
            return {}
          },
        }),
      ],
    },
  )
  const result = compileRule(
    {
      formatVersion: 1,
      id: 'writes',
      trigger: { nodeId: 'trigger', id: 'turn' },
      actions: [{ stepId: 'write', id: 'write' }],
    },
    registry,
    { contentId: 'budget', sourceKind: 'skill' },
  )
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  source.effects.push(result.effect)
  expect(() =>
    battle.executionBudget.run(battle.currentTurn, () => {
      for (let i = 0; i <= executionBudgetPolicy.actions; i++) {
        battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source)
      }
    }),
  ).toThrow(ExecutionBudgetExceeded)
  expect(writes).toBe(executionBudgetPolicy.actions)
  expect(battle.executionBudget.fault?.dimension).toBe('actions')
}, 15000)

it('shares the per-turn limit across roots and does not allow swallowed faults to resume', () => {
  const { battle } = setup()
  let calls = 0
  const invoke = () =>
    battle.executionBudget.action(1, () => {
      calls++
    })
  for (let i = 0; i < executionBudgetPolicy.turnActions; i++) invoke()
  expect(() =>
    battle.executionBudget.run(1, () => {
      try {
        invoke()
      } catch {
        /* Deliberately exercise swallowed errors. */
      }
    }),
  ).toThrow(ExecutionBudgetExceeded)
  expect(calls).toBe(executionBudgetPolicy.turnActions)
  expect(battle.executionBudget.fault?.dimension).toBe('turnActions')
  expect(() =>
    battle.executionBudget.action(2, () => {
      calls++
    }),
  ).toThrow(ExecutionBudgetExceeded)
})

it('resets root counters between roots and turn counters only on a new turn', () => {
  const { battle } = setup()
  for (const turn of [1, 2]) {
    for (let i = 0; i < executionBudgetPolicy.turnActions; i++) {
      battle.executionBudget.action(turn, () => {})
    }
  }
  expect(battle.executionBudget.fault).toBeUndefined()
})

it('retains the root budget through message callback reentry even when the listener catches the fault', () => {
  const { battle, source } = setup()
  let writes = 0
  source.effects.push(
    defineNativeEffect({
      id: 'callback' as effectId,
      triggers: [EffectTrigger.TurnEnd],
      apply() {
        writes++
      },
    }),
  )
  battle.registerListener(message => {
    if (message.type !== BattleMessageType.EffectApply) return
    try {
      battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source)
    } catch {
      /* Deliberately exercise swallowed errors. */
    }
  })
  expect(() => battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source)).toThrow(
    ExecutionBudgetExceeded,
  )
  expect(writes).toBe(0)
  expect(battle.executionBudget.fault?.dimension).toBe('depth')
})

it('releases a live selection wait with the original fault instead of choosing a loser', async () => {
  const { battle } = setup()
  const ready = new Promise<void>(resolve => {
    battle.registerListener(message => {
      if (message.type === BattleMessageType.TurnAction) resolve()
    })
  })
  const running = battle.startBattle().then(
    () => undefined,
    error => error,
  )
  await ready
  expect(() =>
    battle.executionBudget.run(battle.currentTurn, () => {
      for (let i = 0; i <= executionBudgetPolicy.actions; i++) {
        battle.executionBudget.action(battle.currentTurn, () => {})
      }
    }),
  ).toThrow(ExecutionBudgetExceeded)
  expect(await running).toBe(battle.executionBudget.fault)
  expect(battle.victor).toBeUndefined()
})

it('preserves cumulative computation limits across roots and rejects malformed saved counts', () => {
  const { battle } = setup()
  for (let root = 0; root < 10; root++) {
    battle.executionBudget.run(0, () => {
      for (let i = 0; i < executionBudgetPolicy.computations; i++) battle.executionBudget.chargeComputation()
    })
  }
  const state = battle.executionBudget.exportState()
  expect(state.turnComputations).toBe(executionBudgetPolicy.turnComputations)
  const restored = setup().battle.executionBudget
  restored.restoreState(state)
  expect(() => restored.run(0, () => restored.chargeComputation())).toThrow(
    'Execution budget exceeded: turnComputations',
  )
  const invalid = setup().battle.executionBudget
  expect(() => invalid.restoreState({ ...state, turnComputations: -1 })).toThrow('Invalid execution budget state')
  expect(() => invalid.restoreState({ turn: 0, turnActions: 0 })).toThrow('Invalid execution budget state')
})
