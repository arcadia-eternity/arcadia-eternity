import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, copyFile, symlink } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { nativeBuildIdentity } from '@arcadia-eternity/battle/build'
import { prepareNpmProject, resolveNpmInvocation } from '@arcadia-eternity/pack-loader/node'
import { packBuiltProject } from '../src/pack-project.mjs'

const exec = promisify(execFile)
async function fixture(t, { files = ['dist/content.json'] } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-prebuilt-pack-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const project = join(root, 'author'),
    cache = join(root, 'cache')
  await mkdir(join(project, 'dist'), { recursive: true })
  await mkdir(join(project, 'node_modules', 'artifact-helper'), { recursive: true })
  const manifest = {
    name: '@test/prebuilt-pack',
    version: '1.0.0',
    type: 'module',
    files,
    devDependencies: { 'artifact-helper': '1.0.0' },
    scripts: { prepack: 'exit 99', postinstall: 'exit 99' },
    arcadia: {
      formatVersion: 1,
      projectId: 'prebuilt-pack',
      namespace: 'prebuilt-pack',
      content: 'dist/content.json',
      effects: 'dist/effects.js',
      sdkApi: 2,
    },
  }
  const original = JSON.stringify(manifest, null, 2) + '\n'
  await writeFile(join(project, 'package.json'), original)
  await writeFile(
    join(project, 'dist/content.json'),
    JSON.stringify({ data: { skills: [], marks: [], species: [], behaviors: [] } }),
  )
  await writeFile(
    join(project, 'node_modules/artifact-helper/package.json'),
    JSON.stringify({ name: 'artifact-helper', version: '1.0.0', type: 'module', main: 'index.js' }),
  )
  await writeFile(
    join(project, 'node_modules/artifact-helper/index.js'),
    'export const bundled = "DEPENDENCY_BUNDLED_IN_ARTIFACT";\n',
  )
  await writeFile(
    join(project, 'dist/effects.js'),
    `import {bundled} from 'artifact-helper';
globalThis.__arcadiaPrebuiltPackExecuted = true;
throw new Error('AUTHOR_MODULE_MUST_NOT_EXECUTE_DURING_PACK_OR_PREPARATION');
export function createEffects(){return [bundled]}
`,
  )
  return { root, project, cache, original }
}

test('author packaging embeds a closed effect artifact and clean consumers prepare without compiling or executing', async t => {
  const { root, project, cache, original } = await fixture(t)
  const packed = await packBuiltProject(project, { cache })
  assert.equal(await readFile(join(project, 'package.json'), 'utf8'), original)
  assert.equal(globalThis.__arcadiaPrebuiltPackExecuted, undefined)
  assert.ok(packed.integrity)
  assert.ok(packed.files.some(file => file.path === 'dist/arcadia-effects.json'))
  assert.equal(
    packed.files.some(file => file.path === 'dist/effects.js'),
    false,
  )
  await assert.rejects(readFile(join(project, 'dist/arcadia-effects.json')), { code: 'ENOENT' })

  const consumer = join(root, 'consumer')
  await mkdir(consumer)
  await copyFile(join(project, packed.filename), join(consumer, 'content.tgz'))
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({
      name: 'clean-consumer',
      private: true,
      dependencies: { '@test/prebuilt-pack': 'file:content.tgz' },
    }),
  )
  const npm = await resolveNpmInvocation([
    'install',
    '--offline',
    '--ignore-scripts',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    '--cache',
    cache,
  ])
  await exec(npm.file, npm.args, { cwd: consumer })
  const installed = join(consumer, 'node_modules/@test/prebuilt-pack')
  const published = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
  assert.equal(published.arcadia.effectArtifact, 'dist/arcadia-effects.json')
  assert.equal(published.arcadia.effects, undefined)
  const artifact = JSON.parse(await readFile(join(installed, published.arcadia.effectArtifact), 'utf8'))
  assert.equal(artifact.packageId, '@test/prebuilt-pack')
  assert.match(artifact.source, /DEPENDENCY_BUNDLED_IN_ARTIFACT/)
  assert.match(artifact.source, /AUTHOR_MODULE_MUST_NOT_EXECUTE/)
  await assert.rejects(readFile(join(consumer, 'node_modules/artifact-helper/package.json')), { code: 'ENOENT' })
  for (const profile of ['self-hosted', 'official']) {
    const environment = await prepareNpmProject(
      consumer,
      {
        build: nativeBuildIdentity,
        base: { marks: [], skills: [], species: [] },
        templates: [],
      },
      { policy: { profile } },
      { effectPreparation: 'prebuilt-only' },
    )
    try {
      assert.ok(environment.revision)
      assert.equal(environment.sandbox.modules.at(-1).artifact.source, artifact.source)
      assert.equal(globalThis.__arcadiaPrebuiltPackExecuted, undefined)
    } finally {
      await environment.dispose()
    }
  }
})

