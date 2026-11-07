import { randomUUID } from 'node:crypto'
import { mkdir, readFile, open, link, unlink } from 'node:fs/promises'
import { resolve, join } from 'node:path'

export interface PersistentServerConfig {
  dataDirectory: string
  workspaceRoot: string
  storage: { driver: 'sqlite'; filename: string } | { driver: 'postgres'; connectionString: string }
}

/** Storage is independent of the player account provider configuration. */
export function persistentServerConfig(
  options: { dataDir?: string; workspaceRoot?: string },
  env: NodeJS.ProcessEnv = process.env,
): PersistentServerConfig {
  const dataDirectory = resolve(options.dataDir ?? env.ARCADIA_DATA_DIR ?? '.arcadia-server')
  const workspaceRoot = resolve(options.workspaceRoot ?? env.ARCADIA_WORKSPACE_ROOT ?? join(dataDirectory, 'workspace'))
  const driver = env.STORAGE_DRIVER ?? (env.DATABASE_URL ? 'postgres' : 'sqlite')
  if (driver !== 'sqlite' && driver !== 'postgres') throw new Error('STORAGE_DRIVER must be sqlite or postgres')
  if (driver === 'sqlite' && env.DATABASE_URL) throw new Error('SQLite cannot be combined with DATABASE_URL')
  if (driver === 'postgres' && env.SQLITE_PATH) throw new Error('PostgreSQL cannot be combined with SQLITE_PATH')
  if (driver === 'postgres' && !env.DATABASE_URL?.trim()) throw new Error('PostgreSQL requires DATABASE_URL')
  return {
    dataDirectory,
    workspaceRoot,
    storage:
      driver === 'sqlite'
        ? { driver, filename: resolve(env.SQLITE_PATH ?? join(dataDirectory, 'server.sqlite')) }
        : { driver, connectionString: env.DATABASE_URL! },
  }
}

function validateId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !id.trim() || id.length > 128 || /\p{Cc}/u.test(id))
    throw new Error('Invalid persistent server identity')
}

/** Identity survives process restarts; changing it requires a separate data directory. */
export async function persistentServerId(directory: string, configuredId?: string): Promise<string> {
  if (configuredId !== undefined) validateId(configuredId)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const file = join(directory, 'identity.json')
  try {
    const value: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (!value || typeof value !== 'object' || !('serverId' in value))
      throw new Error('Invalid persistent server identity')
    validateId(value.serverId)
    if (configuredId && configuredId !== value.serverId)
      throw new Error('SERVER_ID differs from the stored identity; use an explicit clone into a new data directory')
    return value.serverId
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const serverId = configuredId ?? randomUUID()
  const temporary = join(directory, '.identity-' + randomUUID())
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(JSON.stringify({ schemaVersion: 1, serverId }) + '\n')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    // Link publishes the fully written file without replacing another initializer.
    await link(temporary, file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    return persistentServerId(directory, configuredId)
  } finally {
    await unlink(temporary)
  }
  return serverId
}
