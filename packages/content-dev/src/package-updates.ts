import { sha256Hex } from '@arcadia-eternity/const'
import { catalogMaterialDigest } from '@arcadia-eternity/pack-loader/node'
import { officialEnvironmentCatalog, type OfficialEnvironmentCatalog } from './official-environments.ts'
import semver from 'semver'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { acquireSource } from './managed-sources.ts'
import { errorCode, isRecord } from './types.ts'

export const officialPackage = '@arcadia-eternity/data-pack-base'

export interface PackageUpdate {
  name: string
  version: string
  range: string
  url: string
  integrity: string
}

export function startAutomaticContentUpdates(
  update: (options: { signal: AbortSignal }) => Promise<unknown>,
  onError: (error: unknown) => void,
) {
  const controller = new AbortController()
  let running: Promise<void> | undefined
  let timer: NodeJS.Timeout
  function schedule(delay: number) {
    timer = setTimeout(() => {
      running = check()
    }, delay)
    timer.unref()
  }
  async function check() {
    let delay = 6 * 60 * 60 * 1000
    try {
      await update({ signal: controller.signal })
    } catch (error) {
      if (controller.signal.aborted) return
      onError(error)
      delay = 15 * 60 * 1000
    }
    if (!controller.signal.aborted) schedule(delay)
  }
  schedule(3000)
  return () => {
    controller.abort()
    clearTimeout(timer)
    return running
  }
}

export function selectPackageUpdate(
  metadata: unknown,
  name: string,
  current: string,
  client: string,
): PackageUpdate | null {
  if (
    !isRecord(metadata) ||
    metadata.name !== name ||
    !isRecord(metadata.versions) ||
    !isRecord(metadata['dist-tags']) ||
    typeof metadata['dist-tags'].latest !== 'string' ||
    !semver.valid(metadata['dist-tags'].latest)
  )
    throw new Error('npm 返回了无效的包版本清单')
  const latest = metadata['dist-tags'].latest
  const candidates = Object.keys(metadata.versions)
    .filter(
      version =>
        semver.valid(version) &&
        !semver.prerelease(version) &&
        semver.gt(version, current) &&
        semver.lte(version, latest),
    )
    .sort(semver.rcompare)
  for (const version of candidates) {
    const pkg = metadata.versions[version]
    if (!isRecord(pkg)) throw new Error('npm 返回了无效的包版本清单')
    const range = isRecord(pkg.engines) && pkg.engines.arcadia
    if (
      pkg.deprecated ||
      typeof range !== 'string' ||
      !range.trim() ||
      range.length > 256 ||
      !semver.satisfies(client, range)
    )
      continue
    const expected = `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${version}.tgz`
    if (
      pkg.version !== version ||
      !isRecord(pkg.dist) ||
      pkg.dist.tarball !== expected ||
      typeof pkg.dist.integrity !== 'string' ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(pkg.dist.integrity)
    )
      throw new Error('npm 返回了无效的发行归档')
    return { name, version, range, url: expected, integrity: pkg.dist.integrity }
  }
  return null
}

export async function findPackageUpdate(name: string, current: string, client: string, signal?: AbortSignal) {
  const url = 'https://registry.npmjs.org/' + encodeURIComponent(name)
  const metadata = await registryJson(url, 'application/vnd.npm.install-v1+json', signal)
  return selectPackageUpdate(metadata, name, current, client)
}

