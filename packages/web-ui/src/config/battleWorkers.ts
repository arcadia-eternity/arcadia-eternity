import { browserSandboxStartup, type BattleWorkerPolicy } from '@arcadia-eternity/battle/sandbox'

type BattleWorkerEnv = Partial<
  Pick<
    ImportMetaEnv,
    'VITE_MAX_CONCURRENT_BATTLES' | 'VITE_MAX_IDLE_WORKERS' | 'VITE_MAX_QUEUED_BATTLES' | 'VITE_BATTLE_QUEUE_TIMEOUT_MS'
  >
>

/** Vite substitutes these deployment settings at build time. */
export function parseBattleWorkerPolicy(env: BattleWorkerEnv): Partial<BattleWorkerPolicy> {
  const integer = (key: keyof BattleWorkerEnv, fallback: number, minimum: number) => {
    const raw = env[key]
    if (raw === undefined) return fallback
    const value = Number(raw)
    if (!/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(value) || value < minimum)
      throw new Error(`${key} must be an integer >= ${minimum}`)
    return value
  }
  const maxBattles = integer('VITE_MAX_CONCURRENT_BATTLES', 4, 1)
  const maxIdleWorkers = integer('VITE_MAX_IDLE_WORKERS', 1, 0)
  if (maxIdleWorkers > maxBattles) throw new Error('VITE_MAX_IDLE_WORKERS must not exceed VITE_MAX_CONCURRENT_BATTLES')
  const queueTimeoutMs = integer('VITE_BATTLE_QUEUE_TIMEOUT_MS', 30_000, 1)
  if (queueTimeoutMs > 2_147_483_647) throw new Error('VITE_BATTLE_QUEUE_TIMEOUT_MS must not exceed 2147483647')
  return {
    maxBattles,
    maxIdleWorkers,
    maxQueuedBattles: integer('VITE_MAX_QUEUED_BATTLES', 4, 0),
    queueTimeoutMs,
    initializeMs: browserSandboxStartup.initializeMs,
    reuseWorkers: true,
    vmGrouping: 'package',
  }
}
