#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import YAML from 'yaml'
import { collectDesktopLicenses } from './desktop-runtime-licenses.mjs'

const exec = promisify(execFile)
const repo = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const npmVersion = '11.17.0'
const pnpmVersion = '11.21.0'
const npmIntegrity = 'sha512-PurxiZexEHDTE4SSaLI3ZrnbAGiZfeyUcQcxcP5D+hfytNAze/D1IzDuInTn9XVLIbAQUnQuSPXJx02LHjLvQw=='

function inside(root, target) {
  const path = relative(root, target)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}
async function fileHash(file) {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(file)) hash.update(bytes)
  return hash.digest('hex')
}
/** Byte identity of staged files and relative links; excludes its own manifest. */
export async function desktopRuntimeDigest(root) {
  root = await realpath(root)
  const hash = createHash('sha256')
  async function visit(dir, prefix = '') {
    const entries = await readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const name = `${prefix}${entry.name}`
      if (name === 'arcadia-desktop-runtime.json') continue
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        const link = await readlink(path)
        if (isAbsolute(link) || !inside(root, resolve(dir, link)))
          throw new Error(`Runtime link escapes staged root: ${name}`)
        const actual = await realpath(path)
        if (!inside(root, actual)) throw new Error(`Runtime link resolves outside staged root: ${name}`)
        hash.update(JSON.stringify(['link', name, link.replaceAll('\\', '/')]))
      } else if (entry.isDirectory()) {
        await visit(path, `${name}/`)
      } else if (entry.isFile()) {
        hash.update(JSON.stringify(['file', name, (await lstat(path)).mode & 0o111, await fileHash(path)]))
      } else throw new Error(`Unsupported runtime file: ${name}`)
    }
  }
  await visit(root)
  return hash.digest('hex')
}

