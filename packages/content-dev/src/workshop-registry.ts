import { createPublicKey, verify as verifySignature } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { Readable } from 'node:stream'
import { compare, valid, validRange } from 'semver'
import {
  INDEX_MAX_BYTES,
  canonicalJson,
  parseEnvelope,
  parseIndex,
  parseProject,
  parseRoot,
  parseSnapshot,
  sha256Hex,
  signEnvelope,
  verifyThreshold,
  isExactVersion,
  type SignedEnvelope,
  type WorkshopIndex,
  type WorkshopProject,
  type WorkshopRelease,
  type WorkshopRevocation,
  type WorkshopRoot,
  type WorkshopSigningKey,
  type WorkshopSnapshot,
} from '@arcadia-eternity/pack-loader/workshop'
import { matchesArchiveIntegrity, tarFiles } from './managed-sources.ts'
import { errorMessage, isRecord } from './types.ts'
import { contentError } from './workspace-materials.ts'

const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com'
const OID_COMMIT = '1.3.6.1.4.1.57264.1.3'
const OID_REPOSITORY = '1.3.6.1.4.1.57264.1.5'
const SLSA_V1 = 'https://slsa.dev/provenance/v1'
const TARBALL_MAX_BYTES = 256 * 1024 * 1024
const PACKUMENT_MAX_BYTES = 64 * 1024 * 1024
const lifecycleScripts = ['preinstall', 'install', 'postinstall', 'preuninstall', 'postuninstall']

export interface NpmPackument {
  name: string
  versions: Record<string, NpmVersion>
  time?: Record<string, string>
}
interface NpmVersion {
  name: string
  version: string
  dist: {
    integrity?: string
    tarball: string
    signatures?: { keyid: string; sig: string }[]
    attestations?: { url: string }
  }
}
export interface NpmRegistryKey {
  keyid: string
  key: string
  expires: string | null
}
export interface ProvenancePolicy {
  repository: string
  commit: string
}
/** Network and signature operations, injected so registry rules can be tested without npm. */
export interface WorkshopNpm {
  packument(name: string, signal: AbortSignal): Promise<NpmPackument | null>
  registryKeys(signal: AbortSignal): Promise<NpmRegistryKey[]>
  attestations(
    name: string,
    version: string,
    signal: AbortSignal,
  ): Promise<{ predicateType: string; bundle: unknown }[]>
  tarball(url: string, maxBytes: number, signal: AbortSignal): Promise<Buffer>
  verifyBundle(bundle: unknown, policy: ProvenancePolicy): Promise<void>
}

async function bytes(url: string, maxBytes: number, signal: AbortSignal) {
  const response = await fetch(url, { redirect: 'error', signal })
  if (response.status === 404) {
    await response.body?.cancel()
    return null
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw contentError('WORKSHOP_NPM_FAILED', `${url}: HTTP ${response.status}`)
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of response.body) {
    total += chunk.length
    if (total > maxBytes) {
      await response.body.cancel().catch(() => {})
      throw contentError('SOURCE_LIMIT')
    }
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks, total)
}
const json = async (url: string, maxBytes: number, signal: AbortSignal) => {
  const body = await bytes(url, maxBytes, signal)
  return body && (JSON.parse(body.toString('utf8')) as unknown)
}
const escapedName = (name: string) => (name.startsWith('@') ? '@' + encodeURIComponent(name.slice(1)) : name)

