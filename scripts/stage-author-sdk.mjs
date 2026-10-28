#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import YAML from 'yaml'

const repo = fileURLToPath(new URL('../', import.meta.url))
const exec = promisify(execFile)
const sections = ['dependencies', 'optionalDependencies', 'peerDependencies']

async function workspacePackages() {
  const found = new Map()
  // Discover the workspace packages used by the SDK.
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || ['node_modules', 'dist', 'test', 'src'].includes(entry.name)) continue
      const path = join(directory, entry.name)
      let manifest
      try {
        manifest = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'))
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      if (manifest) {
        if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string' || found.has(manifest.name))
          throw new Error(`Invalid or duplicate workspace package: ${path}`)
        found.set(manifest.name, { directory: path, manifest })
      } else await visit(path)
    }
  }
  await visit(join(repo, 'packages'))
  return found
}

async function safeTree(path) {
  const item = await lstat(path)
  if (item.isSymbolicLink()) throw new Error(`Built output contains a symbolic link: ${path}`)
  if (item.isDirectory()) {
    for (const name of await readdir(path)) await safeTree(join(path, name))
  } else if (!item.isFile()) throw new Error(`Unsupported built output: ${path}`)
}

function exportedPaths(value) {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(exportedPaths)
  if (value && typeof value === 'object') return Object.values(value).flatMap(exportedPaths)
  return []
}

