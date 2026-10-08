import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { BattleMessageType, type BattleMessage, type PlayerSelection } from '@arcadia-eternity/const'
import type { IBattleSystem } from '@arcadia-eternity/interface'
import { useBattleStore } from '../battle'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

it('cancelled TurnAction fetch cannot overwrite actions from a newer snapshot', async () => {
  const store = useBattleStore()
  store.playerId = 'p'
  let current = true
  let finish!: (value: PlayerSelection[]) => void
  vi.spyOn(store, 'fetchAvailableSelection').mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve
      }),
  )
  const message = { type: BattleMessageType.TurnAction, sequenceId: 1, data: { player: ['p'] } } as BattleMessage
  const applying = store.applyStateDelta(message, () => current)
  current = false
  const fresh = [{ type: 'do-nothing' }] as PlayerSelection[]
  store.availableActions = fresh
  finish([])
  await applying
  expect(store.availableActions).toEqual(fresh)
  expect(store.lastProcessedSequenceId).toBe(1)
  expect(store.log).toHaveLength(1)
})
it('obsolete unavailable-battle error cannot end the current battle', async () => {
  const store = useBattleStore()
  let fail!: (error: Error) => void
  store.battleInterface = {
    getAvailableSelection: () =>
      new Promise((_resolve, reject) => {
        fail = reject
      }),
  } as unknown as IBattleSystem
  let current = true
  const fetching = store.fetchAvailableSelection(() => current)
  current = false
  fail(new Error('BATTLE_ALREADY_ENDED'))
  expect(await fetching).toEqual([])
  expect(store.isBattleEnd).toBe(false)
  expect(store.errorMessage).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})
it('current unavailable-battle error still performs the normal end handling', async () => {
  const store = useBattleStore()
  store.battleInterface = {
    getAvailableSelection: async () => {
      throw new Error('BATTLE_ALREADY_ENDED')
    },
  } as unknown as IBattleSystem
  expect(await store.fetchAvailableSelection()).toEqual([])
  expect(store.isBattleEnd).toBe(true)
  expect(store.errorMessage).toBe('战斗已结束')
  expect(vi.getTimerCount()).toBe(0)
})
