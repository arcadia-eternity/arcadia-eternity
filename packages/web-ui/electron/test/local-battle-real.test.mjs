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
  'desktop child runs the actual approved npm environment and rejects changed approval',
  {
    timeout: 90000,
    skip: process.env.ARCADIA_DESKTOP_REAL_HOST !== '1',
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'arcadia-desktop-real-'))
    const directory = join(root, 'project')
    const cache = join(root, 'npm-cache')
    const previous = process.env.npm_config_cache
    process.env.npm_config_cache = cache
    const host = new LocalBattleHost({
      executable: process.execPath,
      cli: resolve(repository, 'dist/cli.js'),
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
      await assert.rejects(host.start(directory), { code: 'NPM_NOT_APPROVED' })
    } finally {
      await host.stop()
      if (previous === undefined) delete process.env.npm_config_cache
      else process.env.npm_config_cache = previous
      await rm(root, { recursive: true, force: true })
    }
  },
)
