import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { t as list, x as extract } from 'tar'
import { resolvePnpmInvocation } from '../../../scripts/desktop-runtime-portability.mjs'

const exec = promisify(execFile)
const sdkSource = fileURLToPath(new URL('../', import.meta.url))

async function packagedSdk(root) {
  // Use the release packer and its declared bin entries. Only dependencies are shared with
  // the checkout, allowing this test to run offline without installing another copy of TypeScript.
  const archives = join(root, 'archives')
  await mkdir(archives)
  const pnpm = await resolvePnpmInvocation()
  await exec(
    pnpm.command,
    [...pnpm.args, '--config.verify-deps-before-run=false', 'pack', '--pack-destination', archives],
    {
      cwd: sdkSource,
    },
  )
  const [archive] = await readdir(archives)
  const installed = join(root, 'host/node_modules/@arcadia-eternity/content-sdk')
  await mkdir(installed, { recursive: true })
  await extract({ file: join(archives, archive), cwd: installed, strip: 1, strict: true })
  assert.ok(!(await readdir(join(installed, 'dist'))).includes('creator-pages'))
  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
  for (const name of Object.keys(manifest.dependencies)) {
    const target = join(installed, 'node_modules', name)
    await mkdir(dirname(target), { recursive: true })
    await symlink(await realpath(join(sdkSource, 'node_modules', name)), target, 'junction')
  }
  const cli = join(installed, manifest.bin['arcadia-content'])
  const mcp = join(installed, manifest.bin['arcadia-content-mcp'])
  const env = {
    npm_config_offline: 'true',
    npm_config_cache: join(root, 'cache'),
    ...(process.env.CHOKIDAR_USEPOLLING && { CHOKIDAR_USEPOLLING: process.env.CHOKIDAR_USEPOLLING }),
  }
  return {
    run: (cwd, ...args) => exec(process.execPath, [cli, ...args], { cwd, env: { ...process.env, ...env } }),
    async session(directory, args, operation) {
      const client = new Client({ name: 'packaged-install', version: '1' })
      try {
        await client.connect(
          new StdioClientTransport({ command: process.execPath, args: [mcp, directory, ...args], env, stderr: 'pipe' }),
        )
        async function call(name, input = {}) {
          const reply = await client.callTool({ name, arguments: input })
          assert.notEqual(reply.isError, true, JSON.stringify(reply.content))
          return reply.structuredContent.result
        }
        async function job(name, input = {}) {
          let status = await call(name, input)
          while (['queued', 'running'].includes(status.state))
            status = await call('job_get', { jobId: status.jobId, waitMs: 1000 })
          if (status.state !== 'succeeded') assert.fail((await call('job_output', { jobId: status.jobId })).text)
          assert.equal(status.stale, false)
          return status.result
        }
        return await operation(call, job)
      } finally {
        await client.close()
      }
    },
  }
}

