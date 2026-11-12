import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { ArenaEffectModule, type EffectModuleArtifact } from '@arcadia-eternity/battle/sandbox/effects'
import * as compiler from '../src/npm/effect-artifact'
import { parseNpmPackOutput } from '../src/npm/pack-output'
import { readPrebuiltEffectModule, validatePrebuiltEffectModule } from '../src/npm/prebuilt-artifact'
import { prepareNpmProject, type NpmContentHost, type PreparedNpmEnvironment } from '../src/npm/prepare'

const execute = promisify(execFile)
const packageId = '@arcadia-test/prebuilt'
const host: NpmContentHost = {
  build: { formatVersion: 1, coreBuildId: 'a'.repeat(64), registryBuildId: 'b'.repeat(64) },
  base: { marks: [], skills: [], species: [] },
  templates: [],
}
const approval = { policy: { profile: 'self-hosted' } }
let root: string, project: string, authorArtifact: EffectModuleArtifact
const environments: Readonly<PreparedNpmEnvironment>[] = []

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'arcadia-prebuilt-'))
  const source = join(root, 'author')
  await mkdir(source)
  await writeFile(
    join(source, 'package.json'),
    JSON.stringify({
      name: packageId,
      version: '1.0.0',
      type: 'module',
      files: ['content.json', 'effects.js', 'effects.artifact.json'],
      arcadia: {
        formatVersion: 1,
        projectId: 'prebuilt',
        namespace: 'prebuilt',
        content: 'content.json',
        effects: 'effects.js',
        effectArtifact: 'effects.artifact.json',
        sdkApi: 2,
      },
    }),
  )
  await writeFile(
    join(source, 'content.json'),
    JSON.stringify({ data: { species: [], skills: [], marks: [], behaviors: [] } }),
  )
  await writeFile(
    join(source, 'effects.js'),
    `globalThis.officialHostAuthorExecuted = true; throw Error('only actual sandbox may run this'); export function createEffects(){ return [] }`,
  )
  authorArtifact = await compiler.compileEffectModule(join(source, 'effects.js'), source, packageId)
  await writeFile(join(source, 'effects.artifact.json'), JSON.stringify(authorArtifact))
  const packed = await execute('npm', ['pack', '--ignore-scripts', '--json'], { cwd: source })
  project = join(root, 'project')
  await mkdir(project)
  await writeFile(
    join(project, 'package.json'),
    JSON.stringify({
      private: true,
      dependencies: { [packageId]: `file:${join(source, parseNpmPackOutput(packed.stdout)[0].filename)}` },
    }),
  )
  await execute('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: project })
}, 30000)
afterEach(async () => {
  vi.restoreAllMocks()
  for (const environment of environments.splice(0)) await environment.dispose()
  expect(Reflect.get(globalThis, 'officialHostAuthorExecuted')).toBeUndefined()
})
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})
async function copyProject() {
  const target = await mkdtemp(join(root, 'case-'))
  await cp(project, target, { recursive: true })
  return { target, packageRoot: join(target, 'node_modules', packageId) }
}
async function prepare(directory = project, effectPreparation: 'compile' | 'prebuilt-only' = 'prebuilt-only') {
  const prepared = await prepareNpmProject(directory, host, approval, { effectPreparation })
  environments.push(prepared)
  return prepared
}

it('loads a real author-produced packed artifact without compiler, VM or author evaluation', async () => {
  const compile = vi.spyOn(compiler, 'compileEffectModule').mockRejectedValue(new Error('HOST_COMPILER_FORBIDDEN'))
  const vm = vi.spyOn(ArenaEffectModule, 'prepare').mockRejectedValue(new Error('HOST_VM_FORBIDDEN'))
  const prepared = await prepare()
  expect(compile).not.toHaveBeenCalled()
  expect(vm).not.toHaveBeenCalled()
  expect(prepared.sandbox.modules).toHaveLength(1)
  expect(prepared.sandbox.modules[0].artifact).toEqual(authorArtifact)
  expect(Object.isFrozen(prepared.sandbox.modules[0].artifact)).toBe(true)
  expect(prepared.sandbox.modules[0].artifact.source).toContain('only actual sandbox may run this')
})

it('uses the same published canonical artifact and environment identity in ordinary and prebuilt-only modes', async () => {
  const compile = vi
    .spyOn(compiler, 'compileEffectModule')
    .mockRejectedValue(new Error('SHOULD_USE_PUBLISHED_ARTIFACT'))
  const ordinary = await prepare(project, 'compile')
  const peer = await prepare()
  expect(ordinary.revision).toBe(peer.revision)
  expect(ordinary.sandbox.revision).toBe(peer.sandbox.revision)
  expect(ordinary.sandbox.modules).toEqual(peer.sandbox.modules)
  expect(compile).not.toHaveBeenCalled()
})

it('supports artifact-only packages without raw effect sources', async () => {
  const { target, packageRoot } = await copyProject()
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  delete manifest.arcadia.effects
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify(manifest))
  await rm(join(packageRoot, 'effects.js'))
  const compile = vi.spyOn(compiler, 'compileEffectModule').mockRejectedValue(new Error('NO_SOURCE_FALLBACK'))
  expect((await prepare(target)).sandbox.modules[0].artifact).toEqual(authorArtifact)
  expect(compile).not.toHaveBeenCalled()
})

