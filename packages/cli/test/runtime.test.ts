import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { Worker } from 'node:worker_threads'
import { BattleWorkerManager } from '@arcadia-eternity/battle/v4/sandbox/node'
import { readFile } from 'node:fs/promises'
import { AttributeSystem, BattleMessageType, executionBudgetPolicy, setGlobalLogger } from '@arcadia-eternity/battle/v4'
import { prepareContent } from '../src/application/prepare'
import { runBattle } from '../src/application/run'
import type { RunSpec } from '../src/application/types'

beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(() => vi.restoreAllMocks())
async function fixture() {
  const loaded = await prepareContent('builtin:base', process.cwd())
  const replay = JSON.parse(
    await readFile(new URL('../../battle/test/fixtures/official-switch.input.json', import.meta.url), 'utf8'),
  )
  for (const team of replay.teams)
    for (const pet of team.team) {
      pet.skills = ['skill_paida']
      pet.maxHp = 25
    }
  const spec: RunSpec = {
    teams: replay.teams,
    seed: 'runtime-test',
    maxTurns: 20,
    maxActions: 100,
    teamSelection: true,
  }
  return { loaded, spec }
}

it('uses dedicated Workers and releases resources across completion, truncation and cancellation', async () => {
  const terminate = vi.spyOn(Worker.prototype, 'terminate')
  const { loaded, spec } = await fixture()
  const baseline = AttributeSystem.getGlobalMemoryStats().totalInstances
  const original = structuredClone(spec)
  const signal = new AbortController().signal
  const first = await runBattle(loaded.content, spec, { signal })
  expect(first.result.status).toBe('completed')
  expect(terminate).toHaveBeenCalledTimes(1)
  expect(first.result.players[0].team[0].hp).toEqual(expect.any(Number))
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
  const limited = await runBattle(loaded.content, { ...spec, maxActions: 1 }, { signal })
  expect(limited.result).toMatchObject({ status: 'truncated', winner: null })
  expect(terminate).toHaveBeenCalledTimes(2)
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
  const abort = new AbortController()
  abort.abort()
  expect((await runBattle(loaded.content, spec, { signal: abort.signal })).result.status).toBe('cancelled')
  expect(terminate).toHaveBeenCalledTimes(2)
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
  const second = await runBattle(loaded.content, spec, { signal })
  expect(second.result).toEqual(first.result)
  expect(terminate).toHaveBeenCalledTimes(3)
  expect(spec).toEqual(original)
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
  const preparing = new AbortController()
  const preparation = runBattle(loaded.content, spec, { signal: preparing.signal })
  const interrupt = setTimeout(() => preparing.abort(), 10)
  try {
    expect((await preparation).result).toMatchObject({
      status: 'cancelled',
      actions: 0,
      turns: 0,
      winner: null,
      players: [],
    })
    expect(terminate).toHaveBeenCalledTimes(4)
  } finally {
    clearTimeout(interrupt)
  }
}, 60000)

it.each(['ready', 'submitAction', 'createRuntimeSnapshot'] as const)(
  'reports cancellation and releases the Worker when %s RPC is pending',
  async operation => {
    const { loaded, spec } = await fixture()
    const controller = new AbortController()
    const terminate = vi.spyOn(Worker.prototype, 'terminate')
    const create = BattleWorkerManager.prototype.create
    function interrupt<Args extends unknown[], Result>(request: (...args: Args) => Result) {
      return (...args: Args): Result => {
        const pending = request(...args)
        controller.abort()
        return pending
      }
    }
    vi.spyOn(BattleWorkerManager.prototype, 'create').mockImplementation(async function (
      this: BattleWorkerManager,
      ...args
    ) {
      const runtime = await create.apply(this, args)
      const ready = runtime.ready.bind(runtime)
      const submit = runtime.submitAction.bind(runtime)
      const snapshot = runtime.createRuntimeSnapshot.bind(runtime)
      if (operation === 'ready') vi.spyOn(runtime, 'ready').mockImplementation(interrupt(ready))
      else if (operation === 'submitAction') vi.spyOn(runtime, 'submitAction').mockImplementation(interrupt(submit))
      else vi.spyOn(runtime, 'createRuntimeSnapshot').mockImplementation(interrupt(snapshot))
      return runtime
    })
    const run = await runBattle(loaded.content, spec, {
      signal: controller.signal,
      captureReplay: operation === 'createRuntimeSnapshot',
    })
    expect(controller.signal.aborted).toBe(true)
    expect(run.result).toMatchObject({ status: 'cancelled', reason: 'INTERRUPTED', winner: null })
    expect(run.result.error).toBeUndefined()
    expect(terminate).toHaveBeenCalledOnce()
  },
  30000,
)

it('reports a native execution-budget fault as failed without a winner and still cleans up', async () => {
  const { loaded, spec } = await fixture()
  const baseline = AttributeSystem.getGlobalMemoryStats().totalInstances
  // A trusted host fixture consumes the real kernel budget at the first native selection event.
  const content = {
    ...loaded.content,
    createBattle(...args: Parameters<typeof loaded.content.createBattle>) {
      const battle = loaded.content.createBattle(...args)
      battle.registerListener(event => {
        if (event.type === BattleMessageType.TurnAction)
          battle.executionBudget.run(battle.currentTurn, () => {
            for (let i = 0; i <= executionBudgetPolicy.computations; i++) battle.executionBudget.chargeComputation()
          })
      })
      return battle
    },
  }
  const run = await runBattle(content, spec, { signal: new AbortController().signal })
  expect(run.result).toMatchObject({
    status: 'failed',
    reason: 'KERNEL_BUDGET',
    winner: null,
    error: { code: 'KERNEL_BUDGET' },
  })
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
})
