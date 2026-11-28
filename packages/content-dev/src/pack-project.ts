import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { Stats } from 'node:fs'
import {
  compileEffectModule,
  emptyNpmContentHost,
  parseNpmPackOutput,
  prepareNpmProject,
  resolveNpmInvocation,
} from '@arcadia-eternity/pack-loader/node'
import type { PresentationManifest } from '@arcadia-eternity/schema'
import { AuthorWorkspace, type PackageManifest } from './workspace.ts'
import { ProjectTeams } from './project-teams.ts'
import { environmentProjectDocument } from './debug-environments.ts'
import { assertEnvironmentRequirements, prepareEnvironmentRules } from './environment-rules.ts'
import { releasePayload, normalizeReleaseArchive, requireClientRange } from '../release-payload.mjs'
import { ManagedProjects } from './managed-projects.ts'
import { errorCode } from './types.ts'

const exec = promisify(execFile)
const artifactFile = 'dist/arcadia-effects.json'
const distributionMetadata = /^(?:package\.json|readme(?:\..+)?|licen[cs]e(?:\..+)?|notice(?:\..+)?)$/i
function fail(message: string): never {
  throw new Error(message)
}
function packagePath(file: unknown): string {
  if (
    typeof file !== 'string' ||
    !file ||
    file.includes('\\') ||
    file.includes('\0') ||
    isAbsolute(file) ||
    file.split('/').some(part => !part || ['.', '..', '.arcadia', '.git', 'node_modules'].includes(part))
  )
    fail('npm returned an unsafe package path')
  return file
}
async function npm(root: string, args: string[], cache: string | undefined) {
  const invocation = await resolveNpmInvocation([...args, ...(cache ? ['--cache', resolve(cache)] : [])])
  return exec(invocation.file, invocation.args, { cwd: root, maxBuffer: 32 * 1024 * 1024, timeout: 120000 })
}
interface CapturedSource {
  path: string
  canonical: string
  info: Stats
}

async function sourceFile(root: string, file: string): Promise<CapturedSource> {
  const path = join(root, packagePath(file)),
    canonical = await realpath(path),
    info = await lstat(path)
  const location = relative(root, canonical)
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    isAbsolute(location) ||
    location === '..' ||
    location.startsWith('../') ||
    location.startsWith('..\\')
  )
    fail(`Package source must be a regular file inside the project: ${file}`)
  return { path, canonical, info }
}
const sameFile = (before: Stats, after: Stats) =>
  before.size === after.size &&
  before.mtimeMs === after.mtimeMs &&
  before.ctimeMs === after.ctimeMs &&
  before.ino === after.ino
async function verifyCapture(sources: Map<string, CapturedSource>) {
  for (const source of sources.values()) {
    const after = await lstat(source.path)
    if (!sameFile(source.info, after) || (await realpath(source.path)) !== source.canonical)
      fail(`Package source changed during capture: ${source.path}`)
  }
}
async function stagingRoot(root: string): Promise<string> {
  let directory = root
  for (const part of ['.arcadia', 'package-staging']) {
    directory = join(directory, part)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(directory)) !== directory)
      fail('Package staging must be a regular directory inside the author workspace')
  }
  return directory
}

async function verifyRelease(directory: string, archive: string, name: string) {
  const project = join(directory, 'consumer')
  await mkdir(join(project, 'candidates'), { recursive: true })
  await copyFile(archive, join(project, 'candidates/release.tgz'))
  const installer = new ManagedProjects(join(directory, 'installer'), { allowThirdPartyContent: true })
  try {
    await installer.prepareProject(
      {
        schemaVersion: 1,
        id: 'release',
        name: '发行检查',
        packages: { [name]: 'file:candidates/release.tgz' },
        sources: [],
      },
      { projectDirectory: project },
      async installed => {
        const prepared = await prepareNpmProject(
          installed,
          emptyNpmContentHost,
          { policy: { profile: 'local-development' } },
          { effectPreparation: 'prebuilt-only' },
        )
        await prepared.dispose()
      },
    )
  } finally {
    await installer.close()
  }
}

