import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { persistentServerConfig, persistentServerId } from '../server-config'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'arcadia-server-config-'))
  directories.push(path)
  return path
}
describe('persistent server configuration', () => {
  it('defaults guest deployments to local SQLite while allowing PG independently of accounts', () => {
    expect(persistentServerConfig({ dataDir: '/tmp/example' }, {}).storage).toEqual({
      driver: 'sqlite',
      filename: '/tmp/example/server.sqlite',
    })
    expect(
      persistentServerConfig({}, { DATABASE_URL: 'postgres://example', ACCOUNT_MODE: 'guest' }).storage.driver,
    ).toBe('postgres')
    expect(() => persistentServerConfig({}, { STORAGE_DRIVER: 'sqlite', DATABASE_URL: 'postgres://example' })).toThrow()
    expect(() => persistentServerConfig({}, { STORAGE_DRIVER: 'postgres', SQLITE_PATH: 'x' })).toThrow()
    expect(() => persistentServerConfig({}, { STORAGE_DRIVER: 'unknown' })).toThrow()
  })
  it('keeps generated identity over restarts and refuses accidental identity replacement', async () => {
    const path = await directory()
    const id = await persistentServerId(path)
    expect(await persistentServerId(path)).toBe(id)
    expect(await persistentServerId(path, id)).toBe(id)
    await expect(persistentServerId(path, 'different')).rejects.toThrow('differs')
    expect(await persistentServerId(await directory())).not.toBe(id)
  })
  it('fails closed on corrupt identity data instead of silently creating a new account space', async () => {
    const path = await directory()
    await writeFile(join(path, 'identity.json'), '{broken')
    await expect(persistentServerId(path)).rejects.toThrow()
  })
  it('publishes one complete identity during concurrent initialization', async () => {
    const path = await directory()
    const ids = await Promise.all(Array.from({ length: 10 }, () => persistentServerId(path)))
    expect(new Set(ids).size).toBe(1)
  })
})