/** Prepare local development packages; this does not build, install or publish them. */
export async function stageAuthorSdk(output) {
  if (process.platform === 'win32') throw new Error('SDK staging is not yet validated on Windows')
  if (typeof output !== 'string' || !output) throw new Error('A new output directory is required')
  const target = resolve(output)
  const parent = await realpath(dirname(target))
  const destination = join(parent, basename(target))
  try {
    await lstat(destination)
    throw new Error('Output directory already exists')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const workspace = YAML.parse(await readFile(join(repo, 'pnpm-workspace.yaml'), 'utf8'))
  const catalog = workspace.catalog ?? {}
  const packages = await workspacePackages()
  const selected = new Map()
  function visit(name) {
    if (selected.has(name)) return
    const pkg = packages.get(name)
    if (!pkg) throw new Error(`Missing workspace dependency: ${name}`)
    selected.set(name, pkg)
    for (const section of sections)
      for (const [dep, spec] of Object.entries(pkg.manifest[section] ?? {}))
        if (typeof spec === 'string' && spec.startsWith('workspace:')) visit(dep)
  }
  visit('@arcadia-eternity/pack-loader')

  const battleBuild = join(packages.get('@arcadia-eternity/battle').directory, 'dist')
  const build = JSON.parse(await readFile(join(battleBuild, 'environment-build.json'), 'utf8'))
  const { effectSdkApiVersion } = await import(pathToFileURL(join(battleBuild, 'v4-authoring.js')).href)
  if (
    build.formatVersion !== 1 ||
    ![build.coreBuildId, build.registryBuildId].every(id => /^[a-f0-9]{64}$/.test(id)) ||
    effectSdkApiVersion !== 1
  )
    throw new Error('Build a compatible battle SDK before staging author packages')

  const scratch = await mkdtemp(join(tmpdir(), 'arcadia-author-sdk-'))
  let created = false
  try {
    const artifacts = join(scratch, 'artifacts')
    await mkdir(artifacts)
    const records = []
    for (const [name, pkg] of [...selected.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const manifest = structuredClone(pkg.manifest)
      for (const section of sections) {
        if (!manifest[section]) continue
        for (const [dep, spec] of Object.entries(manifest[section])) {
          if (typeof spec !== 'string') throw new Error(`Invalid dependency: ${name} -> ${dep}`)
          if (spec.startsWith('workspace:')) {
            const version = selected.get(dep)?.manifest.version
            if (!version) throw new Error(`Missing workspace dependency: ${name} -> ${dep}`)
            const range = spec.slice('workspace:'.length)
            if (!['*', '^', '~'].includes(range)) throw new Error(`Unsupported workspace dependency: ${name} -> ${dep}`)
            manifest[section][dep] = `${range === '*' ? '' : range}${version}`
          } else if (spec.startsWith('catalog:')) {
            const catalogName = spec.slice('catalog:'.length)
            const values = catalogName ? workspace.catalogs?.[catalogName] : catalog
            const version = values?.[dep]
            if (typeof version !== 'string' || !version)
              throw new Error(`Missing catalog dependency: ${name} -> ${dep}`)
            manifest[section][dep] = version
          }
        }
      }
      // Local development builds must not run scripts or pretend to be release packages.
      delete manifest.scripts
      delete manifest.devDependencies
      delete manifest.files
      delete manifest.publishConfig
      manifest.private = true
      const build = join(pkg.directory, 'dist')
      if (!(await stat(build)).isDirectory()) throw new Error(`Build output is missing for ${name}`)
      await safeTree(build)
      for (const path of [
        ...exportedPaths(manifest.exports),
        ...exportedPaths(manifest.main),
        ...exportedPaths(manifest.types),
      ]) {
        if (path === './package.json') continue
        if (!path.startsWith('./dist/') || path.includes('*') || path.split('/').includes('..'))
          throw new Error(`Unsupported package entry in ${name}: ${path}`)
        if (!(await stat(join(pkg.directory, path))).isFile()) throw new Error(`Missing package entry: ${name} ${path}`)
      }
      const dir = join(scratch, `package-${records.length}`)
      await mkdir(dir)
      await cp(build, join(dir, 'dist'), { recursive: true })
      await writeFile(join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
      const result = await exec(
        'npm',
        ['pack', '--ignore-scripts', '--json', '--cache', join(scratch, 'cache'), '--pack-destination', artifacts],
        {
          cwd: dir,
          maxBuffer: 16 * 1024 * 1024,
        },
      )
      const packed = JSON.parse(result.stdout)
      const filename = packed?.[0]?.filename
      if (
        !Array.isArray(packed) ||
        packed.length !== 1 ||
        typeof filename !== 'string' ||
        basename(filename) !== filename
      )
        throw new Error(`Invalid npm pack output for ${name}`)
      const contents = await readFile(join(artifacts, filename))
      records.push({
        name,
        version: manifest.version,
        filename,
        sha256: createHash('sha256').update(contents).digest('hex'),
      })
    }
    const index = {
      format: 'arcadia.author-sdk-local',
      version: 1,
      releaseReady: false,
      sdkApi: effectSdkApiVersion,
      build,
      packages: records,
    }
    await writeFile(join(artifacts, 'arcadia-author-sdk.json'), JSON.stringify(index, null, 2) + '\n')
    await writeFile(
      join(artifacts, 'README.md'),
      '# Arcadia local author SDK\n\nThese archives are for local development only. They contain workspace build outputs and npm metadata, not complete release license notices. They are not ready for distribution or publication. The root project license is not included as a license for these MIT-declared packages.\n\nInstall all archives together in an author project with `npm install --no-save --no-package-lock --ignore-scripts /path/to/sdk/*.tgz`. This changes that project’s node_modules, not its package.json or lockfile. Third-party dependencies and the author project’s TypeScript tools must be cached or fetched from the configured npm registry. An existing node_modules installation may be changed. `--offline` only works if all third-party dependencies are already cached.\n\nVersion numbers do not establish compatibility with a host build. Use the SDK generated from the same trusted host source/build and inspect the artifact hashes.\n',
    )
    await mkdir(destination)
    created = true
    for (const name of (await readdir(artifacts)).filter(name => name !== 'arcadia-author-sdk.json'))
      await cp(join(artifacts, name), join(destination, name), { errorOnExist: true, force: false })
    // The manifest is the completion marker; readers never see it before all archives are present.
    await cp(join(artifacts, 'arcadia-author-sdk.json'), join(destination, 'arcadia-author-sdk.json'), {
      errorOnExist: true,
      force: false,
    })
    created = false
    return { directory: destination, ...index }
  } finally {
    if (created) await rm(destination, { recursive: true, force: true })
    await rm(scratch, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  stageAuthorSdk(process.argv[2])
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
