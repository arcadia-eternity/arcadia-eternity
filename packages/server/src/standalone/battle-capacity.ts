/** Service capacity, independent of the number of warm processes retained between battles. */
export interface BattleCapacityOptions {
  maxConcurrentBattles?: number
  maxIdleWorkers?: number
  maxQueuedBattles?: number
  battleQueueTimeoutMs?: number
}
export const defaultBattleCapacity: Readonly<Required<BattleCapacityOptions>> = Object.freeze({
  maxConcurrentBattles: 32,
  maxIdleWorkers: 4,
  maxQueuedBattles: 64,
  // The client allows 30s; worker initialization can use 20s, leaving 5s for room setup.
  battleQueueTimeoutMs: 5000,
})
export function resolveBattleCapacity(options: BattleCapacityOptions = {}): Required<BattleCapacityOptions> {
  const result = {
    maxConcurrentBattles: options.maxConcurrentBattles ?? defaultBattleCapacity.maxConcurrentBattles,
    maxIdleWorkers: options.maxIdleWorkers ?? defaultBattleCapacity.maxIdleWorkers,
    maxQueuedBattles: options.maxQueuedBattles ?? defaultBattleCapacity.maxQueuedBattles,
    battleQueueTimeoutMs: options.battleQueueTimeoutMs ?? defaultBattleCapacity.battleQueueTimeoutMs,
  }
  for (const [key, value] of Object.entries(result)) {
    const minimum = key === 'maxIdleWorkers' || key === 'maxQueuedBattles' ? 0 : 1
    if (!Number.isSafeInteger(value) || value < minimum || value > 2_147_483_647)
      throw new Error(`${key} must be an integer between ${minimum} and 2147483647`)
  }
  if (result.maxIdleWorkers > result.maxConcurrentBattles)
    throw new Error('maxIdleWorkers cannot exceed maxConcurrentBattles')
  return result
}
/** Read the existing dotenv-loaded environment. Explicit empty or malformed values fail startup. */
export function parseBattleCapacityEnv(env: Record<string, string | undefined>): Required<BattleCapacityOptions> {
  const options: BattleCapacityOptions = {}
  const keys = {
    ARCADIA_MAX_CONCURRENT_BATTLES: 'maxConcurrentBattles',
    ARCADIA_MAX_IDLE_WORKERS: 'maxIdleWorkers',
    ARCADIA_MAX_QUEUED_BATTLES: 'maxQueuedBattles',
    ARCADIA_BATTLE_QUEUE_TIMEOUT_MS: 'battleQueueTimeoutMs',
  } as const
  for (const [key, field] of Object.entries(keys)) {
    const raw = env[key]
    if (raw === undefined) continue
    if (!/^\d+$/.test(raw)) throw new Error(`${key} must be an integer`)
    options[field] = Number(raw)
  }
  return resolveBattleCapacity(options)
}
