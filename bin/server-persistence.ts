import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { acquireStorageOwner, openStorage, type DurableStorage } from '@arcadia-eternity/database'
import { persistentServerConfig, persistentServerId } from './server-config'

type Options = { dataDir?: string; workspaceRoot?: string; serverId?: string }
export type ServerStorageMode = 'start' | 'migrate' | 'inspect' | 'admin' | 'backup'

async function existingIdentity(directory: string, expected?: string): Promise<string | undefined> {
  if (expected !== undefined && (!expected.trim() || expected.length > 128 || /\p{Cc}/u.test(expected)))
    throw new Error('Invalid persistent server identity')
  try {
    const identity: unknown = JSON.parse(await readFile(join(directory, 'identity.json'), 'utf8'))
    if (
      !identity ||
      typeof identity !== 'object' ||
      !('serverId' in identity) ||
      !('schemaVersion' in identity) ||
      identity.schemaVersion !== 1 ||
      typeof identity.serverId !== 'string' ||
      !identity.serverId.trim() ||
      identity.serverId.length > 128 ||
      /\p{Cc}/u.test(identity.serverId)
    )
      throw new Error('Invalid persistent server identity')
    if (expected !== undefined && expected !== identity.serverId)
      throw new Error('SERVER_ID differs from the stored identity; use an explicit clone into a new data directory')
    return identity.serverId
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
async function fileExists(filename: string): Promise<boolean> {
  try {
    const value = await stat(filename)
    if (!value.isFile()) throw new Error('Storage path is not a file')
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Status never initializes a directory, identity or database, including an absent SQLite path. */
export async function readServerStorageStatus(options: Options) {
  const config = persistentServerConfig(options)
  const serverId = await existingIdentity(config.dataDirectory, options.serverId)
  if (config.storage.driver === 'sqlite' && !(await fileExists(config.storage.filename)))
    return { driver: config.storage.driver, status: 'empty' as const, serverId }
  const storage = openStorage({ ...config.storage, readonly: true })
  try {
    const status = await storage.schemaStatus()
    if (status === 'ready') await storage.checkSchema()
    return { driver: storage.driver, status, serverId }
  } finally {
    await storage.close()
  }
}

/** One server/maintenance owner per data directory; credential maintenance can share a ready store. */
export async function openServerStorage(options: Options, mode: ServerStorageMode = 'start') {
  const config = persistentServerConfig(options)
  // Reject identity mismatch before migrations or other mutation.
  let serverId = await existingIdentity(config.dataDirectory, options.serverId)
  const exclusive = mode === 'start' || mode === 'migrate' || mode === 'backup'
  if ((mode === 'admin' || mode === 'backup') && !serverId)
    throw new Error('STORAGE_NOT_INITIALIZED: run server db migrate first')
  if (
    (mode === 'inspect' || mode === 'admin' || mode === 'backup') &&
    config.storage.driver === 'sqlite' &&
    !(await fileExists(config.storage.filename))
  )
    throw new Error('STORAGE_NOT_INITIALIZED: run server db migrate first')
  let owner: ReturnType<typeof acquireStorageOwner> | undefined
  let storage: DurableStorage | undefined
  try {
    if (exclusive) {
      await mkdir(config.dataDirectory, { recursive: true, mode: 0o700 })
      owner = acquireStorageOwner(
        join(config.dataDirectory, 'server-owner.sqlite'),
        mode === 'start' ? 'server' : 'maintenance',
      )
      // Another initializer may have published identity before this owner acquired its lease.
      serverId = await existingIdentity(config.dataDirectory, options.serverId)
      if (config.storage.driver === 'sqlite')
        await mkdir(dirname(config.storage.filename), { recursive: true, mode: 0o700 })
    }
    if (mode === 'admin') owner = acquireStorageOwner(join(config.dataDirectory, 'server-owner.sqlite'), 'shared')
    storage = openStorage({ ...config.storage, readonly: mode === 'inspect' })
    const status = await storage.schemaStatus()
    if (mode === 'migrate' || (mode === 'start' && status === 'empty')) await storage.migrate()
    else if (mode !== 'inspect') await storage.checkSchema()
    else if (status === 'ready') await storage.checkSchema()
    if (mode === 'start' || mode === 'migrate') {
      let expected = options.serverId ?? serverId
      if (!expected) {
        const knownIds = await storage.knownServerIds()
        if (knownIds.length > 1)
          throw new Error('SERVER_ID_REQUIRED: database contains multiple servers; pass --server-id')
        expected = knownIds[0]
      }
      serverId = await persistentServerId(config.dataDirectory, expected)
    }
    const originalClose = storage.close.bind(storage)
    let closed: Promise<void> | undefined
    const close = () =>
      (closed ??= (async () => {
        try {
          await originalClose()
        } finally {
          owner?.close()
        }
      })())
    // Existing call sites close storage; both entry points release exactly the same lease.
    storage.close = close
    return { config, storage, serverId, close }
  } catch (error) {
    try {
      await storage?.close()
    } finally {
      owner?.close()
    }
    throw error
  }
}

/** Durable roots are separate from the workspace's current-process leases. */
export function workspaceRetentions(storage: DurableStorage, workspaceId: () => string) {
  return {
    async list(versionId: string) {
      const target = workspaceId(),
        scope = 'workspace:' + target
      return storage.transaction(async tx => {
        const rows = await tx.list<{ versionId: string; retentionId: string }>('retentions', scope)
        const bindings = await tx.list<{ workspaceId: string; desiredVersionId?: string; effectiveVersionId?: string }>(
          'bindings',
        )
        return [
          ...rows.filter(row => row.value.versionId === versionId).map(row => row.value),
          ...bindings
            .filter(
              row =>
                row.value.workspaceId === target &&
                (row.value.desiredVersionId === versionId || row.value.effectiveVersionId === versionId),
            )
            .map(row => ({ versionId, retentionId: 'binding:' + row.id })),
        ]
      })
    },
    async put(versionId: string, retentionId: string) {
      const scope = 'workspace:' + workspaceId(),
        id = scope + ':' + retentionId
      await storage.transaction(async tx => {
        const existing = await tx.get('retentions', id),
          value = { versionId, retentionId }
        if (existing) await tx.replace('retentions', id, existing.revision, value)
        else await tx.create('retentions', { id, scope, value })
      })
    },
    async remove(retentionId: string) {
      const id = 'workspace:' + workspaceId() + ':' + retentionId
      await storage.transaction(async tx => {
        const existing = await tx.get('retentions', id)
        if (existing) await tx.delete('retentions', existing.id, existing.revision)
      })
    },
  }
}
