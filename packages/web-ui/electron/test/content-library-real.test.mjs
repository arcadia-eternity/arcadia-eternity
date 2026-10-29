import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ContentLibrary } from '../content-library.mjs'
import { LocalBattleHost } from '../local-battle-host.mjs'
import { runContentCommand } from '../content-projects.mjs'

const exec = promisify(execFile)
const repository = fileURLToPath(new URL('../../../../', import.meta.url))
test(
  'real package library installs, applies and starts a tarball, and changes content only after restart',
  {
    timeout: 120000,
    skip: process.env.ARCADIA_DESKTOP_REAL_HOST !== '1',
  },
  async t => {
    const root = await mkdtemp(join(tmpdir(), 'arcadia-library-real-'))
    const host = new LocalBattleHost({
      executable: process.execPath,
      cli: resolve(repository, 'dist/cli.js'),
      rendererOrigin: 'http://localhost:5173',
      startupTimeoutMs: 40000,
      shutdownTimeoutMs: 3000,
    })
    const runtime = { ...host, npmCacheDirectory: join(root, 'npm-cache') }
    const library = new ContentLibrary({
      root: join(root, 'library'),
      host,
      run: (args, signal) => runContentCommand(runtime, args, signal),
    })
    try {
      const packed = await exec(
        'npm',
        ['pack', './examples/ugc/slow', '--json', '--ignore-scripts', '--pack-destination', root],
        { cwd: repository },
      )
      const tarball = join(root, JSON.parse(packed.stdout)[0].filename)
      const preview = await library.stageFile(tarball, true)
      assert.equal(preview.package.name, '@arcadia-example/slow')
      assert.equal((await library.list()).packages.length, 0)
      assert.ok(preview.package.contentIds.species.includes('example-slow:pet'))
      const id = await library.confirmInstall(preview.id, true)
      const plan = await library.planSelection([id], true)
      assert.equal(plan.requiresApproval, false)
      await library.applySelection(plan.id)
      const ready = await library.start()
      assert.equal(ready.status, 'running')
      const catalogue = async () => (await (await fetch(ready.url + '/api/v1/environments')).json()).environments
      let environments = await catalogue()
      const custom = environments.find(env => env.packages.some(pkg => pkg.name === '@arcadia-example/slow'))
      assert.ok(custom)
      const content = await (await fetch(ready.url + '/api/v1/environments/' + custom.id + '/content')).json()
      assert.ok(content.species.some(pet => pet.id === 'example-slow:pet'))
      t.diagnostic('Real tarball was inspected, admitted, composed, validated and served')
      const old = host.projectDirectory()
      const empty = await library.planSelection([], true)
      await library.applySelection(empty.id)
      assert.equal(host.projectDirectory(), old)
      assert.equal((await library.list()).serviceNeedsRestart, true)
      assert.ok((await catalogue()).some(env => env.packages.some(pkg => pkg.name === '@arcadia-example/slow')))
      await library.uninstall(id)
      assert.ok(await readFile(tarball))
      await host.stop()
      const next = await library.start()
      environments = (await (await fetch(next.url + '/api/v1/environments')).json()).environments
      assert.ok(environments.length > 0)
      assert.ok(environments.every(env => !env.packages.some(pkg => pkg.name === '@arcadia-example/slow')))
      assert.equal((await library.list()).serviceNeedsRestart, false)
      t.diagnostic('Running service retained its content; restarted service uses official-only selection')
    } finally {
      await library.close()
      await host.stop()
      await rm(root, { recursive: true, force: true })
    }
  },
)
