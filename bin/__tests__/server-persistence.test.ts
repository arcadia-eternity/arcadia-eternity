import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { ensureAccountSchema, PgAccountDirectory, SQLAccountDirectory } from '@arcadia-eternity/database'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openServerStorage, readServerStorageStatus, workspaceRetentions } from '../server-persistence'
import { dropTestDatabase } from './helpers/postgres'

// Resolve the raw fixture driver through its owning workspace package; production CLI uses DurableStorage.
const Sqlite = createRequire(new URL('../../packages/database/package.json', import.meta.url))(
  'better-sqlite3',
) as new (
  filename: string,
  options?: { readonly?: boolean },
) => {
  exec(sql: string): void
  close(): void
  pragma(sql: string, options?: { simple?: boolean }): unknown
  prepare(sql: string): { get(): unknown; all(): unknown[] }
}

type Opened = Awaited<ReturnType<typeof openServerStorage>>
const directories: string[] = []
const opened = new Set<Opened>()
const children = new Set<ChildProcess>()

beforeEach(() => {
  for (const key of ['DATABASE_URL', 'SQLITE_PATH', 'ARCADIA_DATA_DIR', 'ARCADIA_WORKSPACE_ROOT', 'SERVER_ID'])
    vi.stubEnv(key, undefined)
  vi.stubEnv('STORAGE_DRIVER', 'sqlite')
})
afterEach(async () => {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
  }
  children.clear()
  await Promise.all([...opened].map(value => value.close()))
  opened.clear()
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  vi.unstubAllEnvs()
})
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-persistence-'))
  directories.push(root)
  return join(root, 'server')
}
async function open(
  dataDir: string,
  mode: Parameters<typeof openServerStorage>[1] = 'start',
  options: { serverId?: string; workspaceRoot?: string } = {},
) {
  const value = await openServerStorage({ dataDir, ...options }, mode)
  opened.add(value)
  return value
}
async function close(value: Opened) {
  await value.close()
  opened.delete(value)
}
async function childOwner(dataDir: string) {
  const moduleUrl = pathToFileURL(resolve('bin/server-persistence.ts')).href
  const code = `import { openServerStorage } from ${JSON.stringify(moduleUrl)}; const opened = await openServerStorage({dataDir:${JSON.stringify(dataDir)}}); process.on('message', async message => {if(message === 'stop'){await opened.close();process.exit(0)}}); process.send({ready:true,serverId:opened.serverId})`
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
    cwd: resolve('.'),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      SystemRoot: process.env.SystemRoot,
      STORAGE_DRIVER: 'sqlite',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  children.add(child)
  let errors = ''
  child.stderr?.on('data', data => {
    errors += data.toString()
  })
  const identity = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Child owner did not start: ' + errors))
    }, 15000)
    child.once('message', message => {
      clearTimeout(timer)
      if (message && typeof message === 'object' && 'serverId' in message && typeof message.serverId === 'string')
        resolve(message.serverId)
      else reject(new Error('Invalid child owner response'))
    })
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', () => {
      clearTimeout(timer)
      reject(new Error('Child owner exited before ready: ' + errors))
    })
  })
  return { child, identity }
}

