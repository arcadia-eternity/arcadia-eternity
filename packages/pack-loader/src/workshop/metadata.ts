import { fail } from './encoding'
import { isKeyId, parsePublicKey, type SignedEnvelope, type WorkshopPublicKey, type WorkshopRole } from './signing'

export const WORKSHOP_SPEC = 1
export const ROOT_MAX_BYTES = 256 * 1024
export const SNAPSHOT_MAX_BYTES = 64 * 1024
export const INDEX_MAX_BYTES = 32 * 1024 * 1024

export type WorkshopKind = 'package' | 'environment'

export interface WorkshopRoot {
  type: 'root'
  spec: 1
  registry: string
  version: number
  expires: string
  keys: Record<string, WorkshopPublicKey>
  roles: { root: WorkshopRole; snapshot: WorkshopRole }
  /** Base URLs serving the same signed files; every response is still verified. */
  mirrors: string[]
}

export interface WorkshopObjectRef {
  path: string
  sha256: string
  length: number
}

export interface WorkshopSnapshot {
  type: 'snapshot'
  spec: 1
  registry: string
  version: number
  rootVersion: number
  expires: string
  index: WorkshopObjectRef
}

export interface WorkshopProvenance {
  /** `owner/repo` that built the archive, from the verified npm SLSA provenance. */
  repository: string
  workflow: string
  commit: string
}

export interface WorkshopRelease {
  version: string
  integrity: string
  tarball: string
  size: number
  publishedAt: string
  arcadia?: string
  sdkApi?: number
  dependencies: Record<string, string>
  containsCode: boolean
  provenance: WorkshopProvenance
}

export interface WorkshopProject {
  id: string
  kind: WorkshopKind
  npm: string
  title: string
  summary: string
  authors: string[]
  license?: string
  repository: string
  homepage?: string
  tags: string[]
  official: boolean
  featured: boolean
  releases: WorkshopRelease[]
}

export interface WorkshopRevocation {
  npm: string
  /** Exact version, or `*` for every release of the package. */
  version: string
  reason: string
  revokedAt: string
}

export interface WorkshopIndex {
  type: 'index'
  spec: 1
  registry: string
  generatedAt: string
  projects: WorkshopProject[]
  revocations: WorkshopRevocation[]
}

type Json = Record<string, unknown>
const record = (value: unknown, path: string): Json => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('WORKSHOP_METADATA_INVALID', path)
  return value as Json
}
function exactKeys(value: Json, path: string, required: string[], optional: string[] = []) {
  for (const key of required) if (!(key in value)) fail('WORKSHOP_METADATA_INVALID', `${path}.${key}`)
  for (const key of Object.keys(value))
    if (!required.includes(key) && !optional.includes(key)) fail('WORKSHOP_METADATA_INVALID', `${path}.${key}`)
}
const text = (value: unknown, path: string, max = 200, min = 1) => {
  if (typeof value !== 'string' || value.length < min || value.length > max || /[\p{Cc}]/u.test(value))
    fail('WORKSHOP_METADATA_INVALID', path)
  return value
}
const longText = (value: unknown, path: string, max: number) => {
  if (typeof value !== 'string' || value.length > max || /[^\P{Cc}\t\n\r]/u.test(value))
    fail('WORKSHOP_METADATA_INVALID', path)
  return value
}
const positive = (value: unknown, path: string) => {
  if (!Number.isSafeInteger(value) || (value as number) < 1) fail('WORKSHOP_METADATA_INVALID', path)
  return value as number
}
const timestamp = (value: unknown, path: string) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))
    fail('WORKSHOP_METADATA_INVALID', path)
  if (Number.isNaN(Date.parse(value))) fail('WORKSHOP_METADATA_INVALID', path)
  return value
}
const httpsUrl = (value: unknown, path: string) => {
  const url = typeof value === 'string' && value.length <= 2048 ? URL.parse(value) : null
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.hash || url.search)
    fail('WORKSHOP_METADATA_INVALID', path)
  return url.href
}
const array = (value: unknown, path: string, max: number) => {
  if (!Array.isArray(value) || value.length > max) fail('WORKSHOP_METADATA_INVALID', path)
  return value
}

