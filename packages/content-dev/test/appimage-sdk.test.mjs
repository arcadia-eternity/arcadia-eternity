import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { persistentSdkPackages } from '../src/appimage-sdk.ts'
import { connectDevelopmentSdk } from '../src/project.ts'

const run = promisify(execFile)

test(
  'AppImage SDK links survive a remount and preserve bundled aliases and peers',
  { skip: process.platform === 'win32' },
  async t => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'arcadia-appimage-sdk-')))
    t.after(() => rm(root, { recursive: true, force: true }))
    const app = join(root, 'first mount')
    const env = { APPDIR: app, APPIMAGE: join(root, 'Player.AppImage'), XDG_DATA_HOME: join(root, 'data') }
    await writeFile(env.APPIMAGE, 'player')
    const modules = join(app, 'resources/arcadia-server/node_modules')
    async function pkg(directory, manifest, source) {
      const path = join(modules, directory)
      await mkdir(path, { recursive: true })
      await writeFile(join(path, 'package.json'), JSON.stringify({ name: directory, ...manifest }))
      await writeFile(join(path, 'index.js'), source)
      return path
    }
    const sdk = await pkg(
      '@arcadia-eternity/content-sdk',
      { dependencies: { alias: 'npm:library@1' } },
      "module.exports = [require('alias'), require('@arcadia-eternity/data-pack-base')]",
    )
    await pkg('@arcadia-eternity/data-pack-base', {}, "module.exports = 'base'")
    await pkg('unused', {}, '')
    const library = await pkg(
      '.pnpm/library@1_peer@1/node_modules/library',
      {
        name: 'library',
        peerDependencies: { peer: '1' },
        optionalDependencies: { absent: '2' },
      },
      "module.exports = require('peer')",
    )
    const peer = await pkg('.pnpm/peer@1/node_modules/peer', { name: 'peer' }, "module.exports = 'ok'")
    await mkdir(join(sdk, 'node_modules'))
    await symlink(relative(join(sdk, 'node_modules'), library), join(sdk, 'node_modules/alias'))
    await symlink(relative(dirname(library), peer), join(dirname(library), 'peer'))
    const packages = { '@arcadia-eternity/content-sdk': sdk }
    const [first, concurrent] = await Promise.all([
      persistentSdkPackages(packages, env),
      persistentSdkPackages(packages, env),
    ])
    assert.deepEqual(first, concurrent)
    const secondMount = join(root, 'second mount')
    await rename(app, secondMount)
    const next = await persistentSdkPackages(
      { '@arcadia-eternity/content-sdk': join(secondMount, relative(app, sdk)) },
      {
        ...env,
        APPDIR: secondMount,
      },
    )
    assert.deepEqual(first, next)
    const cachedSdk = next['@arcadia-eternity/content-sdk']
    assert.deepEqual(
      JSON.parse((await run(process.execPath, ['-p', 'JSON.stringify(require("."))'], { cwd: cachedSdk })).stdout),
      ['ok', 'base'],
    )
    assert.ok(!(await readdir(dirname(dirname(cachedSdk)))).includes('unused'))
    assert.equal((await readdir(join(env.XDG_DATA_HOME, 'arcadia-eternity/author-sdks'))).length, 1)
    await writeFile(env.APPIMAGE, 'updated player')
    const updated = await persistentSdkPackages(
      { '@arcadia-eternity/content-sdk': join(secondMount, relative(app, sdk)) },
      { ...env, APPDIR: secondMount },
    )
    assert.notDeepEqual(updated, first)
  },
)

test('concurrent connections preserve user-supplied project dependencies and commands', async t => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-sdk-connect-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'node_modules/.bin'), { recursive: true })
  const owned = join(root, 'node_modules/@arcadia-eternity/battle')
  await mkdir(owned, { recursive: true })
  await writeFile(join(owned, 'package.json'), '{}')
  const executable = process.platform === 'win32' ? 'arcadia-content.cmd' : 'arcadia-content'
  const bin = join(root, 'node_modules/.bin', executable)
  await writeFile(bin, 'local command')
  const typescript = join(root, 'node_modules/typescript')
  const manual = join(root, 'manually-managed')
  if (process.platform === 'win32') await mkdir(manual)
  await symlink(manual, typescript, process.platform === 'win32' ? 'junction' : 'dir')
  const originalTarget = await readlink(typescript)
  await Promise.all([connectDevelopmentSdk(root), connectDevelopmentSdk(root)])
  assert.equal(await readFile(bin, 'utf8'), 'local command')
  assert.equal(await readFile(join(owned, 'package.json'), 'utf8'), '{}')
  assert.equal(await readlink(typescript), originalTarget)
})