// A release recipe must install from the public registry in a clean directory.
async function verifyEnvironmentRelease(directory: string, archive: string) {
  const { acquireAuthorEnvironment } = await import('./author-environment-source.ts')
  const { installAuthorDependencies } = await import('./author-install.ts')
  const acquired = await acquireAuthorEnvironment({ kind: 'archive', file: archive }, join(directory, 'consumer'))
  const consumer = await AuthorWorkspace.open(acquired.directory, { watch: false })
  try {
    const manifest = await consumer.read('package.json')
    const installed = await installAuthorDependencies(consumer, { expectedVersion: manifest.version })
    const prepared = await prepareNpmProject(
      installed.directory,
      emptyNpmContentHost,
      { policy: { profile: 'local-development' } },
      { effectPreparation: 'prebuilt-only' },
    )
    await prepared.dispose()
  } finally {
    await consumer.close()
  }
}

const releaseRepository = (value: unknown) => {
  const raw =
    typeof value === 'string'
      ? value
      : value && typeof value === 'object'
        ? (value as { url?: unknown }).url
        : undefined
  if (typeof raw !== 'string' || !/^(?:git\+)?https:\/\//.test(raw)) return undefined
  const url = new URL(raw.replace(/^git\+/, ''))
  if (url.username || url.password || url.search || url.hash) fail('发行仓库地址不能包含凭据、查询参数或片段')
  return { type: 'git', url: 'git+' + url.href }
}

// Environment archives carry the declarative recipe and its portable inputs.
export async function packEnvironmentProject(directory: string, { release = false }: { release?: boolean } = {}) {
  const workspace = await AuthorWorkspace.open(directory, { watch: false })
  let temporary: string | undefined
  try {
    await workspace.assertWritable()
    const manifestSource = await workspace.read('package.json')
    const manifest = JSON.parse(manifestSource.text) as PackageManifest
    const document = environmentProjectDocument(manifest)
    assertEnvironmentRequirements(document.requires)
    prepareEnvironmentRules(document.rules)
    if (document.sources.length)
      throw new Error('请先把本机源码依赖打包，改用已发布版本或 file:candidates/*.tgz 后再分发环境。')
    const { packages: dependencies, ...arcadiaEnvironment } = document
    if (release) {
      requireClientRange(manifest)
      if (typeof manifest.license !== 'string' || !manifest.license.trim()) fail('请先设置 package.json 的 license')
      for (const [name, spec] of Object.entries(dependencies))
        if (spec.startsWith('file:')) fail(`发行环境的依赖须使用 npm 版本或范围，请先发布 ${name} 并改用其版本号`)
    }
    const teamLibrary = new ProjectTeams(workspace)
    const teams = await teamLibrary.list()
    const files = new Set(teams.map(team => teamLibrary.file(team.id)))
    for (const spec of Object.values(dependencies)) {
      if (spec.startsWith('file:')) files.add(spec.slice(5))
    }
    if (release) {
      const license = (await workspace.files()).find(entry => /^licen[cs]e(?:\.(?:md|txt))?$/i.test(entry.file))
      if (!license) fail('发行环境缺少 LICENSE 文件')
      files.add(license.file)
    }
    temporary = await mkdtemp(join(await stagingRoot(workspace.root), 'environment-'))
    const payload = join(temporary, 'package')
    await mkdir(payload)
    const captured = new Map<string, CapturedSource>()
    for (const file of files) {
      const source = await sourceFile(workspace.root, file)
      captured.set(source.path, source)
      const target = join(payload, file)
      await mkdir(dirname(target), { recursive: true })
      await copyFile(source.path, target)
    }
    const repository = release ? releaseRepository(manifest.repository) : undefined
    const recipe = {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      license: manifest.license,
      ...(repository && { repository }),
      engines: release
        ? { arcadia: (manifest.engines as { arcadia?: string } | undefined)?.arcadia }
        : manifest.engines,
      ...(!release && { private: manifest.private }),
      files: [...files],
      dependencies,
      arcadiaEnvironment,
    }
    await writeFile(join(payload, 'package.json'), JSON.stringify(recipe, null, 2) + '\n')
    const packed = parseNpmPackOutput(
      String(
        (
          await npm(
            payload,
            ['pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', temporary],
            process.env.npm_config_cache ?? join(temporary, 'cache'),
          )
        ).stdout,
      ),
    )[0]
    if (!packed || !packed.shasum || basename(packagePath(packed.filename)) !== packed.filename)
      fail('npm returned an invalid environment package receipt')
    const actual = new Set(packed.files.map(file => file.path))
    if (actual.size !== files.size + 1 || !actual.has('package.json') || [...files].some(file => !actual.has(file)))
      fail('Environment archive does not match the declared files')
    if (release) {
      Object.assign(packed, await normalizeReleaseArchive(join(temporary, packed.filename)))
      await verifyEnvironmentRelease(temporary, join(temporary, packed.filename))
    }
    await verifyCapture(captured)
    if ((await workspace.read('package.json')).version !== manifestSource.version)
      fail('Environment manifest changed during packaging')
    await rename(join(temporary, packed.filename), join(workspace.root, packed.filename))
    return packed
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true })
    await workspace.close()
  }
}