export function npmRegistry(base = 'https://registry.npmjs.org'): WorkshopNpm {
  const root = base.replace(/\/+$/, '')
  let keys: Promise<NpmRegistryKey[]> | undefined
  return {
    async packument(name, signal) {
      const value = await json(`${root}/${escapedName(name)}`, PACKUMENT_MAX_BYTES, signal)
      if (value === null) return null
      if (!isRecord(value) || value.name !== name || !isRecord(value.versions))
        throw contentError('WORKSHOP_NPM_INVALID', name)
      return value as unknown as NpmPackument
    },
    registryKeys(signal) {
      keys ??= json(`${root}/-/npm/v1/keys`, 1024 * 1024, signal).then(value => {
        if (!isRecord(value) || !Array.isArray(value.keys)) throw contentError('WORKSHOP_NPM_INVALID', 'keys')
        return value.keys as NpmRegistryKey[]
      })
      return keys
    },
    async attestations(name, version, signal) {
      const value = await json(
        `${root}/-/npm/v1/attestations/${escapedName(name)}@${encodeURIComponent(version)}`,
        8 * 1024 * 1024,
        signal,
      )
      if (value === null) return []
      if (!isRecord(value) || !Array.isArray(value.attestations))
        throw contentError('WORKSHOP_NPM_INVALID', 'attestations')
      return value.attestations as { predicateType: string; bundle: unknown }[]
    },
    async tarball(url, maxBytes, signal) {
      const parsed = new URL(url)
      if (parsed.origin !== new URL(root).origin) throw contentError('WORKSHOP_TARBALL_ORIGIN')
      const body = await bytes(url, maxBytes, signal)
      if (!body) throw contentError('WORKSHOP_TARBALL_MISSING', url)
      return body
    },
    async verifyBundle(bundle, policy) {
      const { verify } = await import('sigstore')
      await verify(bundle as never, {
        certificateIssuer: GITHUB_ISSUER,
        certificateOIDs: { [OID_REPOSITORY]: policy.repository, [OID_COMMIT]: policy.commit },
      })
    },
  }
}

export const purl = (name: string, version: string) =>
  `pkg:npm/${name.startsWith('@') ? '%40' + name.slice(1) : name}@${version}`

function verifyRegistrySignature(entry: NpmVersion, keys: NpmRegistryKey[], publishedAt: string) {
  const integrity = entry.dist.integrity!
  const message = `${entry.name}@${entry.version}:${integrity}`
  for (const signature of entry.dist.signatures ?? []) {
    const key = keys.find(item => item.keyid === signature.keyid)
    if (!key || (key.expires && Date.parse(publishedAt) >= Date.parse(key.expires))) continue
    const publicKey = createPublicKey({ key: Buffer.from(key.key, 'base64'), format: 'der', type: 'spki' })
    if (verifySignature('sha256', Buffer.from(message), publicKey, Buffer.from(signature.sig, 'base64'))) return
  }
  throw contentError('WORKSHOP_NPM_SIGNATURE', 'No valid npm registry signature')
}

