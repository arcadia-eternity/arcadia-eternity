import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { openStorage } from '../../database/src/storage'
import {
  compareServerSettings,
  getPersistedServerSettings,
  normalizeServerSettings,
  patchServerSettings,
} from '../src/standalone/management/settings'

it('preserves the running settings while validating and recording a desired partial update', () => {
  const runtime = normalizeServerSettings({ host: '127.0.0.1', port: 8102 })
  const before = structuredClone(runtime)
  const desired = patchServerSettings(runtime, {
    publicOrigin: 'https://play.example.test',
    corsOrigins: ['arcadia-client://app', 'https://play.example.test'],
    battleCapacity: { maxConcurrentBattles: 8, maxIdleWorkers: 2 },
  })
  expect(runtime).toEqual(before)
  expect(desired.battleCapacity).toEqual({
    maxConcurrentBattles: 8,
    maxIdleWorkers: 2,
    maxQueuedBattles: 64,
    battleQueueTimeoutMs: 5000,
  })
  expect(compareServerSettings(desired, runtime)).toEqual({
    requiresRestart: true,
    pendingRestart: [
      'publicOrigin',
      'corsOrigins',
      'battleCapacity.maxConcurrentBattles',
      'battleCapacity.maxIdleWorkers',
    ],
  })
  expect(compareServerSettings(desired, structuredClone(desired))).toEqual({
    requiresRestart: false,
    pendingRestart: [],
  })
})

it.each([
  { host: 'https://host.test/path' },
  { host: '127.0.0.1 --listen=public' },
  { host: null },
  { port: '8102' },
  { port: 65536 },
  { port: -1 },
  { publicOrigin: 'https://user:secret@play.test' },
  { publicOrigin: 'https://play.test/path' },
  { publicOrigin: 'https://play.test/' },
  { corsOrigins: ['*'] },
  { corsOrigins: ['null'] },
  { corsOrigins: ['https://play.test', 'https://play.test'] },
  { corsOrigins: null },
  { databaseUrl: 'postgres://secret' },
  { isAdmin: true },
  { battleCapacity: { maxIdleWorkers: 33 } },
  { battleCapacity: { maxConcurrentBattles: 0 } },
  { battleCapacity: { maxConcurrentBattles: null } },
  { battleCapacity: { maxQueuedBattles: -1 } },
  { battleCapacity: { battleQueueTimeoutMs: Infinity } },
  { battleCapacity: { unknown: 1 } },
])('rejects malformed, secret-bearing or unsupported desired configuration %j', patch => {
  expect(() => patchServerSettings(normalizeServerSettings(), patch)).toThrow('INVALID_SERVER_SETTINGS')
})

it('accepts explicit origin removal, capacity zero limits, IPv6, and exact-origin order independence', () => {
  const runtime = normalizeServerSettings({
    host: '::1',
    port: 0,
    publicOrigin: 'https://play.test',
    corsOrigins: ['https://play.test', 'arcadia-client://app'],
  })
  const reordered = patchServerSettings(runtime, { corsOrigins: ['arcadia-client://app', 'https://play.test'] })
  expect(compareServerSettings(runtime, reordered).requiresRestart).toBe(false)
  const desired = patchServerSettings(runtime, {
    publicOrigin: null,
    battleCapacity: { maxIdleWorkers: 0, maxQueuedBattles: 0 },
  })
  expect(desired.publicOrigin).toBeUndefined()
  expect(compareServerSettings(desired, runtime).pendingRestart).toEqual([
    'publicOrigin',
    'battleCapacity.maxIdleWorkers',
    'battleCapacity.maxQueuedBattles',
  ])
})

it('keeps private desktop listeners and account callback-origin invariants valid at save time', () => {
  const desktop = normalizeServerSettings({ host: '127.0.0.1', corsOrigins: ['null'] }, { desktopLocal: true })
  expect(() => patchServerSettings(desktop, { host: '0.0.0.0' }, { desktopLocal: true })).toThrow('host')
  const account = normalizeServerSettings(
    { corsOrigins: ['https://play.test', 'arcadia-client://app'] },
    {
      accountCallbackOrigins: ['https://play.test'],
    },
  )
  expect(() =>
    patchServerSettings(account, { corsOrigins: [] }, { accountCallbackOrigins: ['https://play.test'] }),
  ).toThrow('corsOrigins')
  expect(() =>
    patchServerSettings(
      account,
      { publicOrigin: 'https://other.test' },
      { accountCallbackOrigins: ['https://play.test'] },
    ),
  ).toThrow('publicOrigin')
})

it('loads persisted desired settings on a fresh connection without changing server identity or name', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-settings-'))
  const filename = join(directory, 'settings.sqlite')
  let storage = openStorage({ driver: 'sqlite', filename })
  try {
    await storage.migrate()
    expect(await getPersistedServerSettings(storage, 'existing')).toBeUndefined()
    const settings = normalizeServerSettings({ host: '127.0.0.1', port: 8103 })
    await storage.create('servers', {
      id: 'existing',
      scope: 'server:existing',
      value: { name: 'My server', settings },
    })
    await storage.close()
    storage = openStorage({ driver: 'sqlite', filename })
    await storage.checkSchema()
    expect(await getPersistedServerSettings(storage, 'existing')).toEqual(settings)
    expect(await storage.get('servers', 'existing')).toMatchObject({ id: 'existing', value: { name: 'My server' } })
  } finally {
    await storage.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('requires the trusted owner renderer origin without silently repairing a rejected desired update', () => {
  const ownerOrigin = 'http://127.0.0.1:5173'
  const constraints = { requiredCorsOrigins: [ownerOrigin] }
  const runtime = normalizeServerSettings({ corsOrigins: [ownerOrigin, 'arcadia-client://app'] }, constraints)
  const original = structuredClone(runtime)
  expect(() => patchServerSettings(runtime, { corsOrigins: ['arcadia-client://app'] }, constraints)).toThrow(
    'INVALID_SERVER_SETTINGS: corsOrigins',
  )
  expect(runtime).toEqual(original)
  const desired = patchServerSettings(runtime, { corsOrigins: ['arcadia-client://app', ownerOrigin] }, constraints)
  expect(compareServerSettings(desired, runtime)).toEqual({ requiresRestart: false, pendingRestart: [] })
})

it('combines required renderer origins with the existing account callback and desktop origin rules', () => {
  const constraints = {
    requiredCorsOrigins: ['arcadia-client://app'],
    accountCallbackOrigins: ['https://play.test'],
  }
  const current = normalizeServerSettings({ corsOrigins: ['arcadia-client://app', 'https://play.test'] }, constraints)
  expect(() => patchServerSettings(current, { corsOrigins: ['https://play.test'] }, constraints)).toThrow('corsOrigins')
  expect(() => patchServerSettings(current, { corsOrigins: ['arcadia-client://app'] }, constraints)).toThrow(
    'corsOrigins',
  )
  expect(
    normalizeServerSettings(
      { host: '127.0.0.1', corsOrigins: ['null'] },
      {
        desktopLocal: true,
        requiredCorsOrigins: ['null'],
      },
    ).corsOrigins,
  ).toEqual(['null'])
})

it.each([
  '*',
  'https://play.test/path',
  'https://user:secret@play.test',
  'file://app',
  'null',
  'arcadia-client://other',
])('rejects invalid required renderer origin %s', required => {
  expect(() => normalizeServerSettings({}, { requiredCorsOrigins: [required] })).toThrow('requiredCorsOrigins')
})
