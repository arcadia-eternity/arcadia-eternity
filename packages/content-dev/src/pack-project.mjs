import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { compileEffectModule, resolveNpmInvocation } from '@arcadia-eternity/pack-loader/node'

const exec = promisify(execFile)
const artifactFile = 'dist/arcadia-effects.json'
const fail = message => {
  throw new Error(message)
}
function packagePath(file) {
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
async function npm(root, args, cache) {
  const invocation = await resolveNpmInvocation([...args, ...(cache ? ['--cache', resolve(cache)] : [])])
  return exec(invocation.file, invocation.args, { cwd: root, maxBuffer: 32 * 1024 * 1024, timeout: 120000 })
}
async function sourceFile(root, file) {
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
const sameFile = (before, after) =>
  before.size === after.size &&
  before.mtimeMs === after.mtimeMs &&
  before.ctimeMs === after.ctimeMs &&
  before.ino === after.ino
async function verifyCapture(sources) {
  for (const source of sources.values()) {
    const after = await lstat(source.path)
    if (!sameFile(source.info, after) || (await realpath(source.path)) !== source.canonical)
      fail(`Package source changed during capture: ${source.path}`)
  }
}
async function stagingRoot(root) {
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

/** Trusted author packaging: close the effect dependency graph without evaluating it.
 * Only the staged package gains artifact metadata; the source manifest is never rewritten.
 */
export async function packBuiltProject(directory = process.cwd(), { cache } = {}) {
  const root = await realpath(resolve(directory))
  const manifestText = await readFile(join(root, 'package.json'), 'utf8')
  const manifest = JSON.parse(manifestText)
  const preview = JSON.parse((await npm(root, ['pack', '--dry-run', '--ignore-scripts', '--json'], cache)).stdout)[0]
  if (!Array.isArray(preview?.files) || preview.files.length > 50000) fail('npm returned an invalid package file list')
  const included = new Set(preview.files.map(file => packagePath(file.path)))
  if (!included.has('package.json')) fail('npm omitted the package manifest')
  const required = manifest.arcadia?.content ? [manifest.arcadia.content] : []
  if (manifest.arcadia?.effectSources) required.push(manifest.arcadia.effectArtifact)
  let presentation
  try {
    presentation = JSON.parse(await readFile(join(root, 'dist/presentation.json'), 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (
    presentation &&
    (presentation.bindings.length || presentation.resources.length || Object.keys(presentation.locales).length)
  ) {
    if (manifest.arcadia?.presentation !== 'dist/presentation.json')
      fail('Set arcadia.presentation to dist/presentation.json before packing media/locales')
    required.push(
      'dist/content.json',
      'dist/presentation.json',
      ...presentation.resources.filter(resource => resource.kind === 'file').map(resource => resource.source),
    )
  }
  for (const file of required) if (!included.has(file)) fail(`npm files omits required presentation file: ${file}`)

  // Keep output on the destination filesystem so publishing can be one rename.
  const temporary = await mkdtemp(join(await stagingRoot(root), 'publish-'))
  const payload = join(temporary, 'package'),
    output = join(temporary, 'output')
  const sources = new Map()
  try {
    await mkdir(payload)
    await mkdir(output)
    const staged = structuredClone(manifest)
    for (const file of included) {
      const source = await sourceFile(root, file)
      sources.set(source.path, source)
      await mkdir(dirname(join(payload, file)), { recursive: true })
      await copyFile(source.path, join(payload, file))
      const after = await lstat(source.path)
      if (!sameFile(source.info, after)) fail(`Package source changed during capture: ${file}`)
    }
    if (manifest.arcadia?.effects) {
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
      staged.arcadia.effectArtifact = artifactFile
      // A published artifact is sufficient even if the author's npm files excludes source.
      if (!included.has(manifest.arcadia.effects)) delete staged.arcadia.effects
      included.add(artifactFile)
    } else if (manifest.arcadia?.effectArtifact && !included.has(manifest.arcadia.effectArtifact)) {
      fail(`npm files omits required effect artifact: ${manifest.arcadia.effectArtifact}`)
    }
    staged.files = [...included]
    await writeFile(join(payload, 'package.json'), JSON.stringify(staged, null, 2) + '\n')
    const packed = JSON.parse(
      (await npm(payload, ['pack', '--ignore-scripts', '--json', '--pack-destination', output], cache)).stdout,
    )[0]
    if (!packed || typeof packed.filename !== 'string' || !Array.isArray(packed.files))
      fail('npm returned an invalid package receipt')
    packagePath(packed.filename)
    if (basename(packed.filename) !== packed.filename) fail('npm returned an unsafe archive filename')
    const actual = new Set(packed.files.map(file => file.path))
    for (const file of included) if (!actual.has(file)) fail(`npm omitted staged package file: ${file}`)
    if ((await readFile(join(root, 'package.json'), 'utf8')) !== manifestText)
      fail('Package manifest changed during packaging')
    await verifyCapture(sources)
    await rename(join(output, packed.filename), join(root, packed.filename))
    return packed
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
