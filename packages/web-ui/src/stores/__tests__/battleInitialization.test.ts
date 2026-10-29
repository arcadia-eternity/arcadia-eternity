import { beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { BattleState, PlayerSelection } from '@arcadia-eternity/const'
import type { IBattleSystem } from '@arcadia-eternity/interface'
import { useBattleStore } from '../battle'

beforeEach(() => setActivePinia(createPinia()))
const state = (sequenceId: number) => ({ status: 'On', sequenceId, players: [] }) as unknown as BattleState
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
function system(snapshot = state(2)) {
  return {
    getState: vi.fn(async () => snapshot),
    getAvailableSelection: vi.fn(async () => [] as PlayerSelection[]),
    BattleEvent: vi.fn(() => vi.fn()),
    cleanup: vi.fn(async () => {}),
  } as unknown as IBattleSystem
}

it('a late snapshot cannot restore a reset battle or overwrite a newer battle', async () => {
  const store = useBattleStore()
  const pending = deferred<BattleState>()
  const old = system()
  vi.mocked(old.getState).mockReturnValue(pending.promise)
  const initializing = store.initBattle(old, 'old')
  await store.resetBattleWithoutSurrender()
  const fresh = system()
  await store.initBattle(fresh, 'new')
  pending.resolve(state(1))
  await initializing
  expect(store.battleInterface).toBe(fresh)
  expect(store.playerId).toBe('new')
  expect(store.battleState?.sequenceId).toBe(2)
  expect(old.BattleEvent).not.toHaveBeenCalled()
})

it('a late action response cannot overwrite a newer initialization', async () => {
  const store = useBattleStore()
  const pending = deferred<PlayerSelection[]>()
  const old = system(state(1))
  vi.mocked(old.getAvailableSelection).mockReturnValue(pending.promise)
  const initializing = store.initBattle(old, 'old')
  await vi.waitFor(() => expect(old.getAvailableSelection).toHaveBeenCalled())
  await store.initBattleWithState(system(), 'new', state(2))
  pending.resolve([{ type: 'surrender', player: 'old' }] as PlayerSelection[])
  await initializing
  expect(store.availableActions).toEqual([])
  expect(store.battleState?.sequenceId).toBe(2)
})

it('a late cleanup cannot clear a new battle', async () => {
  const store = useBattleStore()
  const pending = deferred<void>()
  const old = system()
  await store.initBattle(old, 'old')
  vi.mocked(old.cleanup).mockReturnValue(pending.promise)
  const cleaning = store.resetBattleWithoutSurrender()
  const fresh = system()
  await store.initBattle(fresh, 'new')
  pending.resolve()
  await cleaning
  expect(store.battleInterface).toBe(fresh)
  expect(store.playerId).toBe('new')
})

it('a rejected action from a disposed battle cannot read or alter the next battle', async () => {
  const store = useBattleStore()
  let reject!: (reason: Error) => void
  const pending = new Promise<void>((_, fail) => {
    reject = fail
  })
  const old = system()
  old.submitAction = vi.fn(() => pending)
  await store.initBattle(old, 'old')
  const action = store.sendplayerSelection({ type: 'surrender', player: 'old' } as PlayerSelection)
  await store.resetBattleWithoutSurrender()
  const fresh = system()
  await store.initBattle(fresh, 'new')
  store.waitingForResponse = true
  store.errorMessage = 'new battle message'
  const calls = vi.mocked(old.getAvailableSelection).mock.calls.length
  reject(new Error('Native battle system is disposed'))
  await action
  expect(old.getAvailableSelection).toHaveBeenCalledTimes(calls)
  expect(store.battleInterface).toBe(fresh)
  expect(store.waitingForResponse).toBe(true)
  expect(store.errorMessage).toBe('new battle message')
})

it('a reconnect snapshot action rejection cannot mutate a battle after its room scope is cancelled', async () => {
  const store = useBattleStore(),
    old = system()
  let reject!: (error: Error) => void
  vi.mocked(old.getAvailableSelection).mockReturnValue(
    new Promise((_resolve, fail) => {
      reject = fail
    }),
  )
  let current = true
  const restoring = store.initBattleWithState(old, 'old', state(1), () => current)
  await vi.waitFor(() => expect(old.getAvailableSelection).toHaveBeenCalledOnce())
  current = false
  store.waitingForResponse = true
  store.errorMessage = 'current scope message'
  reject(new Error('NOT_IN_BATTLE'))
  await restoring
  expect(store.isBattleEnd).toBe(false)
  expect(store.waitingForResponse).toBe(true)
  expect(store.errorMessage).toBe('current scope message')
})