const repositoryUrl = (value: unknown) => {
  const raw = typeof value === 'string' ? value : isRecord(value) ? value.url : undefined
  if (typeof raw !== 'string') return undefined
  return raw
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/** Verify one npm release against its registry declaration and return its signed index record. */
export async function verifyNpmRelease(
  project: Pick<WorkshopProject, 'kind' | 'npm' | 'repository'>,
  packument: NpmPackument,
  version: string,
  npm: WorkshopNpm,
  signal: AbortSignal,
): Promise<WorkshopRelease> {
  const entry = packument.versions[version]
  const publishedAt = packument.time?.[version]
  if (!entry || entry.name !== project.npm || entry.version !== version || !isExactVersion(version))
    throw contentError('WORKSHOP_RELEASE_INVALID', 'Version metadata does not match')
  if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) throw contentError('WORKSHOP_RELEASE_INVALID', 'time')
  const integrity = entry.dist?.integrity
  if (typeof integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity))
    throw contentError('WORKSHOP_RELEASE_INVALID', 'Release needs a sha512 integrity')
  verifyRegistrySignature(entry, await npm.registryKeys(signal), publishedAt)

  const attestations = await npm.attestations(project.npm, version, signal)
  const provenance = attestations.find(item => item.predicateType === SLSA_V1)
  const payload =
    provenance && isRecord(provenance.bundle) && isRecord(provenance.bundle.dsseEnvelope)
      ? provenance.bundle.dsseEnvelope.payload
      : undefined
  if (typeof payload !== 'string')
    throw contentError('WORKSHOP_PROVENANCE_MISSING', 'Publish with npm provenance from GitHub Actions')
  const statement: unknown = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
  if (!isRecord(statement) || !Array.isArray(statement.subject) || !isRecord(statement.predicate))
    throw contentError('WORKSHOP_PROVENANCE_INVALID')
  const hex = Buffer.from(integrity.slice(7), 'base64').toString('hex')
  const subject = statement.subject[0]
  if (
    statement.subject.length !== 1 ||
    !isRecord(subject) ||
    subject.name !== purl(project.npm, version) ||
    !isRecord(subject.digest) ||
    subject.digest.sha512 !== hex
  )
    throw contentError('WORKSHOP_PROVENANCE_SUBJECT', 'Provenance subject differs from the npm archive')
  const definition = isRecord(statement.predicate.buildDefinition) ? statement.predicate.buildDefinition : {}
  const external = isRecord(definition.externalParameters) ? definition.externalParameters : {}
  const workflow = isRecord(external.workflow) ? external.workflow : {}
  const dependency = Array.isArray(definition.resolvedDependencies) ? definition.resolvedDependencies[0] : undefined
  const commit = isRecord(dependency) && isRecord(dependency.digest) ? dependency.digest.gitCommit : undefined
  const built =
    typeof workflow.repository === 'string'
      ? /^https:\/\/github\.com\/([^/]+\/[^/]+)$/.exec(workflow.repository)?.[1]
      : undefined
  if (
    !built ||
    built.toLowerCase() !== project.repository.toLowerCase() ||
    typeof workflow.path !== 'string' ||
    typeof workflow.ref !== 'string' ||
    typeof commit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(commit)
  )
    throw contentError('WORKSHOP_PROVENANCE_REPOSITORY', `Release was not built from ${project.repository}`)
  // The Fulcio certificate binds the signature to the same repository and commit as the statement.
  try {
    await npm.verifyBundle(provenance!.bundle, { repository: built, commit })
  } catch (error) {
    throw contentError('WORKSHOP_PROVENANCE_INVALID', errorMessage(error))
  }

  const archive = await npm.tarball(entry.dist.tarball, TARBALL_MAX_BYTES, signal)
  if (!matchesArchiveIntegrity(archive, integrity)) throw contentError('SOURCE_INTEGRITY_MISMATCH')
  const files = await tarFiles(Readable.from([archive]), {
    signal,
    maxBytes: TARBALL_MAX_BYTES,
    maxFiles: 50000,
    timeoutMs: 120_000,
  })
  const raw = files.find(file => file.name === 'package/package.json')
  if (!raw) throw contentError('WORKSHOP_RELEASE_INVALID', 'package.json is missing')
  const manifest: unknown = JSON.parse(raw.bytes.toString('utf8'))
  if (!isRecord(manifest) || manifest.name !== project.npm || manifest.version !== version)
    throw contentError('SOURCE_PACKAGE_IDENTITY_MISMATCH')
  if (repositoryUrl(manifest.repository) !== `https://github.com/${project.repository}`.toLowerCase())
    throw contentError('WORKSHOP_REPOSITORY_MISMATCH', 'package.json repository differs from the declaration')
  const scripts = isRecord(manifest.scripts) ? manifest.scripts : {}
  if (lifecycleScripts.some(name => name in scripts))
    throw contentError('WORKSHOP_LIFECYCLE_SCRIPT', 'Workshop packages cannot declare install scripts')
  let containsCode = false
  let sdkApi: number | undefined
  if (project.kind === 'package') {
    if (!isRecord(manifest.arcadia) || manifest.arcadiaEnvironment !== undefined)
      throw contentError('WORKSHOP_KIND_MISMATCH', 'Content packages need an arcadia declaration')
    if (manifest.arcadia.effects && !manifest.arcadia.effectArtifact)
      throw contentError('WORKSHOP_EFFECT_ARTIFACT_REQUIRED', 'Publish prebuilt effects with the release workflow')
    containsCode = !!(manifest.arcadia.effects || manifest.arcadia.effectArtifact)
    if (Number.isSafeInteger(manifest.arcadia.sdkApi)) sdkApi = manifest.arcadia.sdkApi as number
  } else if (!isRecord(manifest.arcadiaEnvironment) || manifest.arcadia !== undefined)
    throw contentError('WORKSHOP_KIND_MISMATCH', 'Environment packages need an arcadiaEnvironment declaration')
  const engines = isRecord(manifest.engines) ? manifest.engines.arcadia : undefined
  if (engines !== undefined && (typeof engines !== 'string' || !validRange(engines)))
    throw contentError('WORKSHOP_RELEASE_INVALID', 'engines.arcadia')
  const dependencies = isRecord(manifest.dependencies) ? manifest.dependencies : {}
  for (const [name, range] of Object.entries(dependencies))
    if (typeof range !== 'string' || !validRange(range))
      throw contentError('WORKSHOP_RELEASE_INVALID', `Dependency ${name} needs a registry version range`)
  return {
    version,
    integrity,
    tarball: entry.dist.tarball,
    size: archive.length,
    publishedAt: new Date(publishedAt).toISOString(),
    ...(engines !== undefined && { arcadia: engines }),
    ...(sdkApi !== undefined && { sdkApi }),
    dependencies: dependencies as Record<string, string>,
    containsCode,
    provenance: { repository: built, workflow: `${workflow.path}@${workflow.ref}`, commit },
  }
}