async function registryJson(url: string, accept: string, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(20000)
  const response = await fetch(url, {
    headers: { Accept: accept },
    redirect: 'error',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (!response.ok) throw new Error('无法检查 npm 包更新（HTTP ' + response.status + '）')
  // The full version history is needed to find a compatible release below latest.
  const limit = 8 * 1024 * 1024
  if (!response.body || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel()
    throw new Error('npm 版本清单过大或为空')
  }
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > limit) throw new Error('npm 版本清单过大')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function acquireOfficial(candidate: PackageUpdate, destination: string, signal: AbortSignal) {
  if (
    candidate.name !== officialPackage ||
    !semver.valid(candidate.version) ||
    typeof candidate.range !== 'string' ||
    !candidate.range.trim() ||
    candidate.range.length > 256 ||
    !semver.validRange(candidate.range) ||
    candidate.url !== `https://registry.npmjs.org/${officialPackage}/-/data-pack-base-${candidate.version}.tgz` ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/.test(candidate.integrity)
  )
    throw new Error('INVALID_OFFICIAL_PACKAGE')
  const { directory } = await acquireSource(
    { kind: 'url', url: candidate.url, integrity: candidate.integrity },
    { destination, signal },
  )
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  if (
    manifest.name !== officialPackage ||
    manifest.version !== candidate.version ||
    manifest.engines?.arcadia !== candidate.range ||
    manifest.arcadia?.projectId !== 'base' ||
    manifest.arcadia?.namespace !== 'base'
  )
    throw new Error('INVALID_OFFICIAL_PACKAGE')
  const catalog = await officialEnvironmentCatalog(candidate.version, name =>
    registryJson(
      'https://registry.npmjs.org/' + encodeURIComponent(name) + '/' + candidate.version,
      'application/json',
      signal,
    ),
  )
  return { directory, catalog }
}

export async function withOfficialUpdateDirectory<T>(
  candidate: PackageUpdate,
  signal: AbortSignal,
  use: (directory: string, catalog: OfficialEnvironmentCatalog) => Promise<T>,
) {
  const stage = await mkdtemp(join(tmpdir(), 'arcadia-official-update-'))
  try {
    const { directory, catalog } = await acquireOfficial(candidate, join(stage, 'source'), signal)
    return await use(directory, catalog)
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

/** Only completed version directories are eligible. Offline startup never contacts the registry. */
export async function selectServerBase(
  store: string,
  shipped: string,
  host: string,
  pin?: string,
  validate?: (directory: string) => Promise<void>,
) {
  const bundled = JSON.parse(await readFile(join(shipped, 'package.json'), 'utf8'))
  const fallback = { directory: shipped, version: bundled.version as string, cached: false }
  const bundledCompatible = bundled.engines?.arcadia === undefined || semver.satisfies(host, bundled.engines.arcadia)
  if (pin === 'bundled') {
    if (!bundledCompatible) throw new Error('INCOMPATIBLE_OFFICIAL_PACKAGE')
    await validate?.(shipped)
    return fallback
  }
  if (pin && semver.valid(pin) !== pin) throw new Error('Invalid base pack version: ' + pin)
  const entries = await readdir(store, { withFileTypes: true }).catch(error => {
    if (errorCode(error) === 'ENOENT') return []
    throw error
  })
  const candidates = entries
    .filter(entry => entry.isDirectory() && semver.valid(entry.name) === entry.name)
    .map(entry => ({ directory: join(store, entry.name, 'package'), version: entry.name, cached: true }))
  if (bundledCompatible) candidates.push(fallback)
  // Inspect cached ties first to detect an ambiguous release while retaining the shipped reference.
  candidates.sort((a, b) => semver.rcompare(a.version, b.version))
  let lastError
  for (const candidate of candidates) {
    const { directory, version, cached } = candidate
    if (pin && version !== pin) continue
    try {
      if (cached) {
        const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
        if (manifest.name !== officialPackage || manifest.version !== version)
          throw new Error('INVALID_OFFICIAL_PACKAGE')
        if (!manifest.engines?.arcadia?.trim() || !semver.satisfies(host, manifest.engines.arcadia)) continue
        const digest = await catalogMaterialDigest(directory)
        const release = dirname(directory)
        const catalog = await readFile(join(release, 'official-environments.json'), 'utf8')
        const recorded = await readFile(join(release, '.arcadia-release-digest'), 'utf8')
        if (sha256Hex(digest, '\0', catalog) !== recorded) throw new Error('OFFICIAL_MATERIAL_DIGEST_MISMATCH')
        if (version === bundled.version && bundledCompatible) {
          if (digest !== (await catalogMaterialDigest(shipped)))
            console.warn('OFFICIAL_BASE_VERSION_CONFLICT', version, 'using bundled materials')
          continue
        }
      }
      await validate?.(directory)
      return candidate
    } catch (error) {
      lastError = error
      console.warn('Skipping unusable official base', version, directory, error)
    }
  }
  throw new Error('No compatible installed base pack ' + (pin ? 'at version ' + pin : 'for Arcadia ' + host), {
    cause: lastError,
  })
}

export async function installServerBaseUpdate(
  store: string,
  candidate: PackageUpdate,
  host: string,
  validate: (directory: string, signal: AbortSignal) => Promise<void>,
  options: { signal?: AbortSignal; beforeCommit?: (directory: string) => Promise<void> } = {},
) {
  if (!semver.satisfies(host, candidate.range)) throw new Error('INCOMPATIBLE_OFFICIAL_PACKAGE')
  await mkdir(store, { recursive: true, mode: 0o700 })
  const stage = await mkdtemp(join(store, '.install-'))
  try {
    const timeout = AbortSignal.timeout(120000)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    const release = join(stage, 'release')
    const { directory, catalog } = await acquireOfficial(candidate, release, signal)
    const catalogText = JSON.stringify(catalog)
    await writeFile(join(release, 'official-environments.json'), catalogText)
    await validate(directory, signal)
    const digest = sha256Hex(await catalogMaterialDigest(directory), '\0', catalogText)
    await writeFile(join(release, '.arcadia-release-digest'), digest)
    signal.throwIfAborted()
    await options.beforeCommit?.(directory)
    options.signal?.throwIfAborted()
    try {
      await rename(release, join(store, candidate.version))
    } catch (error) {
      // Concurrent installers can only publish a complete, verified directory at this version.
      if (!['EEXIST', 'ENOTEMPTY'].includes(errorCode(error) ?? '')) throw error
      const installed = join(store, candidate.version)
      const installedDigest = sha256Hex(
        await catalogMaterialDigest(join(installed, 'package')),
        '\0',
        await readFile(join(installed, 'official-environments.json'), 'utf8'),
      )
      if (installedDigest !== digest)
        throw new Error('OFFICIAL_BASE_VERSION_CONFLICT: ' + candidate.version, { cause: error })
    }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}
