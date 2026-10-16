import { afterEach, beforeAll, expect, it } from 'vitest'
import Prando from 'prando'
import { AIPlayer, BattlePhase, BattleStatus, setGlobalLogger, type Battle } from '@arcadia-eternity/battle/v4'
import { makeScenario, runScenario } from './scenario'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
it('preserves the original Prando sequence and accepts seed zero', () => {
  for (const seed of [0, 201, -12]) {
    const fixture = makeScenario(seed)
    battles.push(fixture.battle)
    const reference = new Prando(seed)
    expect(Array.from({ length: 8 }, () => fixture.battle.random())).toEqual(
      Array.from({ length: 8 }, () => reference.next()),
    )
  }
})
it('injects one RNG for draws, shuffle and actual AI decision selection', () => {
  const calls: [number, number][] = []
  const rng = {
    next: () => 0.25,
    nextInt: (min: number, max: number) => {
      calls.push([min, max])
      return min
    },
  }
  const { battle, a } = makeScenario(201, rng, true)
  battles.push(battle)
  expect(battle.random()).toBe(0.25)
  expect(battle.randomInt(2, 4)).toBe(2)
  const input = [1, 2, 3]
  expect(battle.shuffle(input)).toEqual([2, 3, 1])
  expect(input).toEqual([1, 2, 3])
  battle.status = BattleStatus.OnBattle
  battle.currentPhase = BattlePhase.SelectionPhase
  if (!(a instanceof AIPlayer)) throw new Error('Missing real AIPlayer')
  expect(a.makeAIDecision().type).toBe('use-skill')
  expect(calls).toEqual([
    [2, 4],
    [0, 2],
    [0, 1],
    [0, 0],
  ])
})
it('records accepted Battle.setSelection input with defensive copies', () => {
  const { battle, a } = makeScenario()
  battles.push(battle)
  battle.status = BattleStatus.OnBattle
  battle.currentPhase = BattlePhase.SelectionPhase
  const selection = battle.getAvailableSelection(a.id).find(s => s.type === 'use-skill')!
  expect(battle.setSelection(selection)).toBe(true)
  const log = battle.getActionLog()
  expect(log).toEqual([{ sequence: 0, turn: 0, phase: BattlePhase.SelectionPhase, selection }])
  log[0].selection.player = battle.playerB.id
  expect(battle.getActionLog()[0].selection.player).toBe(a.id)
  battle.currentPhase = BattlePhase.ExecutionPhase
  expect(battle.setSelection(selection)).toBe(false)
  expect(battle.getActionLog()).toHaveLength(1)
})
it('repeats the complete actual V1 battle with the same seed after normalizing instance metadata', async () => {
  expect(await runScenario(201)).toEqual(await runScenario(201))
})