export interface RegistrySource {
  roots: SignedEnvelope<WorkshopRoot>[]
  root: WorkshopRoot
  projects: WorkshopProject[]
  revocations: WorkshopRevocation[]
}

async function readJsonFile(file: string, maxBytes = 1024 * 1024): Promise<unknown> {
  const info = await lstat(file)
  if (!info.isFile() || info.size > maxBytes) throw contentError('WORKSPACE_FILE_INVALID', file)
  return JSON.parse(await readFile(file, 'utf8'))
}

const declarationFields = [
  'id',
  'kind',
  'npm',
  'title',
  'summary',
  'authors',
  'repository',
  'tags',
  'license',
  'homepage',
  'official',
  'featured',
]

/** Verify the local root chain from root/1.json and read the reviewed declarations. */
export async function loadRegistrySource(directory: string): Promise<RegistrySource> {
  const roots: SignedEnvelope<WorkshopRoot>[] = []
  const rootFiles = (await readdir(join(directory, 'root'))).filter(name => /^\d+\.json$/.test(name))
  if (!rootFiles.length) throw contentError('WORKSHOP_ROOT_MISSING')
  let previous: WorkshopRoot | undefined
  for (let version = 1; version <= rootFiles.length; version++) {
    if (!rootFiles.includes(`${version}.json`)) throw contentError('WORKSHOP_ROOT_CHAIN', `root/${version}.json`)
    const envelope = parseEnvelope(await readJsonFile(join(directory, 'root', `${version}.json`)))
    const root = parseRoot(envelope.signed)
    if (root.version !== version || (previous && root.registry !== previous.registry))
      throw contentError('WORKSHOP_ROOT_CHAIN', `root/${version}.json`)
    const signed = envelope as SignedEnvelope<{ type: string }>
    if (previous) await verifyThreshold(signed, previous.keys, previous.roles.root)
    await verifyThreshold(signed, root.keys, root.roles.root)
    roots.push({ signed: root, signatures: envelope.signatures })
    previous = root
  }
  const projects: WorkshopProject[] = []
  for (const name of (await readdir(join(directory, 'projects'))).sort()) {
    if (!name.endsWith('.json')) continue
    const value = await readJsonFile(join(directory, 'projects', name))
    if (!isRecord(value) || Object.keys(value).some(key => !declarationFields.includes(key)))
      throw contentError('WORKSHOP_DECLARATION_INVALID', `projects/${name}: unknown field`)
    let project: WorkshopProject
    try {
      project = parseProject({ official: false, featured: false, ...value, releases: [] }, `projects/${name}`)
    } catch (error) {
      throw contentError('WORKSHOP_DECLARATION_INVALID', errorMessage(error))
    }
    if (basename(name, '.json') !== project.id)
      throw contentError('WORKSHOP_DECLARATION_INVALID', `projects/${name}: file name must equal id`)
    projects.push(project)
  }
  for (const key of ['id', 'npm'] as const)
    if (new Set(projects.map(project => project[key])).size !== projects.length)
      throw contentError('WORKSHOP_DECLARATION_DUPLICATE', key)
  const revocationFile = join(directory, 'revocations.json')
  const revocations = await readJsonFile(revocationFile).catch(error => {
    if (error?.code === 'ENOENT') return []
    throw error
  })
  const parsed = parseIndex({
    type: 'index',
    spec: 1,
    registry: previous!.registry,
    generatedAt: new Date(0).toISOString(),
    projects: [],
    revocations,
  })
  return { roots, root: previous!, projects, revocations: parsed.revocations }
}