export const npmNamePattern = /^(?:@[a-z0-9][a-z0-9_.-]*\/)?[a-z0-9][a-z0-9_.-]*$/
export const projectIdPattern = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9](?:\.[a-z0-9][a-z0-9-]{0,62}[a-z0-9])?$/
export const registryIdPattern = /^[a-z0-9][a-z0-9.-]{1,62}[a-z0-9]$/
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/
const repositoryPattern = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/
const tagPattern = /^[a-z0-9\u4e00-\u9fff][a-z0-9\u4e00-\u9fff-]{0,31}$/u
export const isNpmName = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 214 && npmNamePattern.test(value)
export const isExactVersion = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 256 && semverPattern.test(value)

function role(value: unknown, path: string, keys: Record<string, WorkshopPublicKey>): WorkshopRole {
  const item = record(value, path)
  exactKeys(item, path, ['keyids', 'threshold'])
  const keyids = array(item.keyids, path + '.keyids', 16)
  if (
    !keyids.length ||
    keyids.some(id => !isKeyId(id) || !keys[id as string]) ||
    new Set(keyids).size !== keyids.length
  )
    fail('WORKSHOP_METADATA_INVALID', path + '.keyids')
  const threshold = positive(item.threshold, path + '.threshold')
  if (threshold > keyids.length) fail('WORKSHOP_METADATA_INVALID', path + '.threshold')
  return { keyids: keyids as string[], threshold }
}

export function parseEnvelope(value: unknown): SignedEnvelope<Json> {
  const item = record(value, '$')
  exactKeys(item, '$', ['signed', 'signatures'])
  return { signed: record(item.signed, '$.signed'), signatures: array(item.signatures, '$.signatures', 32) as never }
}

export function parseRoot(value: unknown): WorkshopRoot {
  const item = record(value, 'root')
  exactKeys(item, 'root', ['type', 'spec', 'registry', 'version', 'expires', 'keys', 'roles', 'mirrors'])
  if (item.type !== 'root' || item.spec !== WORKSHOP_SPEC) fail('WORKSHOP_METADATA_INVALID', 'root.type')
  const registry = text(item.registry, 'root.registry', 64)
  if (!registryIdPattern.test(registry)) fail('WORKSHOP_METADATA_INVALID', 'root.registry')
  const keysValue = record(item.keys, 'root.keys')
  if (Object.keys(keysValue).length > 32) fail('WORKSHOP_METADATA_INVALID', 'root.keys')
  const keys: Record<string, WorkshopPublicKey> = {}
  for (const [id, key] of Object.entries(keysValue)) {
    if (!isKeyId(id)) fail('WORKSHOP_METADATA_INVALID', 'root.keys')
    keys[id] = parsePublicKey(key)
  }
  const roles = record(item.roles, 'root.roles')
  exactKeys(roles, 'root.roles', ['root', 'snapshot'])
  const mirrors = array(item.mirrors, 'root.mirrors', 8).map((url, index) => {
    const href = httpsUrl(url, `root.mirrors.${index}`)
    if (!href.endsWith('/')) fail('WORKSHOP_METADATA_INVALID', `root.mirrors.${index}`)
    return href
  })
  if (!mirrors.length || new Set(mirrors).size !== mirrors.length) fail('WORKSHOP_METADATA_INVALID', 'root.mirrors')
  return {
    type: 'root',
    spec: 1,
    registry,
    version: positive(item.version, 'root.version'),
    expires: timestamp(item.expires, 'root.expires'),
    keys,
    roles: {
      root: role(roles.root, 'root.roles.root', keys),
      snapshot: role(roles.snapshot, 'root.roles.snapshot', keys),
    },
    mirrors,
  }
}