describe('server persistence initialization and maintenance safety', () => {
  it('reports absent storage without creating directories, identity, database or lease files', async () => {
    const dataDir = await directory()
    expect(await readServerStorageStatus({ dataDir })).toEqual({
      driver: 'sqlite',
      status: 'empty',
      serverId: undefined,
    })
    await expect(readdir(dataDir)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(openServerStorage({ dataDir }, 'inspect')).rejects.toThrow('STORAGE_NOT_INITIALIZED')
    await expect(openServerStorage({ dataDir }, 'admin')).rejects.toThrow('STORAGE_NOT_INITIALIZED')
    await expect(readdir(dataDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('inspects an unrelated SQLite database without changing schema, bytes or journal mode', async () => {
    const dataDir = await directory()
    await mkdir(dataDir)
    const filename = join(dataDir, 'server.sqlite')
    const raw = new Sqlite(filename)
    raw.exec("CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES ('keep')")
    raw.close()
    const before = await readFile(filename)
    expect(await readServerStorageStatus({ dataDir })).toMatchObject({ status: 'migration-required' })
    const inspection = await open(dataDir, 'inspect')
    await expect(inspection.storage.create('servers', { id: 'bad', scope: 'x', value: {} })).rejects.toThrow(
      'READ_ONLY_STORAGE',
    )
    await close(inspection)
    expect(await readFile(filename)).toEqual(before)
    expect(await readdir(dataDir)).toEqual(['server.sqlite'])
    const verify = new Sqlite(filename, { readonly: true })
    try {
      expect(verify.pragma('journal_mode', { simple: true })).toBe('delete')
      expect(verify.prepare('SELECT value FROM unrelated').get()).toEqual({ value: 'keep' })
    } finally {
      verify.close()
    }
  })
  it('refuses implicit startup migrations of an unrelated schema and leaves identity absent', async () => {
    const dataDir = await directory()
    await mkdir(dataDir)
    const raw = new Sqlite(join(dataDir, 'server.sqlite'))
    raw.exec('CREATE TABLE unrelated(value TEXT)')
    raw.close()
    await expect(openServerStorage({ dataDir })).rejects.toThrow('STORAGE_MIGRATION_REQUIRED')
    await expect(readFile(join(dataDir, 'identity.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    const verify = new Sqlite(join(dataDir, 'server.sqlite'), { readonly: true })
    try {
      expect(verify.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([{ name: 'unrelated' }])
    } finally {
      verify.close()
    }
  })
  it('preserves persistent identity through explicit migration, inspect and restart', async () => {
    const dataDir = await directory(),
      first = await open(dataDir, 'migrate'),
      id = first.serverId!
    await close(first)
    const before = await readFile(join(dataDir, 'identity.json'))
    expect(await readServerStorageStatus({ dataDir })).toMatchObject({ status: 'ready', serverId: id })
    const migrated = await open(dataDir, 'migrate')
    expect(migrated.serverId).toBe(id)
    await close(migrated)
    const restarted = await open(dataDir)
    expect(restarted.serverId).toBe(id)
    await close(restarted)
    expect(await readFile(join(dataDir, 'identity.json'))).toEqual(before)
  })
  it('checks configured identity before an explicit migration changes the database', async () => {
    const dataDir = await directory()
    await mkdir(dataDir)
    await writeFile(join(dataDir, 'identity.json'), JSON.stringify({ schemaVersion: 1, serverId: 'original' }))
    const raw = new Sqlite(join(dataDir, 'server.sqlite'))
    raw.exec('CREATE TABLE unrelated(value TEXT)')
    raw.close()
    const before = await readFile(join(dataDir, 'server.sqlite'))
    await expect(openServerStorage({ dataDir, serverId: 'different' }, 'migrate')).rejects.toThrow('differs')
    expect(await readFile(join(dataDir, 'server.sqlite'))).toEqual(before)
    expect((await readdir(dataDir)).sort()).toEqual(['identity.json', 'server.sqlite'])
  })
  it('rejects a current migration ledger with an incompatible actual schema', async () => {
    const dataDir = await directory(),
      first = await open(dataDir)
    await close(first)
    const raw = new Sqlite(join(dataDir, 'server.sqlite'))
    raw.exec('DROP TABLE arcadia_bindings')
    raw.close()
    await expect(openServerStorage({ dataDir })).rejects.toThrow('STORAGE_SCHEMA_INVALID')
    await expect(readServerStorageStatus({ dataDir })).rejects.toThrow('STORAGE_SCHEMA_INVALID')
  })
  it('allows ready credential maintenance and inspection but excludes another server or migration owner', async () => {
    const dataDir = await directory(),
      first = await open(dataDir)
    const admin = await open(dataDir, 'admin')
    expect(admin.serverId).toBe(first.serverId)
    expect(await readServerStorageStatus({ dataDir })).toMatchObject({ status: 'ready' })
    await expect(openServerStorage({ dataDir, workspaceRoot: join(dataDir, 'other-workspace') })).rejects.toThrow(
      'SERVER_DATA_DIRECTORY_IN_USE',
    )
    await expect(openServerStorage({ dataDir }, 'migrate')).rejects.toThrow('SERVER_DATA_DIRECTORY_IN_USE')
    await close(first)
    await expect(openServerStorage({ dataDir }, 'backup')).rejects.toThrow('SERVER_DATA_DIRECTORY_IN_USE')
    await close(admin)
    const maintenance = await open(dataDir, 'backup')
    await expect(openServerStorage({ dataDir }, 'admin')).rejects.toThrow('SERVER_DATA_DIRECTORY_IN_USE')
    await close(maintenance)
    const next = await open(dataDir)
    expect(next.serverId).toBe(first.serverId)
  })
  it('enforces ownership across processes and recovers the kernel lease after an abrupt owner death', async () => {
    const dataDir = await directory(),
      { child, identity } = await childOwner(dataDir)
    await expect(openServerStorage({ dataDir, workspaceRoot: join(dataDir, 'different') })).rejects.toThrow(
      'SERVER_DATA_DIRECTORY_IN_USE',
    )
    const admin = await open(dataDir, 'admin')
    expect(admin.serverId).toBe(identity)
    await close(admin)
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
    children.delete(child)
    const recovered = await open(dataDir)
    expect(recovered.serverId).toBe(identity)
  }, 20000)
})

it('requires explicit identity when a replacement data directory points at multiple server namespaces', async () => {
  const dataDir = await directory(),
    first = await open(dataDir)
  const a = new SQLAccountDirectory(first.storage, 'server-a'),
    b = new SQLAccountDirectory(first.storage, 'server-b')
  const proof = { providerId: 'email', issuer: 'mailto', subject: 'owner@example.test', verifiedAt: Date.now() }
  const account = await a.resolveOrCreate(proof)
  await b.resolveOrCreate(proof)
  await close(first)
  await rm(join(dataDir, 'identity.json'))
  await expect(openServerStorage({ dataDir }, 'migrate')).rejects.toThrow('SERVER_ID_REQUIRED')
  await expect(readFile(join(dataDir, 'identity.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  const chosen = await open(dataDir, 'migrate', { serverId: 'server-a' })
  expect(chosen.serverId).toBe('server-a')
  expect(await new SQLAccountDirectory(chosen.storage, 'server-a').resolveOrCreate(proof)).toEqual(account)
})

describe('durable workspace retention roots', () => {
  it('captures the workspace before queued work can outlive a management target switch', async () => {
    const owner = await open(await directory())
    let target = 'a'
    const roots = workspaceRetentions(owner.storage, () => target)
    await roots.put('old', 'pin')
    target = 'b'
    await roots.put('other', 'pin')
    target = 'a'
    let entered!: () => void, release!: () => void
    const enteredGate = new Promise<void>(resolve => {
      entered = resolve
    })
    const releaseGate = new Promise<void>(resolve => {
      release = resolve
    })
    const held = owner.storage.transaction(async () => {
      entered()
      await releaseGate
    })
    await enteredGate
    const pending = roots.list('old')
    target = 'b'
    release()
    await held
    expect(await pending).toEqual([{ installationId: 'old', retentionId: 'pin' }])
    expect(await roots.list('old')).toEqual([])
  })

  it('derives both binding installations and isolates explicit roots by workspace', async () => {
    const dataDir = await directory(),
      owner = await open(dataDir)
    const local = workspaceRetentions(owner.storage, () => 'local'),
      remote = workspaceRetentions(owner.storage, () => 'remote')
    await local.put('old', 'rollback')
    await remote.put('old', 'rollback')
    await owner.storage.create('bindings', {
      id: 'ours',
      scope: 'server:one',
      value: { workspaceId: 'local', environmentId: 'new' },
    })
    await owner.storage.create('bindings', {
      id: 'theirs',
      scope: 'server:two',
      value: { workspaceId: 'remote', environmentId: 'new' },
    })
    expect(await local.list('new')).toEqual([{ installationId: 'new', retentionId: 'binding:ours' }])
    expect(await local.list('old')).toEqual([{ installationId: 'old', retentionId: 'rollback' }])
    await local.remove('rollback')
    expect(await local.list('old')).toEqual([])
    expect(await remote.list('old')).toEqual([{ installationId: 'old', retentionId: 'rollback' }])
    const id = owner.serverId
    await close(owner)
    const restarted = await open(dataDir)
    expect(restarted.serverId).toBe(id)
    expect(await workspaceRetentions(restarted.storage, () => 'local').list('new')).toEqual([
      { installationId: 'new', retentionId: 'binding:ours' },
    ])
  })
})

const postgresUrl = process.env.TEST_DATABASE_URL
const canUseIsolatedPostgres = !!postgresUrl && /test/i.test(new URL(postgresUrl).pathname)
describe.skipIf(!canUseIsolatedPostgres)('PostgreSQL server namespace migration', () => {
  it('adopts the sole legacy account namespace and preserves it through explicit migration and restart', async () => {
    const name = 'arcadia_persistence_' + randomUUID().replaceAll('-', '')
    const admin = new Pool({ connectionString: postgresUrl, max: 1 })
    const targetUrl = new URL(postgresUrl!)
    targetUrl.pathname = '/' + name
    let legacy: Pool | undefined
    let created = false
    let current: Opened | undefined
    try {
      await admin.query(`CREATE DATABASE "${name}"`)
      created = true
      legacy = new Pool({ connectionString: targetUrl.toString(), max: 1 })
      await ensureAccountSchema(legacy)
      const identity = { providerId: 'email', issuer: 'mailto', subject: 'legacy@example.test', verifiedAt: Date.now() }
      const account = await new PgAccountDirectory(legacy, 'legacy-server').resolveOrCreate(identity)
      await legacy.end()
      legacy = undefined
      const dataDir = await directory()
      vi.stubEnv('STORAGE_DRIVER', 'postgres')
      vi.stubEnv('DATABASE_URL', targetUrl.toString())
      expect(await readServerStorageStatus({ dataDir })).toMatchObject({
        status: 'migration-required',
        serverId: undefined,
      })
      await expect(openServerStorage({ dataDir })).rejects.toThrow('STORAGE_MIGRATION_REQUIRED')
      await expect(readFile(join(dataDir, 'identity.json'))).rejects.toMatchObject({ code: 'ENOENT' })
      current = await open(dataDir, 'migrate')
      expect(current.serverId).toBe('legacy-server')
      expect(await new SQLAccountDirectory(current.storage, current.serverId!).resolveOrCreate(identity)).toEqual(
        account,
      )
      await close(current)
      current = undefined
      current = await open(dataDir)
      expect(current.serverId).toBe('legacy-server')
      expect(await new SQLAccountDirectory(current.storage, current.serverId!).resolveOrCreate(identity)).toEqual(
        account,
      )
      await close(current)
      current = undefined
      current = await open(dataDir, 'migrate')
      expect(current.serverId).toBe('legacy-server')
    } finally {
      try {
        if (current) await close(current)
        await legacy?.end()
        if (created) await dropTestDatabase(admin, name)
      } finally {
        await admin.end()
      }
    }
  })
})
