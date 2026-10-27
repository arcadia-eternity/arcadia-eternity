import { expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { BattleState, PlayerSelection } from '@arcadia-eternity/const'
import type { BattleRuntimeSnapshot } from '@arcadia-eternity/interface'
import type { ContentCatalog } from '@arcadia-eternity/battle/v4'
import type { RunSpec } from '../src/application/types'
import { runBattle } from '../src/application/run'

const driver = vi.hoisted(() => ({ abort: () => {}, cleanup: vi.fn() }))
vi.mock('../src/application/initial', () => ({ initialFingerprint: () => ({ boundary: 'initial' }) }))
vi.mock('@arcadia-eternity/battle/v4/host', () => ({
  // Exercise CLI cancellation at the host boundary without executing a battle.
  LocalBattleSystemV4: class {
    private accepted?: (input: { selection: PlayerSelection; turn: number; phase: string }) => void
    private finish = () => {}
    constructor(private readonly battle: { getState(): BattleState }) {}
    BattleEvent() {
      return () => {}
    }
    onInputAccepted(callback: typeof this.accepted) {
      this.accepted = callback
      return () => {}
    }
    async getState() {
      return this.battle.getState()
    }
    async createRuntimeSnapshot() {
      return {}
    }
    async restoreRuntimeSnapshot() {}
    async ready() {}
    waitForCompletion() {
      return new Promise<void>(resolve => {
        this.finish = resolve
      })
    }
    async waitForPendingDecision() {
      return {
        turn: 1,
        phase: 'SELECTION_PHASE',
        selections: [[{ player: this.battle.getState().players[0].id, type: 'do-nothing' }], []],
      }
    }
    async submitAction(selection: PlayerSelection) {
      this.accepted?.({ selection, turn: 1, phase: 'SELECTION_PHASE' })
      driver.abort()
    }
    async cleanup() {
      driver.cleanup()
      this.finish()
    }
  },
}))

it('returns a cancelled replay and cleans up when interrupted with recorded inputs remaining', async () => {
  const controller = new AbortController()
  driver.abort = () => controller.abort()
  driver.cleanup.mockClear()
  const fixture = JSON.parse(
    readFileSync(new URL('../../battle/test/fixtures/official-switch.input.json', import.meta.url), 'utf8'),
  )
  const spec: RunSpec = { teams: fixture.teams, seed: 'cancel', maxTurns: 10, maxActions: 20, teamSelection: false }
  const state = {
    currentTurn: 1,
    players: ['a', 'b'].map(id => ({ id, rage: 0, activePet: '', team: [] })),
  } as unknown as BattleState
  const content = {
    parsePlayers: () => [],
    createBattle: () => ({ getState: () => state }),
  } as unknown as ContentCatalog
  const input = { turn: 1, phase: 'SELECTION_PHASE', seat: 0, type: 'do-nothing' as const }
  const run = await runBattle(content, spec, {
    signal: controller.signal,
    replay: { initial: {} as BattleRuntimeSnapshot, inputs: [input, input] },
  })
  expect(run.result).toMatchObject({ status: 'cancelled', reason: 'INTERRUPTED', winner: null, actions: 1 })
  expect(run.inputs).toEqual([input])
  expect(driver.cleanup).toHaveBeenCalledOnce()
})
