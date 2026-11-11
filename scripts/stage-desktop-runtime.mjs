#!/usr/bin/env node
import { execFile } from 'node:child_process'
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
import { verifyDesktopProductionDependencies } from './desktop-production-dependencies.mjs'
import { locateDesktopSqliteBinary, stageDesktopSqlite, loadElectronRebuild } from './desktop-sqlite-native.mjs'
import { normalizeRuntimeLinks, resolvePnpmInvocation } from './desktop-runtime-portability.mjs'
import { withPreservedPnpmWorkspaceState } from './desktop-pnpm-deploy.mjs'
import { stagePairedWebsite, verifyPairedWebsite } from './stage-paired-website.mjs'
import { materializeLinklessModules } from './desktop-linkless-modules.mjs'

const exec = promisify(execFile)
const repo = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const pnpmVersion = '11.21.0'

function inside(root, target) {
  const path = relative(root, target)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}
export async function validateDesktopRuntimeFiles(root) {
  root = await realpath(root)
  await stat(join(root, 'cli.js'))
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        const link = await readlink(path)
        if (isAbsolute(link) || !inside(root, resolve(dir, link)) || !inside(root, await realpath(path)))
          throw new Error(`Runtime link escapes staged root: ${entry.name}`)
      } else if (entry.isDirectory()) await visit(path)
      else if (!entry.isFile()) throw new Error(`Unsupported runtime file: ${entry.name}`)
    }
  }
  await visit(root)
}

