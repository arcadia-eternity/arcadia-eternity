import { sha256Hex, sha256StreamHex } from '@arcadia-eternity/const'
import { inspectNpmProject, resolveNpmInvocation } from '@arcadia-eternity/pack-loader/node'
import { execFile } from 'node:child_process'
import { constants, createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { validRange } from 'semver'
import writeFileAtomic from 'write-file-atomic'
import { z } from 'zod'
import { stageEnvironmentDependencies } from './debug-environment-install.ts'
import { checkLock, installationEnvironment } from './managed-projects.ts'
import { withSourceLock } from './source-lock.ts'
import { errorCode, isRecord } from './types.ts'
import { WorkspaceError, type AuthorWorkspace } from './workspace.ts'
import { materialFiles, readJson } from './workspace-materials.ts'

const exec = promisify(execFile)
const namePattern = /^(?:@[a-z0-9_.-]+\/)?[a-z0-9][a-z0-9_.-]*$/
const localSpec = /^file:candidates\/[a-zA-Z0-9_.-]+\.tgz$/
const hex = z.string().regex(/^[a-f0-9]{64}$/)
const receiptSchema = z.object({
  generation: z.string().regex(/^install-[a-zA-Z0-9]{6}$/),
  declarations: hex,
  lockVersion: hex.nullable(),
  archives: z.record(z.string().regex(localSpec), hex),
  manifestVersion: hex,
  installationDigest: z.string(),
  packages: z.array(z.object({ name: z.string(), version: z.string() })),
})
type Receipt = z.infer<typeof receiptSchema>
export interface AuthorInstallation {
  directory: string
  manifestVersion: string
  installationDigest: string
  packages: Array<{ name: string; version: string }>
}
function dependenciesOf(input: unknown) {
  if (input === undefined) return {}
  if (!isRecord(input) || Object.keys(input).length > 200)
    throw new WorkspaceError('INSTALL_DEPENDENCY_INVALID', 'dependencies 需要有效的依赖声明', 'package.json')
  const result: Record<string, string> = {}
  for (const [name, spec] of Object.entries(input).sort(([a], [b]) => a.localeCompare(b))) {
    if (
      !namePattern.test(name) ||
      name.length > 214 ||
      name === 'node_modules' ||
      typeof spec !== 'string' ||
      !spec.trim() ||
      spec.length > 256 ||
      (!validRange(spec) && !localSpec.test(spec))
    )
      throw new WorkspaceError('INSTALL_DEPENDENCY_INVALID', `不支持的内容依赖：${name}`, 'package.json')
    result[name] = spec
  }
  return result
}
async function canonicalDirectory(path: string, create = false) {
  if (create)
    await mkdir(path, { mode: 0o700 }).catch(error => {
      if (errorCode(error) !== 'EEXIST') throw error
    })
  if ((await realpath(path)) !== path || !(await lstat(path)).isDirectory())
    throw new WorkspaceError('MATERIAL_PATH_ESCAPE', '安装目录必须是项目内的普通目录')
  return path
}
async function storeDirectory(root: string, create = false) {
  const state = await canonicalDirectory(join(root, '.arcadia'), create)
  return canonicalDirectory(join(state, 'dependencies'), create)
}
async function projectLock(root: string) {
  const path = join(root, 'package-lock.json')
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new WorkspaceError('INSTALL_LOCK_INVALID', '锁文件无效')
    return await readFile(path, 'utf8')
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }
}
async function archiveVersions(root: string, specs: Iterable<string>) {
  const versions: Record<string, string> = {}
  for (const spec of new Set(specs)) {
    if (!localSpec.test(spec)) continue
    const path = join(root, spec.slice(5))
    try {
      const info = await lstat(path)
      if (!info.isFile() || (await realpath(path)) !== path)
        throw new WorkspaceError('MATERIAL_PATH_ESCAPE', '本地归档必须是 candidates 下的普通文件')
      if (info.size > 256 * 1024 * 1024) throw new WorkspaceError('MATERIAL_LIMIT', '本地候选归档过大')
      versions[spec] = await sha256StreamHex(createReadStream(path))
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error
    }
  }
  return versions
}
function result(store: string, receipt: Receipt): AuthorInstallation {
  return {
    directory: join(store, receipt.generation),
    manifestVersion: receipt.manifestVersion,
    installationDigest: receipt.installationDigest,
    packages: receipt.packages,
  }
}

