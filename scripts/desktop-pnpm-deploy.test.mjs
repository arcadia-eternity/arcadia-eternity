import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { withPreservedPnpmWorkspaceState } from './desktop-pnpm-deploy.mjs'
import { resolvePnpmInvocation } from './desktop-runtime-portability.mjs'

const exec = promisify(execFile)
const stateName = '.pnpm-workspace-state-v1.json'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-pnpm-state-'))
  await mkdir(join(root, 'node_modules'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, state: join(root, 'node_modules', stateName) }
}

test(
  'real offline pnpm production deploy preserves source state and development material',
  { timeout: 60000 },
  async t => {
    const { root, state } = await fixture(t)
    const pnpm = await resolvePnpmInvocation()
    const run = args =>
      exec(pnpm.command, [...pnpm.args, ...args], {
        cwd: root,
        env: { ...process.env, CI: 'true', HUSKY: '0' },
        timeout: 20000,
        maxBuffer: 1024 * 1024,
      })
    assert.equal((await run(['--version'])).stdout.trim(), '11.21.0')
    await mkdir(join(root, 'packages', 'server'), { recursive: true })
    await mkdir(join(root, 'dev-addon'))
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        private: true,
        packageManager: 'pnpm@11.21.0',
        devDependencies: { 'development-addon': 'file:./dev-addon' },
      }),
    )
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
    await writeFile(
      join(root, 'packages', 'server', 'package.json'),
      JSON.stringify({ name: 'fixture-server', version: '1.0.0', files: ['index.js'] }),
    )
    await writeFile(join(root, 'packages', 'server', 'index.js'), 'export const value = 1\n')
    await writeFile(
      join(root, 'dev-addon', 'package.json'),
      JSON.stringify({ name: 'development-addon', version: '1.0.0', files: ['development.node'] }),
    )
    const marker = Buffer.from('development-only native addon bytes\0\xff', 'latin1')
    await writeFile(join(root, 'dev-addon', 'development.node'), marker)
    const storeFlags = ['--store-dir', join(root, '.pnpm-store')]
    await run(['install', '--offline', '--ignore-scripts', ...storeFlags])
    const original = await readFile(state)
    const modulesPath = join(root, 'node_modules', '.modules.yaml')
    const originalModules = await readFile(modulesPath)
    const originalManifest = await readFile(join(root, 'package.json'))
    const originalLock = await readFile(join(root, 'pnpm-lock.yaml'))
    const installedAddon = join(root, 'node_modules', 'development-addon', 'development.node')
    assert.deepEqual(await readFile(installedAddon), marker)
    assert.equal(JSON.parse(original).settings.dev, true)
    const deploy = name =>
      run([
        '--filter',
        'fixture-server',
        'deploy',
        '--legacy',
        '--prod',
        '--frozen-lockfile',
        '--offline',
        '--ignore-scripts',
        ...storeFlags,
        join(root, name),
      ])

    // The unwrapped control proves that this exact pnpm version mutates the
    // source workspace metadata even though deployment writes to another path.
    await deploy('unwrapped-deploy')
    assert.notDeepEqual(await readFile(state), original)
    assert.equal(JSON.parse(await readFile(state, 'utf8')).settings.dev, false)
    await writeFile(state, original)

    const assertSourcePreserved = async () => {
      assert.deepEqual(await readFile(state), original)
      assert.deepEqual(await readFile(modulesPath), originalModules)
      assert.deepEqual(await readFile(join(root, 'package.json')), originalManifest)
      assert.deepEqual(await readFile(join(root, 'pnpm-lock.yaml')), originalLock)
      assert.deepEqual(await readFile(installedAddon), marker)
      assert.deepEqual(await readFile(join(root, 'dev-addon', 'development.node')), marker)
    }
    const result = await withPreservedPnpmWorkspaceState(root, async () => {
      await deploy('wrapped-deploy')
      return 'deployed'
    })
    assert.equal(result, 'deployed')
    await assertSourcePreserved()

    const failure = new Error('failure after production deployment')
    await assert.rejects(
      withPreservedPnpmWorkspaceState(root, async () => {
        await deploy('failed-action-deploy')
        throw failure
      }),
      error => error === failure,
    )
    await assertSourcePreserved()

    await mkdir(join(root, 'occupied-deploy'))
    await writeFile(join(root, 'occupied-deploy', 'keep'), 'existing destination')
    await assert.rejects(withPreservedPnpmWorkspaceState(root, () => deploy('occupied-deploy')))
    await assertSourcePreserved()
  },
)

test('absent source state stays absent after success or action failure', async t => {
  const { root, state } = await fixture(t)
  await withPreservedPnpmWorkspaceState(root, () => writeFile(state, 'created by deploy'))
  await assert.rejects(readFile(state), { code: 'ENOENT' })
  const failure = new Error('action failure')
  await assert.rejects(
    withPreservedPnpmWorkspaceState(root, async () => {
      await writeFile(state, 'created before failure')
      throw failure
    }),
    error => error === failure,
  )
  await assert.rejects(readFile(state), { code: 'ENOENT' })
})

test('nonregular source metadata rejects before running the deployment action', async t => {
  const { root, state } = await fixture(t)
  let called = false
  const action = async () => {
    called = true
  }
  await mkdir(state)
  await assert.rejects(withPreservedPnpmWorkspaceState(root, action))
  assert.equal(called, false)
  await rm(state, { recursive: true })
  const target = join(root, 'external-state')
  await writeFile(target, 'must remain untouched')
  await symlink(target, state, 'file')
  await assert.rejects(withPreservedPnpmWorkspaceState(root, action))
  assert.equal(called, false)
  assert.equal(await readFile(target, 'utf8'), 'must remain untouched')
})

test('unsafe replacement during restoration retains both action and restoration errors', async t => {
  const { root, state } = await fixture(t)
  await writeFile(state, 'original state bytes\n')
  const target = join(root, 'external-state')
  await writeFile(target, 'must remain untouched')
  const failure = new Error('deployment failed')
  await assert.rejects(
    withPreservedPnpmWorkspaceState(root, async () => {
      await rm(state)
      await symlink(target, state, 'file')
      throw failure
    }),
    error => {
      assert.ok(error instanceof AggregateError)
      assert.ok(error.errors.includes(failure))
      assert.equal(error.errors.length, 2)
      return true
    },
  )
  assert.equal(await readFile(target, 'utf8'), 'must remain untouched')
})

test('restoration failure is surfaced when the action succeeds', async t => {
  const { root, state } = await fixture(t)
  await writeFile(state, 'original state bytes\n')
  await assert.rejects(
    withPreservedPnpmWorkspaceState(root, async () => {
      await rm(state)
      await mkdir(state)
    }),
  )
})
