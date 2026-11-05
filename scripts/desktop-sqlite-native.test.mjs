import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stageDesktopSqlite, verifyDesktopSqlite, loadElectronRebuild } from './desktop-sqlite-native.mjs'

const exec = promisify(execFile)
const repository = fileURLToPath(new URL('../', import.meta.url))
test('native staging rejects escaped package code before executing it', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'arcadia-native-escape-'))
  try {
    const runtime = join(temporary, 'runtime')
    const moduleRoot = join(runtime, 'node_modules/better-sqlite3')
    await mkdir(moduleRoot, { recursive: true })
    await mkdir(join(runtime, 'node_modules/@arcadia-eternity/database'), { recursive: true })
    await writeFile(
      join(moduleRoot, 'package.json'),
      JSON.stringify({ name: 'better-sqlite3', version: '12.11.1', main: 'index.js' }),
    )
    const marker = join(temporary, 'executed')
    const outside = join(temporary, 'outside.cjs')
    await writeFile(outside, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed')`)
    await symlink(outside, join(moduleRoot, 'index.js'), 'file')
    await assert.rejects(
      stageDesktopSqlite({
        runtime,
        executable: process.execPath,
        electronVersion: '41.10.7',
        abi: '145',
        cacheDirectory: join(temporary, 'cache'),
      }),
      /escaping or absolute link/,
    )
    await assert.rejects(readFile(marker), { code: 'ENOENT' })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test(
  'staged SQLite is verified in the actual Electron ABI without changing the Node development binary',
  {
    timeout: 240000,
    skip: process.env.ARCADIA_DESKTOP_NATIVE_TEST !== '1',
  },
  async () => {
    const databaseRequire = createRequire(join(repository, 'packages/database/package.json'))
    const webRequire = createRequire(join(repository, 'packages/web-ui/package.json'))
    const sqliteRoot = dirname(databaseRequire.resolve('better-sqlite3/package.json'))
    const originalBinary = join(sqliteRoot, 'build/Release/better_sqlite3.node')
    const original = await readFile(originalBinary)
    const executable = process.env.ARCADIA_ELECTRON_EXECUTABLE ?? webRequire('electron')
    const embedded = JSON.parse(
      (
        await exec(
          executable,
          [
            '-p',
            'JSON.stringify({electron:process.versions.electron,abi:process.versions.modules,platform:process.platform,arch:process.arch})',
          ],
          { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
        )
      ).stdout,
    )
    const temporary = await mkdtemp(join(tmpdir(), 'arcadia-native-stage-'))
    const runtime = join(temporary, 'runtime'),
      cache = join(repository, 'node_modules/.cache/arcadia-desktop-native')
    try {
      await mkdir(join(runtime, 'node_modules/@arcadia-eternity/database'), { recursive: true })
      await writeFile(
        join(runtime, 'node_modules/@arcadia-eternity/database/package.json'),
        '{"name":"@arcadia-eternity/database"}',
      )
      const copied = new Set()
      const copyPackage = async (name, require) => {
        if (copied.has(name)) return
        copied.add(name)
        const source = dirname(require.resolve(`${name}/package.json`))
        await cp(source, join(runtime, 'node_modules', name), { recursive: true, dereference: true })
        const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
        for (const dependency of Object.keys(manifest.dependencies ?? {}))
          await copyPackage(dependency, createRequire(join(source, 'package.json')))
      }
      await copyPackage('better-sqlite3', databaseRequire)
      const options = {
        runtime,
        executable,
        electronVersion: embedded.electron,
        abi: embedded.abi,
        platform: embedded.platform,
        arch: embedded.arch,
        cacheDirectory: cache,
      }
      const native = await stageDesktopSqlite({
        ...options,
        online: true,
        rebuild: await loadElectronRebuild(join(repository, 'packages/web-ui/package.json')),
      })
      assert.equal(native.verified, true)
      assert.equal(native.abi, embedded.abi)
      assert.deepEqual(await readFile(originalBinary), original, 'system Node addon is not rebuilt in place')
      const nodeDatabase = databaseRequire('better-sqlite3')
      const db = new nodeDatabase(':memory:')
      assert.equal(db.prepare('SELECT 1 AS value').get().value, 1)
      db.close()
      const moduleRoot = join(runtime, 'node_modules/better-sqlite3')
      await verifyDesktopSqlite({
        executable,
        moduleRoot,
        electronVersion: embedded.electron,
        platform: embedded.platform,
        arch: embedded.arch,
      })
      await rm(join(moduleRoot, 'build'), { recursive: true, force: true })
      const cached = await stageDesktopSqlite({
        ...options,
        online: false,
        rebuild: () => {
          throw new Error('Offline staging must not rebuild/download')
        },
      })
      assert.equal(cached.verified, true)
      assert.deepEqual(await readFile(originalBinary), original)
      await rm(join(moduleRoot, 'build'), { recursive: true, force: true })
      const corruptCache = join(temporary, 'corrupt-cache')
      const cacheKey = [
        cached.name,
        cached.version,
        cached.electronVersion,
        cached.platform,
        cached.arch,
        `abi${cached.abi}`,
      ].join('-')
      await mkdir(join(corruptCache, cacheKey), { recursive: true })
      await writeFile(join(corruptCache, cacheKey, 'better_sqlite3.node'), 'invalid native binary')
      await assert.rejects(
        stageDesktopSqlite({
          ...options,
          cacheDirectory: corruptCache,
          online: false,
          rebuild: () => {
            throw new Error('Must not rebuild offline')
          },
        }),
        /No verified SQLite binary/,
      )
      assert.deepEqual(await readFile(originalBinary), original)
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  },
)