/** Resolves only the immutable consumer matching the project's current dependency declarations. */
export async function findAuthorInstallation(
  root: string,
  input: unknown,
  materialRoot = root,
): Promise<AuthorInstallation | undefined> {
  root = await realpath(root)
  materialRoot = await realpath(materialRoot)
  try {
    const store = await storeDirectory(root)
    const receipt = receiptSchema.parse(await readJson(join(store, 'active.json')))
    const dependencies = dependenciesOf(input)
    if (receipt.declarations !== sha256Hex(JSON.stringify(dependencies))) return
    const lock = await projectLock(materialRoot)
    if (receipt.lockVersion !== (lock === undefined ? null : sha256Hex(lock))) return
    const archives = await archiveVersions(materialRoot, Object.keys(receipt.archives))
    if (Object.entries(archives).some(([spec, version]) => receipt.archives[spec] !== version)) return
    const installed = result(store, receipt)
    await canonicalDirectory(installed.directory)
    await canonicalDirectory(join(installed.directory, 'node_modules'))
    await canonicalDirectory(join(store, 'npm-cache'))
    return installed
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }
}

/** Stage the locked dependencies alongside a newly packed author candidate. */
export async function stageInstalledDependencies(
  receipt: AuthorInstallation,
  declared: unknown,
  installation: string,
  dependencies: Record<string, string>,
  sources: string[],
  environmentLock?: string,
) {
  const manifest = await readJson(join(receipt.directory, 'package.json'))
  const installed = dependenciesOf(manifest.dependencies)
  const requested = dependenciesOf(declared)
  // npm resolves file: dependencies relative to the package declaring them. Reference
  // the consumer's direct dependency so an author archive can reuse the installed bytes.
  const localOverrides: Record<string, string> = {}
  for (const [name, spec] of Object.entries(installed)) {
    if (localSpec.test(spec)) localOverrides[name] = '$' + name
    if (!sources.includes(name) && (!Object.hasOwn(dependencies, name) || dependencies[name] === requested[name]))
      dependencies[name] = spec
  }
  const candidates = await canonicalDirectory(join(receipt.directory, 'candidates'))
  for (const entry of await readdir(candidates, { withFileTypes: true })) {
    if (!entry.isFile() || !localSpec.test('file:candidates/' + entry.name))
      throw new WorkspaceError('MATERIAL_PATH_ESCAPE', '已安装候选归档无效')
    const target = join(installation, 'candidates', entry.name)
    const source = join(candidates, entry.name)
    try {
      await copyFile(source, target, constants.COPYFILE_EXCL)
    } catch (error) {
      if (
        errorCode(error) !== 'EEXIST' ||
        (await sha256StreamHex(createReadStream(source))) !== (await sha256StreamHex(createReadStream(target)))
      )
        throw error
    }
  }
  const lock = await projectLock(receipt.directory)
  if (!lock) throw new WorkspaceError('INSTALL_LOCK_INVALID', '已安装的资料包缺少锁文件')
  if (!environmentLock) return { lock, localOverrides }
  const previous = JSON.parse(environmentLock)
  const durable = JSON.parse(lock)
  checkLock(previous, true)
  for (const [location, pin] of Object.entries(durable.packages)) {
    if (!location) continue
    const name = location.slice('node_modules/'.length)
    if (!sources.includes(name) && dependencies[name] === installed[name]) previous.packages[location] = pin
  }
  return { lock: JSON.stringify(previous), localOverrides }
}

