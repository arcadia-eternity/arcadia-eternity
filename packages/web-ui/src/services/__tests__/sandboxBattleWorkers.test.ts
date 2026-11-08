import { afterEach, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({ dispose: vi.fn(async () => {}), manager: vi.fn() }))
vi.mock('@arcadia-eternity/battle/sandbox', () => ({
  BattleWorkerManager: class {
    dispose = mocked.dispose
    constructor(...args: unknown[]) {
      mocked.manager(...args)
    }
  },
}))
vi.mock('@arcadia-eternity/battle/sandbox/worker?worker', () => ({ default: vi.fn() }))

afterEach(() => vi.unstubAllEnvs())

it('shares the configured browser pool and disposes it on page exit', async () => {
  for (const key of [
    'VITE_MAX_CONCURRENT_BATTLES',
    'VITE_MAX_IDLE_WORKERS',
    'VITE_MAX_QUEUED_BATTLES',
    'VITE_BATTLE_QUEUE_TIMEOUT_MS',
  ])
    vi.stubEnv(key, undefined)
  const { getBattleWorkers } = await import('../sandboxBattleWorkers')
  const first = getBattleWorkers()
  expect(getBattleWorkers()).toBe(first)
  expect(mocked.manager).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
    maxBattles: 4,
    maxIdleWorkers: 1,
    maxQueuedBattles: 4,
    queueTimeoutMs: 30_000,
    reuseWorkers: true,
    vmGrouping: 'package',
  })
  window.dispatchEvent(new Event('pagehide'))
  expect(mocked.dispose).toHaveBeenCalledOnce()
  expect(getBattleWorkers()).not.toBe(first)
})