/** Check runtime integrity; notice completeness is advisory unless explicitly required. */
export async function verifyDesktopRuntime(
  root,
  { allowIncompleteNotices = true, requireNative = false, platform, arch } = {},
) {
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
    throw new Error(`Strict license check failed: ${notices.missing.length} license notices require review`)
  await validateDesktopRuntimeFiles(root)
  if (manifest.website) {
    await verifyPairedWebsite(pathToFileURL(join(root, 'web') + sep))
    const website = JSON.parse(await readFile(join(root, 'web/arcadia-web-manifest.json'), 'utf8'))
    if (website.schemaVersion !== 1 || website.protocolVersion !== 1) throw new Error('Invalid paired desktop website')
  }
  if (requireNative || manifest.nativeModules) {
    const sqlite = manifest.nativeModules?.find(item => item.name === 'better-sqlite3')
    if (
      !sqlite ||
      sqlite.verified !== true ||
      sqlite.smoke !== 'write-close-reopen' ||
      !/^\d+$/.test(sqlite.abi) ||
      sqlite.electronVersion !== manifest.electron?.version ||
      sqlite.abi !== manifest.electron?.abi ||
      sqlite.platform !== manifest.electron?.platform ||
      sqlite.arch !== manifest.electron?.arch ||
      (platform && sqlite.platform !== platform) ||
      (arch && sqlite.arch !== arch)
    )
      throw new Error(
        'Desktop runtime SQLite target is missing or incompatible; stage the native module for this Electron target',
      )
    const sqliteRequire = createRequire(join(resolve(root), 'node_modules/@arcadia-eternity/database/package.json'))
    const sqlitePackage = sqliteRequire.resolve('better-sqlite3/package.json')
    const installedSqlite = JSON.parse(await readFile(sqlitePackage, 'utf8'))
    if (installedSqlite.version !== sqlite.version || installedSqlite.name !== sqlite.name)
      throw new Error('Desktop SQLite native artifact does not match its recorded package version')
    const nativeFile = await locateDesktopSqliteBinary(dirname(sqlitePackage), sqlite.platform, sqlite.arch)
    if (!nativeFile || !inside(await realpath(root), await realpath(nativeFile)) || !(await stat(nativeFile)).isFile())
      throw new Error('Desktop SQLite native artifact is missing or escapes runtime')
  }
  return manifest
}
async function workspaces() {
  const result = new Map()
  for (const base of ['packages', 'packs']) {
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
    if (pkg.manifest.arcadia?.catalog) {
      const manifest = pkg.manifest.arcadiaEternityPack
      await cp(join(pkg.directory, manifest), join(target, manifest))
      const presentation = JSON.parse(await readFile(join(pkg.directory, pkg.manifest.arcadia.presentation), 'utf8'))
      for (const { kind, source } of presentation.resources) {
        if (kind !== 'file') continue
        await mkdir(dirname(join(target, source)), { recursive: true })
        await cp(join(pkg.directory, source), join(target, source))
      }
    }
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
export async function stageDesktopRuntime({ output, online = false, allowIncompleteNotices = true }) {
  if (typeof output !== 'string' || !output) throw new Error('An output directory is required')
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
    const webUi = JSON.parse(await readFile(join(repo, 'packages/web-ui/package.json'), 'utf8'))
    const npmVersion = webUi.devDependencies?.npm
    if (typeof npmVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(npmVersion))
      throw new Error('packages/web-ui/package.json must pin an exact npm version')
    const lockedNpm = parsedLock.importers?.['packages/web-ui']?.devDependencies?.npm
    if (lockedNpm?.specifier !== npmVersion || lockedNpm?.version !== npmVersion)
      throw new Error(`The pinned npm ${npmVersion} is missing from pnpm-lock.yaml`)
    const npmIntegrity = parsedLock.packages?.[`npm@${npmVersion}`]?.resolution?.integrity
    if (typeof npmIntegrity !== 'string')
      throw new Error(`The pinned npm ${npmVersion} integrity is missing from pnpm-lock.yaml`)
    const npmRoot = await realpath(join(repo, 'packages/web-ui/node_modules/npm'))
    const npm = JSON.parse(await readFile(join(npmRoot, 'package.json'), 'utf8'))
    if (npm.version !== npmVersion) throw new Error(`Desktop build requires npm ${npmVersion}`)
    const electronRoot = await realpath(join(repo, 'packages/web-ui/node_modules/electron'))
    const electron = JSON.parse(await readFile(join(electronRoot, 'package.json'), 'utf8'))
    const lockedElectron = parsedLock.importers?.['packages/web-ui']?.devDependencies?.electron?.version?.split('(')[0]
    const electronIntegrity = parsedLock.packages?.[`electron@${lockedElectron}`]?.resolution?.integrity
    if (electron.version !== lockedElectron) throw new Error('Installed Electron does not match pnpm-lock.yaml')
    const executable = createRequire(join(electronRoot, 'package.json'))('electron')
    const electronDist = process.platform === 'darwin' ? resolve(dirname(executable), '../../..') : dirname(executable)
    const embedded = JSON.parse(
      (
        await exec(
          executable,
          [
            '-p',
            'JSON.stringify({node:process.versions.node,electron:process.versions.electron,abi:process.versions.modules,platform:process.platform,arch:process.arch})',
          ],
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
    const pnpm = await resolvePnpmInvocation()
    const installedPnpm = (await exec(pnpm.command, [...pnpm.args, '--version'], { cwd: repo })).stdout.trim()
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
    await withPreservedPnpmWorkspaceState(repo, () =>
      exec(pnpm.command, [...pnpm.args, ...flags], { cwd: repo, maxBuffer: 16 * 1024 * 1024 }),
    )
    const runtime = join(temp, 'runtime')
    await mkdir(runtime)
    // Replace pnpm's workspace links before auditing the deploy tree: these
    // deliberately point at checkout sources and are never distribution files.
    const workspacePackages = await materializeWorkspace(deployed)
    // Windows pnpm junctions contain absolute paths. Convert only contained links
    // before relocation; each native CI target verifies the relocated result.
    await normalizeRuntimeLinks(join(deployed, 'node_modules'))
    let dependencyLayout
    if (process.platform === 'win32') {
      dependencyLayout = {
        kind: 'physical-hoisted',
        ...(await materializeLinklessModules(join(deployed, 'node_modules'), join(runtime, 'node_modules'))),
      }
    } else await rename(join(deployed, 'node_modules'), join(runtime, 'node_modules'))
    const cli = join(temp, 'fresh-cli')
    const rolldown = join(dirname(require.resolve('rolldown/package.json')), 'bin/cli.mjs')
    await exec(process.execPath, [rolldown, '-c', '--dir', cli], { cwd: repo, maxBuffer: 16 * 1024 * 1024 })
    await cp(cli, runtime, { recursive: true })
    // Root CLI output is ESM. The deployed server manifest must not be the package root.
    await writeFile(join(runtime, 'package.json'), '{"private":true,"type":"module"}\n')
    const sqlite = await stageDesktopSqlite({
      runtime,
      executable,
      electronVersion: electron.version,
      abi: embedded.abi,
      platform: embedded.platform,
      arch: embedded.arch,
      cacheDirectory: join(repo, 'node_modules/.cache/arcadia-desktop-native'),
      online,
      rebuild: online ? await loadElectronRebuild(join(repo, 'packages/web-ui/package.json')) : undefined,
    })
    await mkdir(join(runtime, 'runtime'))
    await cp(npmRoot, join(runtime, 'runtime/npm'), { recursive: true, verbatimSymlinks: true })
    const pack = join(runtime, 'packs/base')
    await mkdir(pack, { recursive: true })
    for (const entry of ['package.json', 'dist', 'LICENSE']) {
      try {
        await cp(join(repo, 'packs/base', entry), join(pack, entry), { recursive: true, verbatimSymlinks: true })
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    // Base presentation may use remote on-demand media and have no local assets.
    let hasLocalAssets = true
    try {
      await stat(join(repo, 'packs/base/assets'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      hasLocalAssets = false
    }
    if (hasLocalAssets)
      await cp(join(repo, 'packs/base/assets'), join(pack, 'assets'), { recursive: true, verbatimSymlinks: true })
    // This absolute build-machine store path is not needed by Node and is not relocatable.
    await rm(join(runtime, 'node_modules/.modules.yaml'), { force: true })
    await verifyDesktopProductionDependencies(runtime)
    const notices = await collectDesktopLicenses(runtime, {
      repositoryLicense: join(repo, 'LICENSE'),
      electronLicense: join(electronDist, 'LICENSE'),
      electronNotices: join(electronDist, 'LICENSES.chromium.html'),
    })
    await writeFile(join(runtime, 'licenses/notice.json'), JSON.stringify(notices, null, 2) + '\n')
    if (notices.missing.length && !allowIncompleteNotices)
      throw new Error(
        `License notices need review for ${notices.missing.length} packages: ${notices.missing.map(item => `${item.name}@${item.version}`).join(', ')}`,
      )
    const version = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')).version
    await stagePairedWebsite(
      pathToFileURL(join(repo, 'packages/web-ui/dist') + sep),
      pathToFileURL(join(runtime, 'web') + sep),
      version,
    )
    const manifest = {
      website: { schemaVersion: 1, protocolVersion: 1 },
      format: 'arcadia.desktop-runtime',
      version: 1,
      // Legacy field: records strict notice completeness, not publication permission.
      releaseReady: notices.missing.length === 0,
      missingLicenseTexts: notices.missing,
      npm: {
        version: npmVersion,
        integrity: npmIntegrity,
        source: `https://registry.npmjs.org/npm/-/npm-${npmVersion}.tgz`,
      },
      electron: {
        version: electron.version,
        integrity: electronIntegrity,
        embeddedNode: embedded.node,
        abi: embedded.abi,
        platform: embedded.platform,
        arch: embedded.arch,
        npmNodeRange: npm.engines?.node,
      },
      pnpm: pnpmVersion,
      nativeModules: [sqlite],
      workspacePackages,
      ...(dependencyLayout ? { dependencyLayout } : {}),
    }
    await writeFile(join(runtime, 'arcadia-desktop-runtime.json'), JSON.stringify(manifest, null, 2) + '\n')
    await verifyDesktopRuntime(runtime, {
      allowIncompleteNotices,
      requireNative: true,
      platform: embedded.platform,
      arch: embedded.arch,
    })
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
  const allowed = new Set(['--output', '--online', '--allow-incomplete-notices', '--require-complete-notices'])
  try {
    if (outputIndex < 0 || !args[outputIndex + 1] || args.some((arg, i) => i !== outputIndex + 1 && !allowed.has(arg)))
      throw new Error(
        'Usage: node scripts/stage-desktop-runtime.mjs --output <new-directory> [--online] [--require-complete-notices]',
      )
    if (args.includes('--allow-incomplete-notices') && args.includes('--require-complete-notices'))
      throw new Error('Choose either advisory or strict license checking')
    const result = await stageDesktopRuntime({
      output: args[outputIndex + 1],
      online: args.includes('--online'),
      allowIncompleteNotices: !args.includes('--require-complete-notices'),
    })
    if (result.missingLicenseTexts.length)
      console.warn(
        `License inventory: ${result.missingLicenseTexts.length} advisory findings; see licenses/notice.json`,
      )
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