export async function installAuthorDependencies(
  workspace: AuthorWorkspace,
  {
    expectedVersion,
    offline = false,
    signal,
  }: {
    expectedVersion: string
    offline?: boolean
    signal?: AbortSignal
  },
): Promise<AuthorInstallation> {
  signal?.throwIfAborted()
  await workspace.assertWritable()
  const source = await workspace.read('package.json')
  const conflict = () =>
    new WorkspaceError('REVISION_CONFLICT', '安装期间依赖声明或材料已改变，请重新读取', 'package.json')
  if (source.version !== expectedVersion) throw conflict()
  const dependencies = dependenciesOf(JSON.parse(source.text).dependencies)
  const root = workspace.root
  const current = await findAuthorInstallation(root, dependencies)
  if (current) return { ...current, manifestVersion: source.version }
  const store = await storeDirectory(root, true)
  const directory = await mkdtemp(join(store, 'install-'))
  let committed = false
  try {
    const lock = await projectLock(root)
    const archiveSpecs = new Set(Object.values(dependencies))
    const lockedPackages: unknown = lock && JSON.parse(lock).packages
    if (isRecord(lockedPackages))
      for (const pin of Object.values(lockedPackages)) {
        if (isRecord(pin) && typeof pin.resolved === 'string' && localSpec.test(pin.resolved))
          archiveSpecs.add(pin.resolved)
      }
    const archives = await archiveVersions(root, archiveSpecs)
    const specs = { ...dependencies }
    await mkdir(join(directory, 'candidates'))
    const { lockText } = await stageEnvironmentDependencies({
      materialRoot: root,
      sourceRoot: root,
      installation: directory,
      dependencies: specs,
      // Use an npm archive for the base so captured dependencies can also be reused when debugging a pack.
      hasSources: true,
      lockText: lock,
      sourceLocked: lock !== undefined,
    })
    const captured = await archiveVersions(directory, Object.keys(archives))
    if (JSON.stringify(captured) !== JSON.stringify(archives)) throw conflict()
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ name: 'arcadia-author-dependencies', version: '1.0.0', private: true, dependencies: specs }),
    )
    if (lockText) await writeFile(join(directory, 'package-lock.json'), lockText)
    const cache = await canonicalDirectory(join(store, 'npm-cache'), true)
    const config = join(directory, 'empty.npmrc')
    const env = installationEnvironment(cache, config)
    const timeout = AbortSignal.timeout(120_000)
    const activeSignal = signal ? AbortSignal.any([timeout, signal]) : timeout
    for (const args of [['install', '--package-lock-only', '--lockfile-version=3'], ['ci']]) {
      const npm = await resolveNpmInvocation([
        ...args,
        '--workspaces=false',
        '--ignore-scripts',
        '--no-bin-links',
        '--omit=dev',
        '--no-audit',
        '--no-fund',
        ...(offline ? ['--offline'] : []),
      ])
      try {
        await exec(npm.file, npm.args, {
          cwd: directory,
          env,
          signal: activeSignal,
          maxBuffer: 2 * 1024 * 1024,
          timeout: 120_000,
          windowsHide: true,
        })
      } catch (error) {
        activeSignal.throwIfAborted()
        const code =
          isRecord(error) && typeof error.stderr === 'string'
            ? /^npm (?:error|ERR!) code ([A-Z][A-Z0-9_]{1,40})$/m.exec(error.stderr)?.[1]
            : undefined
        throw new WorkspaceError(
          'NPM_INSTALL_FAILED',
          `npm ${args[0]} 未能安装声明的资料包${offline ? '（离线模式）' : ''}${code ? '：' + code : ''}`,
        )
      }
      if (args[0] === 'install') checkLock(await readJson(join(directory, 'package-lock.json'), 16 * 1024 * 1024), true)
    }
    await mkdir(join(directory, 'node_modules'), { recursive: true })
    await materialFiles(directory, { signal: activeSignal })
    const installed = await inspectNpmProject(directory)
    const receipt: Receipt = {
      generation: directory.slice(store.length + 1),
      declarations: sha256Hex(JSON.stringify(dependencies)),
      lockVersion: lock === undefined ? null : sha256Hex(lock),
      archives,
      manifestVersion: source.version,
      installationDigest: installed.digest,
      packages: installed.packages.map(({ name, version }) => ({ name, version })),
    }
    return await withSourceLock(root, source.file, async () => {
      await workspace.assertWritable()
      if ((await workspace.read(source.file)).version !== source.version || (await projectLock(root)) !== lock)
        throw conflict()
      const latest = await archiveVersions(root, archiveSpecs)
      if (JSON.stringify(latest) !== JSON.stringify(archives)) throw conflict()
      const existing = await findAuthorInstallation(root, dependencies)
      if (existing) return { ...existing, manifestVersion: source.version }
      activeSignal.throwIfAborted()
      await writeFileAtomic(join(store, 'active.json'), JSON.stringify(receipt), { mode: 0o600 })
      committed = true
      return result(store, receipt)
    })
  } finally {
    if (!committed) await rm(directory, { recursive: true, force: true })
  }
}