export interface ReleaseDiagnostic {
  project: string
  version: string
  code: string
  message: string
}

const versionOrder = (a: WorkshopRelease, b: WorkshopRelease) => compare(b.version, a.version)

/** Verify every release that the previous index does not already carry. */
async function discoverReleases(
  project: WorkshopProject,
  previous: WorkshopProject | undefined,
  npm: WorkshopNpm,
  signal: AbortSignal,
  budget: { remaining: number },
  diagnostics: ReleaseDiagnostic[],
) {
  const packument = await npm.packument(project.npm, signal)
  if (!packument) {
    diagnostics.push({ project: project.id, version: '*', code: 'WORKSHOP_NPM_MISSING', message: 'Not on npm' })
    return []
  }
  const carry =
    previous &&
    previous.npm === project.npm &&
    previous.repository === project.repository &&
    previous.kind === project.kind
      ? new Map(previous.releases.map(release => [release.version, release]))
      : new Map<string, WorkshopRelease>()
  const releases: WorkshopRelease[] = []
  for (const version of Object.keys(packument.versions).filter(item => valid(item))) {
    const known = carry.get(version)
    if (known && known.integrity === packument.versions[version].dist?.integrity) {
      releases.push(known)
      continue
    }
    if (budget.remaining <= 0) continue
    budget.remaining--
    try {
      releases.push(await verifyNpmRelease(project, packument, version, npm, signal))
    } catch (error) {
      signal.throwIfAborted()
      diagnostics.push({
        project: project.id,
        version,
        code: (error as { code?: string }).code ?? 'WORKSHOP_RELEASE_INVALID',
        message: errorMessage(error),
      })
    }
  }
  return releases.sort(versionOrder)
}

export interface PublishedState {
  snapshot: WorkshopSnapshot
  envelope: SignedEnvelope<WorkshopSnapshot>
  index: WorkshopIndex
  indexBytes: Uint8Array
}