it('registers effect attachments from artifact-only providers without invoking factories', async () => {
  const { target, packageRoot } = await copyProject()
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  delete manifest.arcadia.effects
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify(manifest))
  await rm(join(packageRoot, 'effects.js'))
  await writeFile(
    join(packageRoot, 'content.json'),
    JSON.stringify({
      data: {
        species: [],
        marks: [],
        behaviors: [],
        skills: [
          {
            id: 'strike',
            element: 'Normal',
            category: 'Physical',
            power: 1,
            rage: 0,
            accuracy: 100,
            behaviors: [
              { useId: 'hit', definitionId: { $ref: { projectId: 'prebuilt', kind: 'behavior', id: 'on-hit' } } },
            ],
          },
        ],
      },
    }),
  )
  const vm = vi.spyOn(ArenaEffectModule, 'prepare').mockRejectedValue(new Error('NO_DYNAMIC_VALIDATION'))
  const prepared = await prepare(target)
  expect(prepared.content.getSkill('prebuilt:strike').power).toBe(1)
  expect(prepared.data.behaviors?.some(definition => definition.id === 'prebuilt:on-hit')).toBe(true)
  expect(vm).not.toHaveBeenCalled()
})

it('fails closed when a code package does not declare a prebuilt artifact', async () => {
  const { target, packageRoot } = await copyProject()
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  delete manifest.arcadia.effectArtifact
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify(manifest))
  const compile = vi.spyOn(compiler, 'compileEffectModule').mockRejectedValue(new Error('NO_COMPILER_FALLBACK'))
  await expect(prepare(target)).rejects.toMatchObject({ diagnostics: [{ code: 'NPM_ARTIFACT_REQUIRED' }] })
  expect(compile).not.toHaveBeenCalled()
})

it.each([
  ['wrong identity', { packageId: '@arcadia-test/someone-else' }],
  ['unknown format', { format: 'custom-artifact' }],
  ['future schema', { version: 2 }],
  ['SDK mismatch', { sdkApi: 3 }],
  ['nontext source', { source: {} }],
  ['unknown envelope fields', { permissions: ['filesystem'] }],
])('rejects %s without compiling a declared fallback source', async (_name, patch) => {
  const { target, packageRoot } = await copyProject()
  await writeFile(join(packageRoot, 'effects.artifact.json'), JSON.stringify({ ...authorArtifact, ...patch }))
  const compile = vi.spyOn(compiler, 'compileEffectModule').mockRejectedValue(new Error('NO_COMPILER_FALLBACK'))
  await expect(prepare(target, 'compile')).rejects.toMatchObject({ diagnostics: [{ code: 'NPM_ARTIFACT_INVALID' }] })
  expect(compile).not.toHaveBeenCalled()
})

it.each([
  "import fs from 'node:fs'; export function createEffects(){return []}",
  "export {value} from './outside.js'",
  "export function createEffects(){return import('https://example.com/code.js')}",
  'export function createEffects(){return import(globalThis.location)}',
])('rejects unresolved or privileged imports in artifact text', source => {
  expect(() => validatePrebuiltEffectModule({ ...authorArtifact, source }, packageId)).toThrow()
})

it('rejects oversized decoded source, malformed JSON and an escaping artifact symlink', async () => {
  expect(() =>
    validatePrebuiltEffectModule({ ...authorArtifact, source: 'x'.repeat(4 * 1024 * 1024 + 1) }, packageId),
  ).toThrow()
  const malformed = join(root, 'malformed.json')
  await writeFile(malformed, '{broken')
  await expect(readPrebuiltEffectModule(malformed, root, packageId)).rejects.toMatchObject({
    diagnostics: [{ code: 'NPM_ARTIFACT_INVALID' }],
  })
  const boundary = join(root, 'boundary')
  await mkdir(boundary)
  const escape = join(boundary, 'outside.json')
  await symlink(join(project, 'node_modules', packageId, 'effects.artifact.json'), escape)
  await expect(readPrebuiltEffectModule(escape, boundary, packageId)).rejects.toMatchObject({
    diagnostics: [{ code: 'NPM_ARTIFACT_FILE' }],
  })
})

it('forces official admission onto prebuilt-only even if callers omit preparation options', async () => {
  const { target, packageRoot } = await copyProject()
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  delete manifest.arcadia.effectArtifact
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify(manifest))
  const compile = vi.spyOn(compiler, 'compileEffectModule').mockRejectedValue(new Error('OFFICIAL_COMPILER_FORBIDDEN'))
  await expect(prepareNpmProject(target, host, { policy: { profile: 'official' } })).rejects.toMatchObject({
    diagnostics: [{ code: 'NPM_ARTIFACT_REQUIRED' }],
  })
  await expect(
    prepareNpmProject(project, host, { policy: { profile: 'official' } }, { effectPreparation: 'compile' }),
  ).rejects.toMatchObject({ diagnostics: [{ code: 'NPM_PREPARATION_POLICY' }] })
  const prepared = await prepareNpmProject(project, host, { policy: { profile: 'official' } })
  environments.push(prepared)
  expect(prepared.sandbox.modules[0].artifact).toEqual(authorArtifact)
  expect(compile).not.toHaveBeenCalled()
})
