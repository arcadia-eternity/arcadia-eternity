import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  defineNativeEffect,
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
import {
  actions,
  codeEffectDefinition,
  compileEffect,
  defineCodeEffect,
  ops,
  targets,
} from '@arcadia-eternity/battle/v4/authoring'
import { compileBehaviorUse } from '@arcadia-eternity/battle/v4'

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

it('meters native SDK recursion through the same dispatcher and preserves the original failure', () => {
  const { battle, source } = setup()
  const native = defineCodeEffect({
    id: 'sdk:recursive',
    sourceKind: 'skill',
    triggers: [EffectTrigger.TurnEnd],
    apply(context) {
      try {
        context.battle.applyEffects(context.parent, EffectTrigger.TurnEnd, context.source)
      } catch {
        /* A callback cannot clear a latched engine fault. */
      }
    },
  })
  const compiled = compileBehaviorUse(
    codeEffectDefinition(native),
    { useId: 'recursive', definitionId: native.id },
    {
      owner: { kind: 'skill', id: source.baseId },
      nativeExports: [native],
    },
  )
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  compiled.parameters.install(battle.configSystem)
  source.effects.splice(0, source.effects.length, compiled.effect)
  expect(() => battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source)).toThrow(
    ExecutionBudgetExceeded,
  )
  const fault = battle.executionBudget.fault
  expect(fault?.dimension).toBe('depth')
  expect(() => battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source)).toThrow(fault)
})

it.each(['selector', 'sequence', 'branch'] as const)(
  'charges %s actions inside a custom callback and blocks subsequent actions after exhaustion',
  mode => {
    const { battle, source, a } = setup()
    let writes = 0,
      after = 0
    const action =
      mode === 'selector'
        ? targets.ownerPet.apply(() => {
            writes++
          })
        : mode === 'sequence'
          ? actions.sequence(() => {
              writes++
            })
          : actions.choose(
              () => true,
              () => {
                writes++
              },
            )
    const effect = compileEffect({
      id: 'sdk:budget-actions',
      triggers: [EffectTrigger.TurnEnd],
      apply(frame) {
        try {
          for (let i = 0; i <= executionBudgetPolicy.actions; i++) action(frame)
        } catch {
          expect(() => targets.ownerPet.property('currentHp').apply(ops.assign(1))(frame)).toThrow(
            battle.executionBudget.fault,
          )
        }
      },
    })
    const later = defineNativeEffect({
      id: 'later' as effectId,
      triggers: [EffectTrigger.TurnEnd],
      apply() {
        after++
      },
    })
    source.effects.splice(0, source.effects.length, effect, later)
    const hp = a.activePet.currentHp
    expect(() => battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source)).toThrow(
      ExecutionBudgetExceeded,
    )
    expect(battle.executionBudget.fault?.dimension).toBe('actions')
    expect(writes).toBe(executionBudgetPolicy.actions - 1)
    expect(after).toBe(0)
    expect(a.activePet.currentHp).toBe(hp)
  },
)
