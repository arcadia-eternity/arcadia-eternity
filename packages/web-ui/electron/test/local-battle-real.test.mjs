import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LocalBattleHost } from '../local-battle-host.mjs'
import { inspectNpmProject } from '@arcadia-eternity/pack-loader/node'

const exec = promisify(execFile)
const repository = fileURLToPath(new URL('../../../../', import.meta.url))

test(
  'desktop child accepts local edits and rejects an invalid project approval',
  {
    timeout: 90000,
    skip: process.env.ARCADIA_DESKTOP_REAL_HOST !== '1',
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'arcadia-desktop-real-'))
    const directory = join(root, 'project')
    const cache = join(root, 'npm-cache')
    const previous = process.env.npm_config_cache
    const previousPath = process.env.PATH
    process.env.npm_config_cache = cache
    const host = new LocalBattleHost({
      executable: process.env.ARCADIA_DESKTOP_TEST_EXECUTABLE ?? process.execPath,
      cli: process.env.ARCADIA_DESKTOP_TEST_CLI ?? resolve(repository, 'dist/cli.js'),
      npmCliPath: process.env.ARCADIA_DESKTOP_TEST_NPM_CLI,
      packsDirectory: process.env.ARCADIA_DESKTOP_TEST_PACKS_DIR,
      rendererOrigin: 'http://localhost:5173',
      startupTimeoutMs: 40000,
      shutdownTimeoutMs: 3000,
    })
    try {
      const packed = await exec(
        'npm',
        ['pack', './examples/ugc/slow', '--json', '--ignore-scripts', '--pack-destination', root],
        { cwd: repository, env: { ...process.env, npm_config_cache: cache } },
      )
      const tarball = join(root, JSON.parse(packed.stdout)[0].filename)
      await mkdir(directory)
      await writeFile(
        join(directory, 'package.json'),
        JSON.stringify({
          name: 'desktop-test',
          version: '1.0.0',
          private: true,
          dependencies: { '@arcadia-example/slow': `file:${tarball}` },
        }),
      )
      await exec('npm', ['install', '--offline', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], {
        cwd: directory,
        env: { ...process.env, npm_config_cache: cache },
      })
      const inspection = await inspectNpmProject(directory)
      const admission = {
        format: 'arcadia.npm-admission',
        version: 1,
        installationDigest: inspection.digest,
        profile: 'local-development',
      }
      await writeFile(join(directory, 'arcadia-admission.json'), JSON.stringify(admission))
      if (process.env.ARCADIA_DESKTOP_TEST_NO_PATH === '1') process.env.PATH = ''
      const ready = await host.start(directory)
      const response = await fetch(`${ready.url}/api/v1/environments`, { headers: { Origin: 'http://localhost:5173' } })
      assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173')
      const foreign = await fetch(`${ready.url}/api/v1/environments`, {
        headers: { Origin: 'https://foreign.example' },
      })
      assert.equal(foreign.headers.get('access-control-allow-origin'), null)
      const catalog = await response.json()
      const environment = catalog.environments.find(item =>
        item.packages.some(pkg => pkg.name === '@arcadia-example/slow'),
      )
      assert.ok(environment)
      const content = await (await fetch(`${ready.url}/api/v1/environments/${environment.id}/content`)).json()
      assert.ok(content.species.some(item => item.id === 'example-slow:pet'))
      assert.equal((await host.stop()).status, 'idle')
      await writeFile(
        join(directory, 'arcadia-admission.json'),
        JSON.stringify({ ...admission, installationDigest: '0'.repeat(64) }),
      )
      const effects = join(directory, 'node_modules/@arcadia-example/slow/dist/effects.js')
      await writeFile(effects, (await readFile(effects, 'utf8')) + '\n// local changes are allowed\n')
      assert.equal((await host.start(directory)).status, 'running')
      await host.stop()
      await writeFile(join(directory, 'arcadia-admission.json'), JSON.stringify({ ...admission, profile: 'invalid' }))
      await assert.rejects(host.start(directory), { code: 'NPM_NOT_APPROVED' })
    } finally {
      await host.stop()
      if (previous === undefined) delete process.env.npm_config_cache
      else process.env.npm_config_cache = previous
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
      await rm(root, { recursive: true, force: true })
    }
  },
)
