import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { stageAuthorSdk } from './stage-author-sdk.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const exec = promisify(execFile)
const cache = process.env.ARCADIA_SDK_INTEGRATION_CACHE

test(
  'local author SDK preserves package identity',
  { timeout: 120000, skip: process.platform === 'win32' },
  async t => {
    const temporary = await mkdtemp(join(tmpdir(), 'arcadia-author-sdk-test-'))
    try {
      const bundle = join(temporary, 'sdk')
      const index = await stageAuthorSdk(bundle)
      assert.equal(index.releaseReady, false)
      assert.equal(index.sdkApi, 1)
      assert.match(index.build.coreBuildId, /^[a-f0-9]{64}$/)
      assert.match(index.build.registryBuildId, /^[a-f0-9]{64}$/)
      assert.ok(index.packages.some(pkg => pkg.name === '@arcadia-eternity/pack-loader'))
      assert.ok(index.packages.some(pkg => pkg.name === '@arcadia-eternity/battle'))
      for (const pkg of index.packages) {
        const archive = join(bundle, pkg.filename)
        const bytes = await readFile(archive)
        assert.equal(createHash('sha256').update(bytes).digest('hex'), pkg.sha256)
        const files = (await exec('tar', ['-tzf', archive])).stdout.split('\n')
        assert.ok(!files.some(path => /^package\/licen[sc]e(?:\.|$)/i.test(path)))
        const metadata = JSON.parse((await exec('tar', ['-xOzf', archive, 'package/package.json'])).stdout)
        assert.equal(metadata.name, pkg.name)
        assert.equal(metadata.version, pkg.version)
        assert.equal(metadata.private, true)
        assert.ok(!JSON.stringify(metadata.dependencies).includes('workspace:'))
        assert.ok(!JSON.stringify(metadata.dependencies).includes('catalog:'))
      }
      await writeFile(join(bundle, 'keep.txt'), 'keep')
      await assert.rejects(stageAuthorSdk(bundle), /already exists/)
      assert.equal(await readFile(join(bundle, 'keep.txt'), 'utf8'), 'keep')

      await t.test('builds and runs a starter in an independent directory', { skip: !cache }, async () => {
        const project = join(temporary, 'project')
        await exec(
          process.execPath,
          [
            join(root, 'examples/ugc/create-content-pack.mjs'),
            project,
            '--name',
            '@test/local-sdk',
            '--project-id',
            'test-local-sdk',
            '--namespace',
            'test-local-sdk',
          ],
          { cwd: temporary },
        )
        const original = await readFile(join(project, 'package.json'), 'utf8')
        const archives = (await readdir(bundle)).filter(name => name.endsWith('.tgz')).map(name => join(bundle, name))
        const env = { ...process.env, npm_config_cache: cache, npm_config_registry: 'https://registry.npmjs.org' }
        delete env.NODE_TEST_CONTEXT
        await exec(
          'npm',
          [
            'install',
            '--offline',
            '--ignore-scripts',
            '--no-save',
            '--no-package-lock',
            '--no-audit',
            '--no-fund',
            ...archives,
          ],
          { cwd: project, env, maxBuffer: 8 * 1024 * 1024 },
        )
        assert.equal(await readFile(join(project, 'package.json'), 'utf8'), original)
        assert.ok(!(await readdir(project)).includes('package-lock.json'))
        const result = await exec('npm', ['test'], { cwd: project, env, maxBuffer: 8 * 1024 * 1024 })
        assert.match(result.stdout, /packed slow effect/)
      })
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  },
)