test('packaging retains intended source files and source manifest when effects are included', async t => {
  const { project, cache, original } = await fixture(t, { files: ['dist'] })
  const packed = await packBuiltProject(project, { cache })
  assert.ok(packed.files.some(file => file.path === 'dist/effects.js'))
  assert.ok(packed.files.some(file => file.path === 'dist/arcadia-effects.json'))
  assert.equal(await readFile(join(project, 'package.json'), 'utf8'), original)
})

test('author packaging rejects effect source symlinks outside the project without changing its manifest', async t => {
  const { root, project, cache, original } = await fixture(t)
  await writeFile(join(root, 'outside.js'), 'export function createEffects(){return []}')
  await rm(join(project, 'dist/effects.js'))
  await symlink(join(root, 'outside.js'), join(project, 'dist/effects.js'))
  await assert.rejects(packBuiltProject(project, { cache }), /regular file inside the project/)
  assert.equal(await readFile(join(project, 'package.json'), 'utf8'), original)
})

test('author package staging cannot follow a linked private workspace directory', async t => {
  const { root, project, cache, original } = await fixture(t)
  const outside = join(root, 'outside')
  await mkdir(outside)
  await symlink(outside, join(project, '.arcadia'))
  await assert.rejects(packBuiltProject(project, { cache }), /staging must be a regular directory/)
  assert.deepEqual(await readdir(outside), [])
  assert.equal(await readFile(join(project, 'package.json'), 'utf8'), original)
})

test('the author pack CLI emits its existing receipt with the generated artifact', async t => {
  const { project, cache, original } = await fixture(t, { files: ['dist'] })
  await mkdir(join(project, 'src'))
  await mkdir(join(project, 'data'))
  await writeFile(
    join(project, 'src/effects.ts'),
    (await readFile(join(project, 'dist/effects.js'), 'utf8')) +
      '\ndeclare global { var __arcadiaPrebuiltPackExecuted: boolean }\n',
  )
  await writeFile(join(project, 'node_modules/artifact-helper/index.d.ts'), 'export const bundled: string\n')
  await writeFile(
    join(project, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        rootDir: 'src',
        outDir: 'dist',
        types: [],
      },
      include: ['src/**/*.ts'],
    }),
  )
  const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url))
  const result = await exec(process.execPath, [cli, 'pack'], {
    cwd: project,
    env: { ...process.env, npm_config_cache: cache },
  })
  const receipt = JSON.parse(
    result.stdout
      .split('\n')
      .find(line => line.startsWith('ARCADIA_RESULT='))
      .slice('ARCADIA_RESULT='.length),
  )
  assert.ok(receipt.files.includes('dist/arcadia-effects.json'))
  assert.ok(receipt.integrity.startsWith('sha512-'))
  assert.match(receipt.shasum, /^[a-f0-9]{40}$/)
  assert.ok((await readFile(join(project, receipt.filename))).length > 0)
  assert.equal(await readFile(join(project, 'package.json'), 'utf8'), original)
})

test(
  'source changes after capture reject packaging and preserve the last successful archive',
  { timeout: 15000 },
  async t => {
    const { project, cache } = await fixture(t)
    const successful = await packBuiltProject(project, { cache })
    const previous = await readFile(join(project, successful.filename))
    let changed = false,
      finished = false
    const staging = join(project, '.arcadia/package-staging')
    const monitor = (async () => {
      while (!finished && !changed) {
        for (const entry of await readdir(staging)) {
          const exists = await readFile(join(staging, entry, 'package/dist/arcadia-effects.json')).then(
            () => true,
            error => {
              if (error.code === 'ENOENT') return false
              throw error
            },
          )
          if (!exists) continue
          changed = true
          await writeFile(
            join(project, 'dist/content.json'),
            '{"data":{"skills":[],"marks":[],"species":[],"behaviors":[]},"changed":true}',
          )
          break
        }
        if (!changed) await delay(5)
      }
    })()
    try {
      await assert.rejects(packBuiltProject(project, { cache }), /source changed during capture/)
      assert.ok(changed, 'the external edit was made after the closed artifact was staged')
      await monitor
      assert.deepEqual(await readFile(join(project, successful.filename)), previous)
      assert.deepEqual(await readdir(staging), [])
    } finally {
      finished = true
      await monitor
    }
  },
)
