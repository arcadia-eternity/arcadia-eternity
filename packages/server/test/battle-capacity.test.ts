import { expect, it } from 'vitest'
import { defaultBattleCapacity, parseBattleCapacityEnv, resolveBattleCapacity } from '../src/standalone/battle-capacity'

it('uses the service defaults and maps explicit dotenv values', () => {
  expect(parseBattleCapacityEnv({})).toEqual({
    maxConcurrentBattles: 32,
    maxIdleWorkers: 4,
    maxQueuedBattles: 64,
    battleQueueTimeoutMs: 5000,
  })
  expect(
    parseBattleCapacityEnv({
      ARCADIA_MAX_CONCURRENT_BATTLES: '8',
      ARCADIA_MAX_IDLE_WORKERS: '0',
      ARCADIA_MAX_QUEUED_BATTLES: '0',
      ARCADIA_BATTLE_QUEUE_TIMEOUT_MS: '2500',
    }),
  ).toEqual({ maxConcurrentBattles: 8, maxIdleWorkers: 0, maxQueuedBattles: 0, battleQueueTimeoutMs: 2500 })
  expect(Object.isFrozen(defaultBattleCapacity)).toBe(true)
})

it.each(['', ' ', '-1', '1.5', '1e3', 'NaN', 'Infinity', '9007199254740992', '2147483648'])(
  'rejects malformed or out-of-range environment capacity %j',
  value => {
    expect(() => parseBattleCapacityEnv({ ARCADIA_MAX_CONCURRENT_BATTLES: value })).toThrow()
  },
)

it('rejects inconsistent capacity before creating service resources', () => {
  expect(() => parseBattleCapacityEnv({ ARCADIA_MAX_CONCURRENT_BATTLES: '2' })).toThrow(/maxIdleWorkers/)
  expect(() => resolveBattleCapacity({ maxConcurrentBattles: 0 })).toThrow(/maxConcurrentBattles/)
  expect(() => resolveBattleCapacity({ battleQueueTimeoutMs: 0 })).toThrow(/battleQueueTimeoutMs/)
  expect(() => resolveBattleCapacity({ maxIdleWorkers: -1 })).toThrow(/maxIdleWorkers/)
  expect(() => resolveBattleCapacity({ maxQueuedBattles: 0.5 })).toThrow(/maxQueuedBattles/)
})