test(
  'the packaged MCP installs content and a self-contained environment for a new agent session',
  { timeout: 150000 },
  async t => {
    const root = await mkdtemp(join(tmpdir(), 'arcadia-packaged-mcp-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const sdk = await packagedSdk(root)
    const addon = join(root, 'cards')
    const cup = join(root, 'cup')
    const consumer = join(root, 'workbench')
    await sdk.run(root, 'init', 'pack', addon)
    await sdk.run(root, 'init', 'environment', cup)
    await sdk.run(root, 'init', 'pack', consumer)

    await sdk.session(addon, ['--read-only'], async call => {
      const event = await call('author_reference', { symbol: 'EffectTrigger.OnHit' })
      assert.equal(event.parent, 'UseSkillContext')
      const search = await call('author_reference', { query: 'bindAttribute' })
      assert.equal(
        search.matches.find(item => item.symbol === 'ops.bindAttribute')?.path,
        '/sdk/values/ops/bindAttribute',
      )
      const binding = await call('author_reference', { symbol: 'ops.bindAttribute' })
      assert.equal(binding.url, 'https://arcadia-creator-docs.pages.dev/sdk/values/ops/bindAttribute')
      const field = await call('author_reference', { symbol: 'BattleMessageData.DAMAGE.currentHp' })
      assert.equal(field.path, '/sdk/types/BattleMessageData/DAMAGE#member-currentHp')
      const lesson = await call('author_reference', { topic: 'tutorials', symbol: 'frost-strike.trace' })
      assert.equal(lesson.path, '/tutorials/frost-strike/trace')
      assert.equal(
        lesson.markdownUrl,
        'https://arcadia-creator-docs.pages.dev/reference/tutorials/frost-strike/trace.md',
      )
      assert.match((await call('author_reference', { symbol: 'Pet.addMark' })).signature, /AddMarkContext/)
      const guide = await call('author_reference', { topic: 'tutorials', symbol: 'frost-strike' })
      const hit = await call('author_reference', { topic: 'effects', symbol: 'Pet.addMark' })
      assert.equal(guide.url, 'https://arcadia-creator-docs.pages.dev/frost-strike')
      assert.equal(hit.markdownUrl, 'https://arcadia-creator-docs.pages.dev/reference/api/on-hit.md')
    })

    const addonFile = join(addon, 'package.json')
    const addonManifest = JSON.parse(await readFile(addonFile, 'utf8'))
    addonManifest.scripts.postinstall = 'node -e "process.exit(73)"'
    await writeFile(addonFile, JSON.stringify(addonManifest))
    const packedAddon = await sdk.session(addon, ['--execute'], (_call, job) => job('package_build'))
    for (const directory of [consumer, cup]) {
      await mkdir(join(directory, 'candidates'), { recursive: true })
      await copyFile(join(addon, packedAddon.filename), join(directory, 'candidates/cards.tgz'))
      await sdk.session(directory, [], async call => {
        const { version, text } = await call('source_read', { file: 'package.json' })
        const manifest = JSON.parse(text)
        manifest.dependencies = { [addonManifest.name]: 'file:candidates/cards.tgz' }
        const saved = await call('source_apply', {
          file: 'package.json',
          expectedVersion: version,
          text: JSON.stringify(manifest),
        })
        const installed = await call('dependency_install', { expectedVersion: saved.version, offline: true })
        assert.equal(installed.manifestVersion, saved.version)
        assert.ok(
          installed.packages.some(
            member => member.name === addonManifest.name && member.version === addonManifest.version,
          ),
        )
        assert.ok(installed.installationDigest)
      })
    }
    async function readInstalledCard(call) {
      const page = await call('content_query', {
        scope: 'dependencies',
        contentKind: 'skills',
        id: 'strike',
        packageName: addonManifest.name,
      })
      assert.equal(page.total, 1, JSON.stringify(page.diagnostics))
      assert.equal(page.items[0].qualifiedId, 'cards:strike')
      assert.equal(page.items[0].readOnly, true)
    }
    await sdk.session(consumer, [], readInstalledCard)
    for (const file of ['blue.yaml', 'orange.yaml']) {
      await copyFile(join(addon, 'debug/teams', file), join(cup, 'debug/teams', file))
    }
    const recipe = await sdk.session(cup, ['--execute'], async (call, job) => {
      await readInstalledCard(call)
      return await job('package_build')
    })
    const listing = []
    await list({ file: join(cup, recipe.filename), onentry: entry => listing.push(entry.path) })
    assert.ok(listing.includes('package/package.json'))
    assert.ok(!listing.includes('package/environment.json'))
    const source = { kind: 'archive', file: 'candidates/cup.tgz' }
    const archive = join(consumer, source.file)
    await copyFile(join(cup, recipe.filename), archive)
    const expectedIntegrity =
      'sha512-' +
      createHash('sha512')
        .update(await readFile(archive))
        .digest('base64')
    const installed = await sdk.session(consumer, [], call => call('environment_install', { source, offline: true }))
    assert.equal(installed.id, 'cup')
    assert.equal(installed.integrity, expectedIntegrity)
    // A new MCP process can work after every input artifact and its authoring project is gone.
    await rm(addon, { recursive: true })
    await rm(cup, { recursive: true })
    await rm(join(consumer, 'candidates'), { recursive: true })
    await sdk.session(installed.directory, ['--execute'], async (call, job) => {
      assert.equal((await call('workspace_describe')).project.kind, 'environment')
      await readInstalledCard(call)
      const demo = await job('demo_start', { seed: 'installed-cup' })
      assert.equal(demo.candidate.environmentId, installed.id)
      assert.deepEqual(demo.candidate.members, [{ name: addonManifest.name, version: addonManifest.version }])
      assert.ok(demo.turns > 0)
    })
  },
)
