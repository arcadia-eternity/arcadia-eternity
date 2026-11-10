import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { stageAuthorSdk } from './stage-author-sdk.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const exec = promisify(execFile)
const cache = process.env.ARCADIA_SDK_INTEGRATION_CACHE
const semver = createRequire(join(root, 'packages/pack-loader/package.json'))('semver')

function entryPaths(value) {
  if (typeof value === 'string') return [value]
  if (value && typeof value === 'object') return Object.values(value).flatMap(entryPaths)
  return []
}

test(
  'local author SDK preserves package identity',
  { timeout: 120000, skip: process.platform === 'win32' },
  async t => {
    const temporary = await mkdtemp(join(tmpdir(), 'arcadia-author-sdk-test-'))
    try {
      const bundle = join(temporary, 'sdk')
      const index = await stageAuthorSdk(bundle)
      const versions = new Map(index.packages.map(pkg => [pkg.name, pkg.version]))
      assert.equal(index.releaseReady, false)
      assert.equal(index.sdkApi, 2)
      assert.match(index.build.coreBuildId, /^[a-f0-9]{64}$/)
      assert.match(index.build.registryBuildId, /^[a-f0-9]{64}$/)
      assert.ok(index.packages.some(pkg => pkg.name === '@arcadia-eternity/pack-loader'))
      assert.ok(index.packages.some(pkg => pkg.name === '@arcadia-eternity/battle'))
      for (const pkg of index.packages) {
        const archive = join(bundle, pkg.filename)
        const files = (await exec('tar', ['-tzf', archive])).stdout.split('\n')
        assert.ok(!files.some(path => /^package\/licen[sc]e(?:\.|$)/i.test(path)))
        const metadata = JSON.parse((await exec('tar', ['-xOzf', archive, 'package/package.json'])).stdout)
        if (pkg.name === '@arcadia-eternity/content-sdk') {
          for (const path of [
            'bin/arcadia-content-mcp.mjs',
            'dist/author-api.mjs',
            'dist/mcp.mjs',
            'dist/template/src/effects/slow.effect.ts',
            'dist/template/skills/arcadia-content-authoring/SKILL.md',
          ])
            assert.ok(files.includes('package/' + path), `missing author artifact: ${path}`)
          assert.equal(metadata.exports['./workspace'], './dist/author-api.mjs')
          assert.equal(metadata.bin['arcadia-content-mcp'], './bin/arcadia-content-mcp.mjs')
        }
        assert.equal(metadata.name, pkg.name)
        assert.equal(metadata.version, pkg.version)
        assert.equal(metadata.private, true)
        for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
          for (const [name, spec] of Object.entries(metadata[section] ?? {})) {
            assert.doesNotMatch(spec, /^(workspace:|catalog:)/, `${pkg.name}: unresolved ${name} in ${section}`)
            if (name.startsWith('@arcadia-eternity/')) {
              assert.ok(versions.has(name), `${pkg.name}: missing SDK dependency ${name} in ${section}`)
              assert.ok(semver.satisfies(versions.get(name), spec), `${pkg.name}: incompatible ${name} ${spec}`)
            }
          }
        }
        for (const path of entryPaths([metadata.main, metadata.types, metadata.bin, metadata.exports]))
          assert.ok(files.includes(`package/${path.replace(/^\.\//, '')}`), `${pkg.name}: missing entry ${path}`)
      }
      await writeFile(join(bundle, 'keep.txt'), 'keep')
      await assert.rejects(stageAuthorSdk(bundle), /already exists/)
      assert.equal(await readFile(join(bundle, 'keep.txt'), 'utf8'), 'keep')

      await t.test('builds and runs a starter in an independent directory', { skip: !cache }, async () => {
        const project = join(temporary, 'project')
        await cp(join(root, 'examples/ugc/slow'), project, {
          recursive: true,
          filter: path => !/(?:^|[/\\])(?:node_modules|dist)(?:[/\\]|$)/.test(path),
        })
        const metadataFile = join(project, 'package.json')
        const metadata = JSON.parse(await readFile(metadataFile, 'utf8'))
        metadata.scripts.test = 'npm run build && node --test test/*.test.mjs'
        await writeFile(metadataFile, JSON.stringify(metadata, null, 2) + '\n')
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

test('development tooling is packaged with its executable and testing entry', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'arcadia-content-dev-sdk-'))
  try {
    const index = await stageAuthorSdk(join(temporary, 'sdk'))
    const tool = index.packages.find(pkg => pkg.name === '@arcadia-eternity/content-sdk')
    assert.ok(tool)
    const archive = join(temporary, 'sdk', tool.filename)
    const metadata = JSON.parse((await exec('tar', ['-xOzf', archive, 'package/package.json'])).stdout)
    const files = (await exec('tar', ['-tzf', archive])).stdout.split('\n')
    assert.equal(metadata.bin['arcadia-content'], './bin/arcadia-content.mjs')
    assert.equal(metadata.exports['./testing'], './dist/testing.mjs')
    assert.ok(files.includes('package/bin/arcadia-content.mjs'))
    assert.ok(files.includes('package/dist/cli.mjs'))
    assert.ok(files.includes('package/dist/testing.mjs'))
    assert.ok(!files.some(file => /package\/test\//.test(file)))
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
