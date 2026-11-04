import { expect, it } from 'vitest'
import { parseBattleWorkerPolicy } from '../battleWorkers'

it('defaults to four concurrent battles and one retained browser Worker', () => {
  expect(parseBattleWorkerPolicy({})).toEqual({
    maxBattles: 4,
    maxIdleWorkers: 1,
    maxQueuedBattles: 4,
    queueTimeoutMs: 30_000,
    reuseWorkers: true,
    vmGrouping: 'package',
  })
})

it('accepts deployment overrides, including disabling retention and queueing', () => {
  expect(
    parseBattleWorkerPolicy({
      VITE_MAX_CONCURRENT_BATTLES: '2',
      VITE_MAX_IDLE_WORKERS: '0',
      VITE_MAX_QUEUED_BATTLES: '0',
      VITE_BATTLE_QUEUE_TIMEOUT_MS: '5000',
    }),
  ).toMatchObject({ maxBattles: 2, maxIdleWorkers: 0, maxQueuedBattles: 0, queueTimeoutMs: 5000 })
})

it.each(['', ' ', '1.5', '-1', '4x', '1e2', '0x10', '+1', ' 2 ', '9007199254740992'])(
  'rejects invalid integer setting %j',
  value => {
    for (const key of [
      'VITE_MAX_CONCURRENT_BATTLES',
      'VITE_MAX_IDLE_WORKERS',
      'VITE_MAX_QUEUED_BATTLES',
      'VITE_BATTLE_QUEUE_TIMEOUT_MS',
    ])
      expect(() => parseBattleWorkerPolicy({ [key]: value })).toThrow(key)
  },
)

it('rejects zero concurrency, zero timeout, and retention exceeding capacity', () => {
  expect(() => parseBattleWorkerPolicy({ VITE_MAX_CONCURRENT_BATTLES: '0' })).toThrow('VITE_MAX_CONCURRENT_BATTLES')
  expect(() => parseBattleWorkerPolicy({ VITE_BATTLE_QUEUE_TIMEOUT_MS: '0' })).toThrow('VITE_BATTLE_QUEUE_TIMEOUT_MS')
  expect(() => parseBattleWorkerPolicy({ VITE_MAX_CONCURRENT_BATTLES: '2', VITE_MAX_IDLE_WORKERS: '3' })).toThrow(
    'VITE_MAX_IDLE_WORKERS',
  )
})

it('accepts the largest browser timer delay and rejects values that would overflow', () => {
  expect(parseBattleWorkerPolicy({ VITE_BATTLE_QUEUE_TIMEOUT_MS: '2147483647' }).queueTimeoutMs).toBe(2_147_483_647)
  expect(() => parseBattleWorkerPolicy({ VITE_BATTLE_QUEUE_TIMEOUT_MS: '2147483648' })).toThrow(
    'VITE_BATTLE_QUEUE_TIMEOUT_MS',
  )
})
