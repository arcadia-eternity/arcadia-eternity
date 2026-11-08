import { isIP } from 'node:net'
import type { DurableStorage } from '@arcadia-eternity/database'
import { resolveBattleCapacity, type BattleCapacityOptions } from '../battle-capacity'

/** Durable desired settings. Listener/pool configuration is applied only when constructing a new server. */
export interface ServerSettings {
  host: string
  port: number
  publicOrigin?: string
  corsOrigins: string[]
  battleCapacity: Required<BattleCapacityOptions>
}
export interface ServerSettingsConstraints {
  /** Private desktop IPC hosts must remain loopback-only. */
  desktopLocal?: boolean
  /** Trusted owner renderer origins must remain reachable after applying desired settings. */
  requiredCorsOrigins?: readonly string[]
  /** If G3 is enabled, the next listener must retain the configured callback-origin contract. */
  accountCallbackOrigins?: readonly string[]
}
export class ServerSettingsError extends Error {
  readonly status = 422
  constructor(
    readonly code: string,
    readonly field: string,
  ) {
    super(`${code}: ${field}`)
  }
}
const invalid = (field: string): never => {
  throw new ServerSettingsError('INVALID_SERVER_SETTINGS', field)
}
const record = (input: unknown, field: string): Record<string, unknown> => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid(field)
  return input as Record<string, unknown>
}
const origin = (input: unknown, field: string): string => {
  if (typeof input !== 'string') return invalid(field)
  try {
    const parsed = new URL(input)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== input || parsed.username || parsed.password)
      return invalid(field)
    return input
  } catch {
    return invalid(field)
  }
}
const corsOrigin = (value: unknown, field: string, desktopLocal = false): string => {
  if (value === 'arcadia-client://app' || (value === 'null' && desktopLocal)) return value
  return origin(value, field)
}
const settingsKeys = new Set(['host', 'port', 'publicOrigin', 'corsOrigins', 'battleCapacity'])
const capacityKeys = new Set(['maxConcurrentBattles', 'maxIdleWorkers', 'maxQueuedBattles', 'battleQueueTimeoutMs'])
const hostName = (input: unknown): string => {
  if (typeof input !== 'string' || !input || input.length > 253 || input.trim() !== input) return invalid('host')
  if (isIP(input)) return input
  if (!input.split('.').every(label => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)))
    return invalid('host')
  return input
}

/** Unknown keys fail rather than silently accepting ineffective or secret-bearing settings. */
export function normalizeServerSettings(
  input: Partial<ServerSettings> = {},
  constraints: ServerSettingsConstraints = {},
): ServerSettings {
  const values = record(input, 'settings')
  for (const key of Object.keys(values)) if (!settingsKeys.has(key)) invalid(key)
  for (const [key, value] of Object.entries(values)) if (value === null) invalid(key)
  const host = hostName(values.host ?? '0.0.0.0')
  if (constraints.desktopLocal && host !== '127.0.0.1') invalid('host')
  const port = values.port ?? 8102
  if (typeof port !== 'number' || !Number.isSafeInteger(port) || port < 0 || port > 65535) invalid('port')
  const publicOrigin = values.publicOrigin === undefined ? undefined : origin(values.publicOrigin, 'publicOrigin')
  const rawOrigins = values.corsOrigins ?? ['arcadia-client://app']
  if (!Array.isArray(rawOrigins) || rawOrigins.length > 100) invalid('corsOrigins')
  const corsOrigins = (rawOrigins as unknown[]).map((value, index) =>
    corsOrigin(value, `corsOrigins[${index}]`, constraints.desktopLocal),
  )
  if (new Set(corsOrigins).size !== corsOrigins.length) invalid('corsOrigins')
  if (constraints.requiredCorsOrigins !== undefined) {
    if (!Array.isArray(constraints.requiredCorsOrigins) || constraints.requiredCorsOrigins.length > 100)
      invalid('requiredCorsOrigins')
    const required = constraints.requiredCorsOrigins.map((value, index) =>
      corsOrigin(value, `requiredCorsOrigins[${index}]`, constraints.desktopLocal),
    )
    if (new Set(required).size !== required.length) invalid('requiredCorsOrigins')
    if (required.some(value => !corsOrigins.includes(value))) invalid('corsOrigins')
  }
  if (constraints.accountCallbackOrigins) {
    const callbacks = constraints.accountCallbackOrigins
    const browserOrigins = corsOrigins.filter(value => value !== 'arcadia-client://app')
    if (
      !browserOrigins.length ||
      browserOrigins.length !== callbacks.length ||
      browserOrigins.some(value => !callbacks.includes(value))
    )
      invalid('corsOrigins')
    if (publicOrigin && !callbacks.includes(publicOrigin)) invalid('publicOrigin')
  }
  const capacity = values.battleCapacity === undefined ? {} : record(values.battleCapacity, 'battleCapacity')
  for (const [key, value] of Object.entries(capacity))
    if (!capacityKeys.has(key) || typeof value !== 'number') invalid(`battleCapacity.${key}`)
  let battleCapacity: Required<BattleCapacityOptions>
  try {
    battleCapacity = resolveBattleCapacity(capacity as BattleCapacityOptions)
  } catch {
    return invalid('battleCapacity')
  }
  return {
    host,
    port: port as number,
    ...(publicOrigin === undefined ? {} : { publicOrigin }),
    corsOrigins,
    battleCapacity,
  }
}

export function patchServerSettings(
  current: ServerSettings,
  patch: unknown,
  constraints: ServerSettingsConstraints = {},
): ServerSettings {
  const values = record(patch, 'settings')
  for (const key of Object.keys(values)) if (!settingsKeys.has(key)) invalid(key)
  // JSON null explicitly clears the optional public origin. Other fields cannot be silently reset.
  for (const [key, value] of Object.entries(values)) if (value === null && key !== 'publicOrigin') invalid(key)
  const next: Record<string, unknown> = { ...current, ...values }
  if (values.publicOrigin === null) delete next.publicOrigin
  if (values.battleCapacity !== undefined)
    next.battleCapacity = { ...current.battleCapacity, ...record(values.battleCapacity, 'battleCapacity') }
  return normalizeServerSettings(next as Partial<ServerSettings>, constraints)
}

/** No desired setting is hot-applied: existing listener, room leases and active Workers remain unchanged. */
export function compareServerSettings(desired: ServerSettings, runtime: ServerSettings) {
  const pendingRestart: string[] = []
  for (const key of ['host', 'port', 'publicOrigin'] as const)
    if (desired[key] !== runtime[key]) pendingRestart.push(key)
  if (JSON.stringify([...desired.corsOrigins].sort()) !== JSON.stringify([...runtime.corsOrigins].sort()))
    pendingRestart.push('corsOrigins')
  for (const key of capacityKeys)
    if (
      desired.battleCapacity[key as keyof BattleCapacityOptions] !==
      runtime.battleCapacity[key as keyof BattleCapacityOptions]
    )
      pendingRestart.push(`battleCapacity.${key}`)
  return { requiresRestart: pendingRestart.length > 0, pendingRestart }
}

/** Read before app construction; caller determines precedence of explicit CLI/environment overrides. */
export async function getPersistedServerSettings(
  storage: Pick<DurableStorage, 'get'>,
  serverId: string,
  constraints: ServerSettingsConstraints = {},
): Promise<ServerSettings | undefined> {
  const server = await storage.get<{ settings?: ServerSettings }>('servers', serverId)
  if (!server?.value.settings) return undefined
  return normalizeServerSettings(server.value.settings, constraints)
}