async function localBytes(file: string, maxBytes: number) {
  try {
    const info = await lstat(file)
    if (!info.isFile() || info.size > maxBytes) throw contentError('WORKSPACE_FILE_INVALID', file)
    return await readFile(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * Read a deployed snapshot and verify it against the local root chain. Absent means nothing is published there.
 * `base` is an HTTPS site or a local checkout of the published site.
 */
export async function readPublishedState(
  base: string,
  source: RegistrySource,
  signal: AbortSignal,
): Promise<PublishedState | undefined> {
  const remote = /^https:\/\//.test(base)
  const read = (path: string, maxBytes: number) =>
    remote
      ? bytes((base.endsWith('/') ? base : base + '/') + path, maxBytes, signal)
      : localBytes(join(base, path), maxBytes)
  const raw = await read('snapshot.json', 64 * 1024)
  if (!raw) return undefined
  const envelope = parseEnvelope(JSON.parse(raw.toString('utf8')))
  const snapshot = parseSnapshot(envelope.signed)
  const root = source.roots.find(item => item.signed.version === snapshot.rootVersion)?.signed
  if (!root || snapshot.registry !== source.root.registry) throw contentError('WORKSHOP_PUBLISHED_UNTRUSTED')
  await verifyThreshold(envelope as SignedEnvelope<{ type: string }>, root.keys, root.roles.snapshot)
  const indexBytes = await read(snapshot.index.path, INDEX_MAX_BYTES)
  if (!indexBytes || indexBytes.length !== snapshot.index.length || sha256Hex(indexBytes) !== snapshot.index.sha256)
    throw contentError('WORKSHOP_PUBLISHED_UNTRUSTED', 'Published index differs from its snapshot')
  const index = parseIndex(JSON.parse(Buffer.from(indexBytes).toString('utf8')))
  return { snapshot, envelope: { signed: snapshot, signatures: envelope.signatures }, index, indexBytes }
}

/**
 * The newest snapshot across every published copy. CDN caches can serve an older snapshot for minutes after a
 * deploy; building on it would sign a second, different snapshot with an already used version.
 */
export async function readLatestPublishedState(bases: string[], source: RegistrySource, signal: AbortSignal) {
  let latest: PublishedState | undefined
  const found: { base: string; version: number }[] = []
  for (const base of bases) {
    const state = await readPublishedState(base, source, signal)
    if (!state) continue
    found.push({ base, version: state.snapshot.version })
    if (!latest || state.snapshot.version > latest.snapshot.version) latest = state
  }
  return { latest, found }
}

export interface BuildOptions {
  npm: WorkshopNpm
  signer: WorkshopSigningKey
  previous?: PublishedState
  now?: number
  signal?: AbortSignal
  /** Snapshot lifetime; clients reject older snapshots as frozen. */
  expiresInMs?: number
  /** Re-sign an unchanged index when the published snapshot expires within this margin. */
  renewWithinMs?: number
  maxVerifications?: number
  /** Sign a new snapshot version even when the index is unchanged, superseding any conflicting copy. */
  bump?: boolean
}
export interface BuildResult {
  changed: boolean
  snapshot: WorkshopSnapshot
  index: WorkshopIndex
  diagnostics: ReleaseDiagnostic[]
}

const DAY = 86_400_000

export async function buildRegistrySite(source: RegistrySource, output: string, options: BuildOptions) {
  const signal = options.signal ?? new AbortController().signal
  const now = options.now ?? Date.now()
  if (!source.root.roles.snapshot.keyids.includes(options.signer.keyid))
    throw contentError('WORKSHOP_SIGNER_UNTRUSTED', 'Signing key is not in the snapshot role')
  if (Date.parse(source.root.expires) <= now) throw contentError('WORKSHOP_ROOT_EXPIRED')
  const previous = options.previous
  const diagnostics: ReleaseDiagnostic[] = []
  const budget = { remaining: options.maxVerifications ?? 100 }
  const projects: WorkshopProject[] = []
  for (const project of source.projects) {
    const prior = previous?.index.projects.find(item => item.id === project.id)
    const releases = await discoverReleases(project, prior, options.npm, signal, budget, diagnostics)
    projects.push({ ...project, releases })
  }
  const content = { projects, revocations: source.revocations }
  const unchanged =
    previous &&
    canonicalJson({ projects: previous.index.projects, revocations: previous.index.revocations }) ===
      canonicalJson(content)
  const index: WorkshopIndex = parseIndex({
    type: 'index',
    spec: 1,
    registry: source.root.registry,
    generatedAt: unchanged ? previous.index.generatedAt : new Date(now).toISOString(),
    ...content,
  })
  const fresh =
    !options.bump &&
    unchanged &&
    previous.snapshot.rootVersion === source.root.version &&
    Date.parse(previous.snapshot.expires) - now > (options.renewWithinMs ?? 3 * DAY)
  if (fresh) return { changed: false, snapshot: previous.snapshot, index, diagnostics } satisfies BuildResult
  const indexBytes = new TextEncoder().encode(canonicalJson(index))
  const sha256 = sha256Hex(indexBytes)
  const snapshot: WorkshopSnapshot = {
    type: 'snapshot',
    spec: 1,
    registry: source.root.registry,
    version: (previous?.snapshot.version ?? 0) + 1,
    rootVersion: source.root.version,
    expires: new Date(now + (options.expiresInMs ?? 7 * DAY)).toISOString(),
    index: { path: `objects/${sha256}.json`, sha256, length: indexBytes.length },
  }
  const envelope = await signEnvelope(snapshot, [options.signer])
  await rm(output, { recursive: true, force: true })
  await mkdir(join(output, 'root'), { recursive: true })
  await mkdir(join(output, 'objects'))
  for (const root of source.roots)
    await writeFile(join(output, 'root', `${root.signed.version}.json`), canonicalJson(root))
  await writeFile(join(output, 'root.json'), canonicalJson(source.roots.at(-1)))
  await writeFile(join(output, snapshot.index.path), indexBytes)
  // Keep the prior index so lagging mirrors and in-flight clients can still complete their fetch.
  if (previous && previous.snapshot.index.sha256 !== sha256)
    await writeFile(join(output, previous.snapshot.index.path), previous.indexBytes)
  await writeFile(join(output, 'snapshot.json'), canonicalJson(envelope))
  await writeFile(join(output, '.nojekyll'), '')
  return { changed: true, snapshot, index, diagnostics } satisfies BuildResult
}

export interface CheckResult {
  project: string
  verified: string[]
  diagnostics: ReleaseDiagnostic[]
}

/** Pull-request check: declarations must parse and each checked project needs at least one verifiable release. */
export async function checkRegistrySource(
  source: RegistrySource,
  options: { npm: WorkshopNpm; projects?: string[]; signal?: AbortSignal; maxVersions?: number },
) {
  const results: CheckResult[] = []
  for (const project of source.projects) {
    if (options.projects && !options.projects.includes(project.id)) continue
    results.push(await checkRegistryProject(project, options))
  }
  for (const id of options.projects ?? [])
    if (!source.projects.some(project => project.id === id)) throw contentError('WORKSHOP_PROJECT_UNKNOWN', id)
  return results
}

/** Verify the latest npm releases of one declaration with the same rules the Registry applies. */
export async function checkRegistryProject(
  project: Pick<WorkshopProject, 'id' | 'kind' | 'npm' | 'repository'>,
  options: { npm: WorkshopNpm; signal?: AbortSignal; maxVersions?: number },
): Promise<CheckResult> {
  const signal = options.signal ?? new AbortController().signal
  const diagnostics: ReleaseDiagnostic[] = []
  const packument = await options.npm.packument(project.npm, signal)
  const verified: string[] = []
  if (!packument)
    diagnostics.push({ project: project.id, version: '*', code: 'WORKSHOP_NPM_MISSING', message: 'Not on npm' })
  else {
    const versions = Object.keys(packument.versions)
      .filter(item => valid(item))
      .sort((a, b) => compare(b, a))
      .slice(0, options.maxVersions ?? 3)
    for (const version of versions)
      try {
        await verifyNpmRelease(project, packument, version, options.npm, signal)
        verified.push(version)
      } catch (error) {
        diagnostics.push({
          project: project.id,
          version,
          code: (error as { code?: string }).code ?? 'WORKSHOP_RELEASE_INVALID',
          message: errorMessage(error),
        })
      }
  }
  return { project: project.id, verified, diagnostics }
}