/** Trusted author packaging: close the effect dependency graph without evaluating it.
 * Only the staged package gains artifact metadata; the source manifest is never rewritten.
 */
export async function packBuiltProject(
  directory: string = process.cwd(),
  { cache, release = false }: { cache?: string; release?: boolean } = {},
) {
  const root = await realpath(resolve(directory))
  const manifestText = await readFile(join(root, 'package.json'), 'utf8')
  const manifest = JSON.parse(manifestText) as PackageManifest & { name: string }
  if (!release && manifest.arcadia) requireClientRange(manifest)
  const preview = parseNpmPackOutput(
    String((await npm(root, ['pack', '--dry-run', '--ignore-scripts', '--json'], cache)).stdout),
  )[0]
  if (!preview || preview.files.length > 50000) fail('npm returned an invalid package file list')
  const included = new Set<string>(preview.files.map((file: { path: string }) => packagePath(file.path)))
  if (!included.has('package.json')) fail('npm omitted the package manifest')
  let presentation: PresentationManifest | undefined
  try {
    presentation = JSON.parse(await readFile(join(root, 'dist/presentation.json'), 'utf8')) as PresentationManifest
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }
  const required: string[] = []
  const declaredAssets =
    manifest.arcadia?.assets && typeof manifest.arcadia.assets === 'object' && !Array.isArray(manifest.arcadia.assets)
      ? Object.values(manifest.arcadia.assets)
      : []
  for (const file of [
    manifest.arcadia?.content,
    manifest.arcadia?.presentation,
    manifest.arcadia?.catalog,
    ...declaredAssets,
  ])
    if (typeof file === 'string') required.push(packagePath(file))
  if (manifest.arcadia?.effectArtifact && !manifest.arcadia?.effects)
    required.push(packagePath(manifest.arcadia.effectArtifact))
  if (
    presentation &&
    (presentation.bindings?.length || presentation.resources?.length || Object.keys(presentation.locales ?? {}).length)
  ) {
    if (manifest.arcadia?.presentation !== 'dist/presentation.json')
      fail('Set arcadia.presentation to dist/presentation.json before packing media/locales')
    required.push(
      'dist/content.json',
      'dist/presentation.json',
      ...(presentation.resources ?? []).filter(resource => resource.kind === 'file').map(resource => resource.source),
    )
  }
  for (const file of required) if (!included.has(file)) fail(`npm files omits required presentation file: ${file}`)
  const distributed = new Set<string>(['package.json'])
  for (const file of included)
    if ((!release && file.startsWith('dist/')) || distributionMetadata.test(file)) distributed.add(file)
  for (const file of required) distributed.add(file)

  const releasePackage = release ? releasePayload(manifest, included, presentation) : undefined
  if (releasePackage) {
    distributed.clear()
    for (const file of releasePackage.files) {
      if (file !== artifactFile || !manifest.arcadia?.effects) distributed.add(file)
    }
  }
  // Keep output on the destination filesystem so publishing can be one rename.
  const temporary = await mkdtemp(join(await stagingRoot(root), 'publish-'))
  const payload = join(temporary, 'package'),
    output = join(temporary, 'output')
  const sources = new Map<string, CapturedSource>()
  try {
    await mkdir(payload)
    await mkdir(output)
    const staged = releasePackage ?? structuredClone(manifest)
    for (const file of distributed) {
      const source = await sourceFile(root, file)
      sources.set(source.path, source)
      await mkdir(dirname(join(payload, file)), { recursive: true })
      await copyFile(source.path, join(payload, file))
      const after = await lstat(source.path)
      if (!sameFile(source.info, after)) fail(`Package source changed during capture: ${file}`)
    }
    if (typeof manifest.arcadia?.effects === 'string') {
      const effects = await sourceFile(root, manifest.arcadia.effects)
      const artifact = await compileEffectModule(effects.path, root, manifest.name, path => {
        // The fixed compiler calls this before reading each validated dependency.
        const info = statSync(path),
          previous = sources.get(path)
        if (previous && !sameFile(previous.info, info)) fail(`Effect source changed during capture: ${path}`)
        if (!previous) sources.set(path, { path, canonical: path, info })
      })
      await verifyCapture(sources)
      await mkdir(dirname(join(payload, artifactFile)), { recursive: true })
      await writeFile(join(payload, artifactFile), JSON.stringify(artifact) + '\n')
      const stagedArcadia = staged.arcadia
      if (!stagedArcadia) fail('Package manifest is missing arcadia metadata')
      stagedArcadia.effectArtifact = artifactFile
      distributed.add(artifactFile)
    } else if (typeof manifest.arcadia?.effectArtifact === 'string' && !included.has(manifest.arcadia.effectArtifact)) {
      fail(`npm files omits required effect artifact: ${manifest.arcadia.effectArtifact}`)
    }
    if (staged.arcadia) {
      delete staged.arcadia.effectSources
      delete staged.arcadia.effects
    }
    staged.files = releasePackage?.files ?? [...distributed]
    await writeFile(join(payload, 'package.json'), JSON.stringify(staged, null, 2) + '\n')
    const packed = parseNpmPackOutput(
      String((await npm(payload, ['pack', '--ignore-scripts', '--json', '--pack-destination', output], cache)).stdout),
    )[0]
    if (!packed) fail('npm returned an invalid package receipt')
    packagePath(packed.filename)
    if (basename(packed.filename) !== packed.filename) fail('npm returned an unsafe archive filename')
    const actual = new Set<string>(packed.files.map((file: { path: string }) => file.path))
    for (const file of distributed) if (!actual.has(file)) fail(`npm omitted staged package file: ${file}`)
    for (const file of actual)
      if (!distributed.has(file) && !distributionMetadata.test(file)) fail(`npm included a non-artifact file: ${file}`)
    if (release) {
      Object.assign(packed, await normalizeReleaseArchive(join(output, packed.filename)))
      await verifyRelease(temporary, join(output, packed.filename), manifest.name)
    }
    if ((await readFile(join(root, 'package.json'), 'utf8')) !== manifestText)
      fail('Package manifest changed during packaging')
    await verifyCapture(sources)
    await rename(join(output, packed.filename), join(root, packed.filename))
    return packed
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