export function parseSnapshot(value: unknown): WorkshopSnapshot {
  const item = record(value, 'snapshot')
  exactKeys(item, 'snapshot', ['type', 'spec', 'registry', 'version', 'rootVersion', 'expires', 'index'])
  if (item.type !== 'snapshot' || item.spec !== WORKSHOP_SPEC) fail('WORKSHOP_METADATA_INVALID', 'snapshot.type')
  const index = record(item.index, 'snapshot.index')
  exactKeys(index, 'snapshot.index', ['path', 'sha256', 'length'])
  if (typeof index.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(index.sha256))
    fail('WORKSHOP_METADATA_INVALID', 'snapshot.index.sha256')
  if (index.path !== `objects/${index.sha256}.json`) fail('WORKSHOP_METADATA_INVALID', 'snapshot.index.path')
  const length = positive(index.length, 'snapshot.index.length')
  if (length > INDEX_MAX_BYTES) fail('WORKSHOP_LIMIT', 'snapshot.index.length')
  return {
    type: 'snapshot',
    spec: 1,
    registry: text(item.registry, 'snapshot.registry', 64),
    version: positive(item.version, 'snapshot.version'),
    rootVersion: positive(item.rootVersion, 'snapshot.rootVersion'),
    expires: timestamp(item.expires, 'snapshot.expires'),
    index: { path: index.path, sha256: index.sha256, length },
  }
}

const integrityPattern = /^sha512-[A-Za-z0-9+/]{86}==$/
function release(value: unknown, path: string): WorkshopRelease {
  const item = record(value, path)
  exactKeys(
    item,
    path,
    ['version', 'integrity', 'tarball', 'size', 'publishedAt', 'dependencies', 'containsCode', 'provenance'],
    ['arcadia', 'sdkApi'],
  )
  if (!isExactVersion(item.version)) fail('WORKSHOP_METADATA_INVALID', path + '.version')
  if (typeof item.integrity !== 'string' || !integrityPattern.test(item.integrity))
    fail('WORKSHOP_METADATA_INVALID', path + '.integrity')
  const dependencies = record(item.dependencies, path + '.dependencies')
  if (Object.keys(dependencies).length > 100) fail('WORKSHOP_METADATA_INVALID', path + '.dependencies')
  for (const [name, range] of Object.entries(dependencies))
    if (!isNpmName(name)) fail('WORKSHOP_METADATA_INVALID', path + '.dependencies')
    else text(range, `${path}.dependencies.${name}`, 256)
  const provenance = record(item.provenance, path + '.provenance')
  exactKeys(provenance, path + '.provenance', ['repository', 'workflow', 'commit'])
  if (typeof provenance.repository !== 'string' || !repositoryPattern.test(provenance.repository))
    fail('WORKSHOP_METADATA_INVALID', path + '.provenance.repository')
  if (typeof provenance.commit !== 'string' || !/^[a-f0-9]{40}$/.test(provenance.commit))
    fail('WORKSHOP_METADATA_INVALID', path + '.provenance.commit')
  if (typeof item.containsCode !== 'boolean') fail('WORKSHOP_METADATA_INVALID', path + '.containsCode')
  if (item.sdkApi !== undefined) positive(item.sdkApi, path + '.sdkApi')
  return {
    version: item.version,
    integrity: item.integrity,
    tarball: httpsUrl(item.tarball, path + '.tarball'),
    size: positive(item.size, path + '.size'),
    publishedAt: timestamp(item.publishedAt, path + '.publishedAt'),
    ...(item.arcadia !== undefined && { arcadia: text(item.arcadia, path + '.arcadia', 256) }),
    ...(item.sdkApi !== undefined && { sdkApi: item.sdkApi as number }),
    dependencies: dependencies as Record<string, string>,
    containsCode: item.containsCode,
    provenance: {
      repository: provenance.repository,
      workflow: text(provenance.workflow, path + '.provenance.workflow', 300),
      commit: provenance.commit,
    },
  }
}