/** Refuse incomplete notices and modifications when preparing a distributable app. */
export async function verifyDesktopRuntime(root, { allowIncompleteNotices = false } = {}) {
  const manifest = JSON.parse(await readFile(join(root, 'arcadia-desktop-runtime.json'), 'utf8'))
  const notices = JSON.parse(await readFile(join(root, 'licenses/notice.json'), 'utf8'))
  if (
    manifest.format !== 'arcadia.desktop-runtime' ||
    manifest.version !== 1 ||
    !Array.isArray(notices.missing) ||
    !Array.isArray(manifest.missingLicenseTexts) ||
    JSON.stringify(manifest.missingLicenseTexts) !== JSON.stringify(notices.missing) ||
    manifest.releaseReady !== (notices.missing.length === 0)
  )
    throw new Error('Invalid desktop runtime manifest or license inventory')
  if (!manifest.releaseReady && !allowIncompleteNotices)
    throw new Error(`Desktop runtime cannot be released: ${notices.missing.length} license notices require review`)
  if (manifest.runtimeDigest !== (await desktopRuntimeDigest(root)))
    throw new Error('Desktop runtime files differ from their staged identity')
  return manifest
}
async function workspaces() {
  const result = new Map()
  for (const base of ['packages', 'packages/engine-plugins', 'packs']) {
    for (const entry of await readdir(join(repo, base), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const directory = join(repo, base, entry.name)
      try {
        const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
        if (typeof manifest.name === 'string') result.set(manifest.name, { directory, manifest })
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
  }
  return result
}
async function materializeWorkspace(runtime) {
  const modules = join(runtime, 'node_modules')
  const virtual = join(modules, '.pnpm')
  const sources = await workspaces()
  const scope = join(modules, '@arcadia-eternity')
  const roots = (await readdir(scope)).map(name => `@arcadia-eternity/${name}`)
  for (const required of ['@arcadia-eternity/server', '@arcadia-eternity/client', '@arcadia-eternity/p2p-transport'])
    if (!roots.includes(required)) roots.push(required)
  const done = new Set()
  async function visit(name) {
    if (done.has(name)) return
    done.add(name)
    const pkg = sources.get(name)
    if (!pkg) throw new Error(`Unknown workspace dependency ${name}`)
    const deps = { ...pkg.manifest.dependencies, ...pkg.manifest.optionalDependencies }
    for (const [dependency, spec] of Object.entries(deps))
      if (typeof spec === 'string' && spec.startsWith('workspace:')) await visit(dependency)
    const target = join(modules, ...name.split('/'))
    await rm(target, { recursive: true, force: true })
    await mkdir(target, { recursive: true })
    await cp(join(pkg.directory, 'package.json'), join(target, 'package.json'))
    await cp(join(pkg.directory, 'dist'), join(target, 'dist'), { recursive: true })
    for (const [dependency, spec] of Object.entries(deps)) {
      if (typeof spec === 'string' && spec.startsWith('workspace:')) continue
      let source
      try {
        source = await realpath(join(pkg.directory, 'node_modules', ...dependency.split('/')))
      } catch (error) {
        if (error.code === 'ENOENT' && dependency in (pkg.manifest.optionalDependencies ?? {})) continue
        throw error
      }
      const sourceStore = join(repo, 'node_modules', '.pnpm')
      if (!inside(sourceStore, source)) throw new Error(`Unsupported dependency source for ${name}: ${dependency}`)
      const packaged = join(virtual, relative(sourceStore, source))
      try {
        await stat(packaged)
      } catch {
        throw new Error(`Locked dependency is not staged: ${name} -> ${dependency}`)
      }
      const link = join(target, 'node_modules', ...dependency.split('/'))
      await mkdir(dirname(link), { recursive: true })
      await symlink(relative(dirname(link), packaged), link, 'dir')
    }
  }
  for (const root of roots) await visit(root)
  return [...done].sort()
}

/** Builds a new, relocatable runtime. Nothing is downloaded without the explicit online option. */
export async function stageDesktopRuntime({ output, online = false, allowIncompleteNotices = false }) {
  if (typeof output !== 'string' || !output) throw new Error('An output directory is required')
  if (process.platform === 'win32')
    throw new Error(
      'Windows staging is not yet supported: portable pnpm links and the build runner still require Windows validation',
    )
  const target = resolve(output),
    parent = dirname(target)
  await mkdir(parent, { recursive: true })
  try {
    await lstat(target)
    throw new Error(`Output already exists: ${target}`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const temp = await mkdtemp(join(parent, '.arcadia-desktop-stage-'))
  try {
    const lock = await readFile(join(repo, 'pnpm-lock.yaml'), 'utf8')
    const parsedLock = YAML.parse(lock)
    const lockedNpm = parsedLock.importers?.['packages/web-ui']?.devDependencies?.npm
    if (
      lockedNpm?.specifier !== npmVersion ||
      lockedNpm?.version !== npmVersion ||
      parsedLock.packages?.[`npm@${npmVersion}`]?.resolution?.integrity !== npmIntegrity
    )
      throw new Error('The pinned npm version or integrity is missing from pnpm-lock.yaml')
    const npmRoot = await realpath(join(repo, 'packages/web-ui/node_modules/npm'))
    const npm = JSON.parse(await readFile(join(npmRoot, 'package.json'), 'utf8'))
    if (npm.version !== npmVersion) throw new Error(`Desktop build requires npm ${npmVersion}`)
    const electronRoot = await realpath(join(repo, 'packages/web-ui/node_modules/electron'))
    const electron = JSON.parse(await readFile(join(electronRoot, 'package.json'), 'utf8'))
    const lockedElectron = parsedLock.importers?.['packages/web-ui']?.devDependencies?.electron?.version?.split('(')[0]
    const electronIntegrity = parsedLock.packages?.[`electron@${lockedElectron}`]?.resolution?.integrity
    if (!electronIntegrity || electron.version !== lockedElectron)
      throw new Error('Installed Electron does not match pnpm-lock.yaml')
    const executable =
      process.platform === 'darwin'
        ? join(electronRoot, 'dist/Electron.app/Contents/MacOS/Electron')
        : join(electronRoot, 'dist/electron')
    const embedded = JSON.parse(
      (
        await exec(
          executable,
          ['-p', 'JSON.stringify({node:process.versions.node,electron:process.versions.electron})'],
          {
            cwd: repo,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            maxBuffer: 1024 * 1024,
          },
        )
      ).stdout,
    )
    if (
      embedded.electron !== electron.version ||
      !createRequire(join(npmRoot, 'package.json'))('semver').satisfies(embedded.node, npm.engines?.node)
    )
      throw new Error('Pinned npm is incompatible with the embedded Electron Node runtime')
    const installedPnpm = (await exec('pnpm', ['--version'], { cwd: repo })).stdout.trim()
    if (installedPnpm !== pnpmVersion) throw new Error(`Desktop build requires pnpm ${pnpmVersion}`)
    const deployed = join(temp, 'deploy')
    const flags = [
      '--filter',
      '@arcadia-eternity/server',
      'deploy',
      '--legacy',
      '--prod',
      '--frozen-lockfile',
      '--ignore-scripts',
      '--registry=https://registry.npmjs.org/',
    ]
    if (!online) flags.push('--offline')
    flags.push(deployed)
    process.stderr.write(
      online
        ? 'Preparing locked production dependencies from the configured official registry.\n'
        : 'Preparing locked production dependencies using the local cache only.\n',
    )
    await exec('pnpm', flags, { cwd: repo, maxBuffer: 16 * 1024 * 1024 })
    const runtime = join(temp, 'runtime')
    await mkdir(runtime)
    await rename(join(deployed, 'node_modules'), join(runtime, 'node_modules'))
    const workspacePackages = await materializeWorkspace(runtime)
    const cli = join(temp, 'fresh-cli')
    const rolldown = join(dirname(require.resolve('rolldown/package.json')), 'bin/cli.mjs')
    await exec(process.execPath, [rolldown, '-c', '--dir', cli], { cwd: repo, maxBuffer: 16 * 1024 * 1024 })
    await cp(cli, runtime, { recursive: true })
    // Root CLI output is ESM. The deployed server manifest must not be the package root.
    await writeFile(join(runtime, 'package.json'), '{"private":true,"type":"module"}\n')
    await mkdir(join(runtime, 'runtime'))
    await cp(npmRoot, join(runtime, 'runtime/npm'), { recursive: true, verbatimSymlinks: true })
    const pack = join(runtime, 'packs/base')
    await mkdir(pack, { recursive: true })
    for (const entry of ['pack.json', 'pack-lock.yaml', 'data', 'locales', 'assets', 'dist'])
      await cp(join(repo, 'packs/base', entry), join(pack, entry), { recursive: true, verbatimSymlinks: true })
    // This absolute build-machine store path is not needed by Node and is not relocatable.
    await rm(join(runtime, 'node_modules/.modules.yaml'), { force: true })
    const notices = await collectDesktopLicenses(runtime, {
      repositoryLicense: join(repo, 'LICENSE'),
      electronLicense: join(electronRoot, 'dist/LICENSE'),
      electronNotices: join(electronRoot, 'dist/LICENSES.chromium.html'),
    })
    await writeFile(join(runtime, 'licenses/notice.json'), JSON.stringify(notices, null, 2) + '\n')
    if (notices.missing.length && !allowIncompleteNotices)
      throw new Error(
        `License notices need review for ${notices.missing.length} packages: ${notices.missing.map(item => `${item.name}@${item.version}`).join(', ')}`,
      )
    const manifest = {
      format: 'arcadia.desktop-runtime',
      version: 1,
      releaseReady: notices.missing.length === 0,
      missingLicenseTexts: notices.missing,
      runtimeDigest: await desktopRuntimeDigest(runtime),
      lockfileDigest: createHash('sha256').update(lock).digest('hex'),
      npm: {
        version: npmVersion,
        integrity: npmIntegrity,
        source: `https://registry.npmjs.org/npm/-/npm-${npmVersion}.tgz`,
      },
      electron: {
        version: electron.version,
        integrity: electronIntegrity,
        embeddedNode: embedded.node,
        npmNodeRange: npm.engines?.node,
      },
      pnpm: pnpmVersion,
      workspacePackages,
    }
    await writeFile(join(runtime, 'arcadia-desktop-runtime.json'), JSON.stringify(manifest, null, 2) + '\n')
    // Reserve the destination exclusively before publishing: POSIX rename can otherwise
    // replace a concurrently created empty directory. Publish the manifest last.
    await mkdir(target)
    try {
      const entries = await readdir(runtime)
      for (const name of entries.filter(name => name !== 'arcadia-desktop-runtime.json'))
        await rename(join(runtime, name), join(target, name))
      await rename(join(runtime, 'arcadia-desktop-runtime.json'), join(target, 'arcadia-desktop-runtime.json'))
    } catch (error) {
      throw new Error(`Publishing failed; incomplete output was preserved at ${target}`, { cause: error })
    }
    return manifest
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2),
    outputIndex = args.indexOf('--output')
  const allowed = new Set(['--output', '--online', '--allow-incomplete-notices'])
  try {
    if (outputIndex < 0 || !args[outputIndex + 1] || args.some((arg, i) => i !== outputIndex + 1 && !allowed.has(arg)))
      throw new Error(
        'Usage: node scripts/stage-desktop-runtime.mjs --output <new-directory> [--online] [--allow-incomplete-notices]',
      )
    const result = await stageDesktopRuntime({
      output: args[outputIndex + 1],
      online: args.includes('--online'),
      allowIncompleteNotices: args.includes('--allow-incomplete-notices'),
    })
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
