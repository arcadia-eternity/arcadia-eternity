import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Command } from 'commander'
import { inspectNpmProject } from '@arcadia-eternity/pack-loader/node'
import { prepareDevPreview } from '../src/commands/dev-preview'
import { registerCommands } from '../src/commands/register'

vi.setConfig({ testTimeout: 60000 })
let temporary: string
const previousCache = process.env.npm_config_cache

async function exists(path: string) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
async function fixture(name: string) {
  const source = join(temporary, name)
  const marker = join(temporary, `${name}-ran`)
  await mkdir(source)
  await mkdir(join(source, 'dist'))
  await cp(resolve(import.meta.dirname, '../../../examples/ugc/slow/content.json'), join(source, 'content.json'))
  await writeFile(
    join(source, 'package.json'),
    JSON.stringify({
      name: '@arcadia-example/slow',
      version: '1.0.0',
      type: 'module',
      files: ['content.json', 'dist', '*.cjs'],
      scripts: {
        build: 'node build.cjs',
        prebuild: 'node lifecycle.cjs',
        postbuild: 'node lifecycle.cjs',
        prepack: 'node lifecycle.cjs',
        postpack: 'node lifecycle.cjs',
        install: 'node lifecycle.cjs',
      },
      arcadia: {
        formatVersion: 1,
        projectId: 'example-slow',
        namespace: 'example-slow',
        content: 'content.json',
        effects: 'dist/effects.js',
        sdkApi: 2,
      },
    }),
  )
  await writeFile(
    join(source, 'lifecycle.cjs'),
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'lifecycle')`,
  )
  await writeFile(
    join(source, 'build.cjs'),
    `require('node:fs').writeFileSync(${JSON.stringify(marker + '-build')}, 'build'); require('node:fs').writeFileSync('dist/effects.js', 'export const built = true\\n')`,
  )
  await writeFile(
    join(source, 'dist/effects.js'),
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker + '-effect')}, 'effect')\n`,
  )
  return { source, marker }
}

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'arcadia-dev-preview-'))
  process.env.npm_config_cache = join(temporary, 'npm-cache')
})
afterAll(async () => {
  if (previousCache === undefined) delete process.env.npm_config_cache
  else process.env.npm_config_cache = previousCache
  if (temporary) await rm(temporary, { recursive: true, force: true })
})

it('packages prebuilt content without running author or installation code and makes an isolated inspectable candidate', async () => {
  const { source, marker } = await fixture('no-execution')
  const destination = join(temporary, 'candidate')
  const result = await prepareDevPreview(source, destination, { offline: true })
  expect(result).toMatchObject({ candidateDirectory: await realpath(destination), buildExecuted: false })
  expect(result.sourceRevision).toBeTruthy()
  expect(result.packageDigest).toBeTruthy()
  expect(result.installationDigest).toBeTruthy()
  const inspection = await inspectNpmProject(destination)
  expect(inspection.digest).toBe(result.installationDigest)
  expect(inspection.packages.map(pkg => pkg.name)).toContain('@arcadia-example/slow')
  expect(await exists(join(destination, 'arcadia-admission.json'))).toBe(false)
  expect(await exists(marker)).toBe(false)
  expect(await exists(marker + '-build')).toBe(false)
  expect(await exists(marker + '-effect')).toBe(false)
  await writeFile(join(source, 'dist/effects.js'), 'changed after candidate creation')
  expect((await inspectNpmProject(destination)).digest).toBe(result.installationDigest)
  await writeFile(join(source, 'content.json'), (await readFile(join(source, 'content.json'), 'utf8')) + '\n')
  let output = ''
  const command = new Command().exitOverride()
  registerCommands(command, {
    cwd: temporary,
    signal: new AbortController().signal,
    stdout: async text => {
      output += text
    },
    stderr: async () => {},
  })
  const next = join(temporary, 'next-candidate')
  await command.parseAsync(['content', 'dev', 'prepare', source, next, '--offline', '--json'], { from: 'user' })
  const nextResult = JSON.parse(output)
  expect(nextResult.sourceRevision).not.toBe(result.sourceRevision)
  expect(nextResult.packageDigest).not.toBe(result.packageDigest)
  expect((await inspectNpmProject(destination)).digest).toBe(result.installationDigest)
})

it('runs build only when explicitly requested while still suppressing package and install lifecycle scripts', async () => {
  const { source, marker } = await fixture('authorized-build')
  const destination = join(temporary, 'built-candidate')
  const result = await prepareDevPreview(source, destination, { runBuild: true, offline: true })
  expect(result.buildExecuted).toBe(true)
  expect(await readFile(marker + '-build', 'utf8')).toBe('build')
  expect(await exists(marker)).toBe(false)
  expect(await exists(marker + '-effect')).toBe(false)
  expect((await inspectNpmProject(destination)).digest).toBe(result.installationDigest)
  expect(await readFile(join(destination, 'node_modules/@arcadia-example/slow/dist/effects.js'), 'utf8')).toContain(
    'built = true',
  )
})

it('refuses to replace an existing candidate before running any build', async () => {
  const { source, marker } = await fixture('existing-destination-source')
  const destination = join(temporary, 'existing-destination')
  await mkdir(destination)
  await writeFile(join(destination, 'keep.txt'), 'keep')
  await expect(prepareDevPreview(source, destination, { runBuild: true, offline: true })).rejects.toThrow()
  expect(await readFile(join(destination, 'keep.txt'), 'utf8')).toBe('keep')
  expect(await exists(marker + '-build')).toBe(false)
  expect(await exists(marker)).toBe(false)
})

it('rejects a build that changes source and does not publish a candidate', async () => {
  const { source, marker } = await fixture('changed-during-build')
  const destination = join(temporary, 'changed-candidate')
  await writeFile(join(source, 'build.cjs'), "require('node:fs').writeFileSync('unexpected-source.js', 'changed')\n")
  await expect(prepareDevPreview(source, destination, { runBuild: true, offline: true })).rejects.toMatchObject({
    code: 'DEV_SOURCE_CHANGED',
  })
  expect(await exists(destination)).toBe(false)
  expect(await exists(marker)).toBe(false)
})