export function parseProject(value: unknown, path = 'project'): WorkshopProject {
  const item = record(value, path)
  exactKeys(
    item,
    path,
    ['id', 'kind', 'npm', 'title', 'summary', 'authors', 'repository', 'tags', 'official', 'featured', 'releases'],
    ['license', 'homepage'],
  )
  if (typeof item.id !== 'string' || !projectIdPattern.test(item.id)) fail('WORKSHOP_METADATA_INVALID', path + '.id')
  if (item.kind !== 'package' && item.kind !== 'environment') fail('WORKSHOP_METADATA_INVALID', path + '.kind')
  if (!isNpmName(item.npm)) fail('WORKSHOP_METADATA_INVALID', path + '.npm')
  if (typeof item.repository !== 'string' || !repositoryPattern.test(item.repository))
    fail('WORKSHOP_METADATA_INVALID', path + '.repository')
  const tags = array(item.tags, path + '.tags', 12).map(tag => {
    if (typeof tag !== 'string' || !tagPattern.test(tag)) fail('WORKSHOP_METADATA_INVALID', path + '.tags')
    return tag
  })
  const releases = array(item.releases, path + '.releases', 1000).map((entry, index) =>
    release(entry, `${path}.releases.${index}`),
  )
  if (new Set(releases.map(entry => entry.version)).size !== releases.length)
    fail('WORKSHOP_METADATA_INVALID', path + '.releases')
  if (typeof item.official !== 'boolean' || typeof item.featured !== 'boolean')
    fail('WORKSHOP_METADATA_INVALID', path + '.official')
  return {
    id: item.id,
    kind: item.kind,
    npm: item.npm,
    title: text(item.title, path + '.title', 80),
    summary: longText(item.summary, path + '.summary', 500),
    authors: array(item.authors, path + '.authors', 16).map((author, index) =>
      text(author, `${path}.authors.${index}`, 80),
    ),
    ...(item.license !== undefined && { license: text(item.license, path + '.license', 100) }),
    repository: item.repository,
    ...(item.homepage !== undefined && { homepage: httpsUrl(item.homepage, path + '.homepage') }),
    tags,
    official: item.official,
    featured: item.featured,
    releases,
  }
}

export function parseIndex(value: unknown): WorkshopIndex {
  const item = record(value, 'index')
  exactKeys(item, 'index', ['type', 'spec', 'registry', 'generatedAt', 'projects', 'revocations'])
  if (item.type !== 'index' || item.spec !== WORKSHOP_SPEC) fail('WORKSHOP_METADATA_INVALID', 'index.type')
  const projects = array(item.projects, 'index.projects', 10000).map((entry, index) =>
    parseProject(entry, `index.projects.${index}`),
  )
  for (const key of ['id', 'npm'] as const)
    if (new Set(projects.map(project => project[key])).size !== projects.length)
      fail('WORKSHOP_METADATA_INVALID', 'index.projects.' + key)
  const revocations = array(item.revocations, 'index.revocations', 10000).map((entry, index) => {
    const path = `index.revocations.${index}`
    const value = record(entry, path)
    exactKeys(value, path, ['npm', 'version', 'reason', 'revokedAt'])
    if (!isNpmName(value.npm)) fail('WORKSHOP_METADATA_INVALID', path + '.npm')
    if (value.version !== '*' && !isExactVersion(value.version)) fail('WORKSHOP_METADATA_INVALID', path + '.version')
    return {
      npm: value.npm,
      version: value.version as string,
      reason: text(value.reason, path + '.reason', 500),
      revokedAt: timestamp(value.revokedAt, path + '.revokedAt'),
    }
  })
  return {
    type: 'index',
    spec: 1,
    registry: text(item.registry, 'index.registry', 64),
    generatedAt: timestamp(item.generatedAt, 'index.generatedAt'),
    projects,
    revocations,
  }
}

export function revocationFor(index: Pick<WorkshopIndex, 'revocations'>, npm: string, version: string) {
  return index.revocations.find(item => item.npm === npm && (item.version === '*' || item.version === version))
}
