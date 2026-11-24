import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseNpmPackOutput } from '@arcadia-eternity/pack-loader/node'
import { ContentProjectManager, runContentCommand } from '../content-projects.mjs'

const exec = promisify(execFile)
const repository = fileURLToPath(new URL('../../../../', import.meta.url))

test(
  'desktop project tools install, validate and verify an exported project offline',
  {
    timeout: 90000,
    skip: process.env.ARCADIA_DESKTOP_REAL_HOST !== '1',
  },
  async t => {
    const root = await mkdtemp(join(tmpdir(), 'arcadia-desktop-real-'))
    const directory = join(root, 'project')
    const cache = join(root, 'npm-cache')
    const previous = process.env.npm_config_cache
    const previousPath = process.env.PATH
    process.env.npm_config_cache = cache
    const runtime = {
      executable: process.env.ARCADIA_DESKTOP_TEST_EXECUTABLE ?? process.execPath,
      cli: process.env.ARCADIA_DESKTOP_TEST_CLI ?? resolve(repository, 'dist/cli.js'),
      npmCliPath: process.env.ARCADIA_DESKTOP_TEST_NPM_CLI,
      packsDirectory: process.env.ARCADIA_DESKTOP_TEST_PACKS_DIR,
      npmCacheDirectory: cache,
    }
    try {
      const packed = await exec(
        'npm',
        ['pack', './examples/ugc/slow', '--json', '--ignore-scripts', '--pack-destination', root],
        { cwd: repository, env: { ...process.env, npm_config_cache: cache } },
      )
      const tarball = join(root, parseNpmPackOutput(packed.stdout)[0].filename)
      await mkdir(directory)
      const projectTarball = join(directory, parseNpmPackOutput(packed.stdout)[0].filename)
      await copyFile(tarball, projectTarball)
      await writeFile(
        join(directory, 'package.json'),
        JSON.stringify({
          name: 'desktop-test',
          version: '1.0.0',
          private: true,
          dependencies: { '@arcadia-example/slow': `file:./${parseNpmPackOutput(packed.stdout)[0].filename}` },
        }),
      )
      await exec('npm', ['install', '--offline', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], {
        cwd: directory,
        env: { ...process.env, npm_config_cache: cache },
      })
      // Exercise the same manager actions used by the renderer, with a real fixed
      // local tarball and CLI subprocess rather than mocked package inspection.
      await rm(join(directory, 'node_modules'), { recursive: true })
      const manager = new ContentProjectManager({
        file: join(root, 'content-projects.json'),
        run: (args, signal) => runContentCommand(runtime, args, signal),
      })
      const id = await manager.add(directory)
      if (process.env.ARCADIA_DESKTOP_TEST_NO_PATH === '1') process.env.PATH = ''
      await manager.operate(id, 'install', { offline: true })
      const installed = (await manager.list())[0]
      assert.ok(installed.inspection.contentIds.species.includes('example-slow:pet'))
      assert.ok(installed.inspection.contentIds.skills.includes('example-slow:strike'))
      assert.equal(installed.approved, false)
      await manager.operate(id, 'approve')
      await manager.operate(id, 'validate')
      t.diagnostic('Installed, admitted and validated the original project')
      assert.equal((await manager.list())[0].approved, true)
      const exported = join(root, 'exported')
      await manager.export(id, exported, true)
      const exportedId = await manager.add(exported)
      await manager.operate(exportedId, 'install', { offline: true })
      await manager.operate(exportedId, 'approve')
      await manager.operate(exportedId, 'verify')
      t.diagnostic('Exported, reinstalled, admitted and verified the portable environment')
    } finally {
      if (previous === undefined) delete process.env.npm_config_cache
      else process.env.npm_config_cache = previous
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
      await rm(root, { recursive: true, force: true })
    }
  },
)
