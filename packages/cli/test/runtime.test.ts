import { beforeAll, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { AttributeSystem, BattleMessageType, executionBudgetPolicy, setGlobalLogger } from '@arcadia-eternity/battle/v4'
import { prepareContent } from '../src/application/prepare'
import { runBattle } from '../src/application/run'
import type { RunSpec } from '../src/application/types'

beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
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

it('releases native resources across completion, truncation, cancellation and another complete battle', async () => {
  const { loaded, spec } = await fixture()
  const baseline = AttributeSystem.getGlobalMemoryStats().totalInstances
  const original = structuredClone(spec)
  const signal = new AbortController().signal
  const first = await runBattle(loaded.content, spec, { signal })
  expect(first.result.status).toBe('completed')
  expect(first.result.players[0].team[0].hp).toEqual(expect.any(Number))
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
  const limited = await runBattle(loaded.content, { ...spec, maxActions: 1 }, { signal })
  expect(limited.result).toMatchObject({ status: 'truncated', winner: null })
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
  const abort = new AbortController()
  abort.abort()
  expect((await runBattle(loaded.content, spec, { signal: abort.signal })).result.status).toBe('cancelled')
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
  const second = await runBattle(loaded.content, spec, { signal })
  expect(second.result).toEqual(first.result)
  expect(spec).toEqual(original)
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
}, 15000)

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
