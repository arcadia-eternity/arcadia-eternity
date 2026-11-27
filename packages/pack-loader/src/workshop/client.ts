import { fail, parseJsonBytes, sha256Hex, WorkshopError } from './encoding'
import {
  INDEX_MAX_BYTES,
  ROOT_MAX_BYTES,
  SNAPSHOT_MAX_BYTES,
  parseEnvelope,
  parseIndex,
  parseRoot,
  parseSnapshot,
  revocationFor,
  type WorkshopIndex,
  type WorkshopProject,
  type WorkshopRelease,
  type WorkshopRoot,
  type WorkshopSnapshot,
} from './metadata'
import { verifyThreshold, type SignedEnvelope } from './signing'

/** Returns the body, or `null` when the mirror reports that the file does not exist. */
export type WorkshopFetch = (url: string, maxBytes: number, signal: AbortSignal) => Promise<Uint8Array | null>

/** Trusted state persisted between updates: the newest verified root and snapshot, plus the cached index. */
export interface WorkshopTrustState {
  root: SignedEnvelope<unknown>
  snapshot?: SignedEnvelope<unknown>
  index?: string
  checkedAt?: string
}
export interface WorkshopTrustStore {
  read(registry: string): Promise<WorkshopTrustState | undefined>
  write(registry: string, state: WorkshopTrustState): Promise<void>
}

export interface WorkshopView {
  registry: string
  root: WorkshopRoot
  snapshot: WorkshopSnapshot
  index: WorkshopIndex
  /** `stale` views come from the offline cache after a failed or skipped refresh and must not authorize installs. */
  freshness: 'fresh' | 'stale'
  checkedAt?: string
  error?: { code: string; message: string }
}

export interface WorkshopClientOptions {
  /** Root metadata shipped with the client or explicitly trusted by the user. */
  trustedRoot: SignedEnvelope<unknown>
  store: WorkshopTrustStore
  fetch?: WorkshopFetch
  /** Extra base URLs tried before the root's mirrors. Responses are verified identically. */
  mirrors?: string[]
  now?: () => number
  timeoutMs?: number
}

const MAX_ROOT_STEPS = 64

export async function defaultWorkshopFetch(url: string, maxBytes: number, signal: AbortSignal) {
  const parsed = new URL(url)
  if (
    parsed.protocol !== 'https:' &&
    !(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname))
  )
    fail('WORKSHOP_URL_INVALID')
  const response = await fetch(parsed, { redirect: 'error', signal, cache: 'no-store', credentials: 'omit' })
  if (response.status === 404 || response.status === 403) {
    await response.body?.cancel()
    return null
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    fail('WORKSHOP_FETCH_FAILED', `HTTP ${response.status}`)
  }
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > maxBytes) {
    await response.body.cancel()
    fail('WORKSHOP_LIMIT')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      fail('WORKSHOP_LIMIT')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

const errorInfo = (error: unknown) =>
  error instanceof WorkshopError
    ? { code: error.code, message: error.message }
    : { code: 'WORKSHOP_FETCH_FAILED', message: error instanceof Error ? error.message : 'Fetch failed' }

export class WorkshopClient {
  readonly #options: WorkshopClientOptions
  readonly #fetch: WorkshopFetch
  readonly #now: () => number
  readonly #bundled: WorkshopRoot
  #refreshing?: Promise<WorkshopView>

  constructor(options: WorkshopClientOptions) {
    this.#options = options
    this.#fetch = options.fetch ?? defaultWorkshopFetch
    this.#now = options.now ?? Date.now
    this.#bundled = parseRoot(parseEnvelope(options.trustedRoot).signed)
  }

  get registry() {
    return this.#bundled.registry
  }

  /** Latest verified view; falls back to the cached index (marked stale) when every mirror fails. */
  refresh(signal?: AbortSignal): Promise<WorkshopView> {
    this.#refreshing ??= this.#refresh(signal).finally(() => (this.#refreshing = undefined))
    return this.#refreshing
  }

  /** Verified cached view without network access. */
  async cached(): Promise<WorkshopView | undefined> {
    const state = await this.#options.store.read(this.registry)
    if (!state?.snapshot || !state.index) return undefined
    const root = await this.#trustedRoot(state)
    const snapshot = await this.#verifySnapshot(state.snapshot, root, undefined, false)
    const index = this.#verifyIndex(new TextEncoder().encode(state.index), snapshot)
    return { registry: this.registry, root, snapshot, index, freshness: 'stale', checkedAt: state.checkedAt }
  }

  async #refresh(outer?: AbortSignal): Promise<WorkshopView> {
    const signal = AbortSignal.any([AbortSignal.timeout(this.#options.timeoutMs ?? 60_000), ...(outer ? [outer] : [])])
    const state = await this.#options.store.read(this.registry)
    try {
      const { root, envelope: rootEnvelope } = await this.#updateRoot(state, signal)
      const previous = state?.snapshot ? this.#previousSnapshot(state.snapshot) : undefined
      const { snapshot, envelope, index, indexText } = await this.#firstValid(root, signal, async base => {
        const bytes = await this.#fetch(base + 'snapshot.json', SNAPSHOT_MAX_BYTES, signal)
        if (!bytes) fail('WORKSHOP_SNAPSHOT_MISSING')
        const envelope = parseEnvelope(parseJsonBytes(bytes, SNAPSHOT_MAX_BYTES))
        const snapshot = await this.#verifySnapshot(envelope, root, previous, true)
        const cachedIndex = state?.index && previous?.index.sha256 === snapshot.index.sha256 ? state.index : undefined
        const indexBytes = cachedIndex
          ? new TextEncoder().encode(cachedIndex)
          : await this.#fetch(base + snapshot.index.path, snapshot.index.length, signal)
        if (!indexBytes) fail('WORKSHOP_INDEX_MISSING')
        const index = this.#verifyIndex(indexBytes, snapshot)
        return { snapshot, envelope, index, indexText: new TextDecoder().decode(indexBytes) }
      })
      const checkedAt = new Date(this.#now()).toISOString()
      await this.#options.store.write(this.registry, {
        root: rootEnvelope,
        snapshot: envelope,
        index: indexText,
        checkedAt,
      })
      return { registry: this.registry, root, snapshot, index, freshness: 'fresh', checkedAt }
    } catch (error) {
      outer?.throwIfAborted()
      // A rejected update never overwrites trusted state; cached data remains available but stale.
      const cached = await this.cached().catch(() => undefined)
      if (cached) return { ...cached, error: errorInfo(error) }
      throw error
    }
  }

  async #trustedRoot(state: WorkshopTrustState | undefined) {
    if (!state) return this.#bundled
    const root = parseRoot(parseEnvelope(state.root).signed)
    if (root.registry !== this.registry) fail('WORKSHOP_REGISTRY_MISMATCH')
    // A bundled root newer than persisted state (client upgrade) supersedes the persisted chain.
    return root.version >= this.#bundled.version ? root : this.#bundled
  }

  async #updateRoot(state: WorkshopTrustState | undefined, signal: AbortSignal) {
    let root = await this.#trustedRoot(state)
    let envelope = root === this.#bundled ? this.#options.trustedRoot : state!.root
    for (let step = 0; step < MAX_ROOT_STEPS; step++) {
      const nextVersion = root.version + 1
      const next = await this.#optional(root, signal, async base => {
        const bytes = await this.#fetch(`${base}root/${nextVersion}.json`, ROOT_MAX_BYTES, signal)
        if (!bytes) return null
        const candidate = parseEnvelope(parseJsonBytes(bytes, ROOT_MAX_BYTES))
        const parsed = parseRoot(candidate.signed)
        if (parsed.registry !== root.registry) fail('WORKSHOP_REGISTRY_MISMATCH')
        if (parsed.version !== nextVersion) fail('WORKSHOP_ROOT_VERSION_INVALID')
        // Rotation requires the outgoing and incoming root roles to both approve the new root.
        await verifyThreshold(candidate as SignedEnvelope<{ type: string }>, root.keys, root.roles.root)
        await verifyThreshold(candidate as SignedEnvelope<{ type: string }>, parsed.keys, parsed.roles.root)
        return { root: parsed, envelope: candidate }
      })
      if (!next) break
      root = next.root
      envelope = next.envelope
    }
    if (Date.parse(root.expires) <= this.#now()) fail('WORKSHOP_ROOT_EXPIRED')
    return { root, envelope }
  }

  /** The stored snapshot was verified when saved; under a rotated root its version still bounds rollback. */
  #previousSnapshot(envelope: SignedEnvelope<unknown>) {
    return parseSnapshot(parseEnvelope(envelope).signed)
  }

  async #verifySnapshot(
    value: SignedEnvelope<unknown>,
    root: WorkshopRoot,
    previous: WorkshopSnapshot | undefined,
    checkExpiry: boolean,
  ) {
    const envelope = parseEnvelope(value)
    const snapshot = parseSnapshot(envelope.signed)
    if (snapshot.registry !== root.registry) fail('WORKSHOP_REGISTRY_MISMATCH')
    if (snapshot.rootVersion !== root.version) fail('WORKSHOP_ROOT_VERSION_MISMATCH')
    await verifyThreshold(envelope as SignedEnvelope<{ type: string }>, root.keys, root.roles.snapshot)
    if (previous) {
      if (snapshot.version < previous.version) fail('WORKSHOP_ROLLBACK', 'Snapshot version is older than trusted state')
      if (snapshot.version === previous.version && snapshot.index.sha256 !== previous.index.sha256)
        fail('WORKSHOP_ROLLBACK', 'Snapshot version was reused for different content')
    }
    if (checkExpiry && Date.parse(snapshot.expires) <= this.#now()) fail('WORKSHOP_SNAPSHOT_EXPIRED')
    return snapshot
  }

  #verifyIndex(bytes: Uint8Array, snapshot: WorkshopSnapshot) {
    if (bytes.byteLength !== snapshot.index.length || sha256Hex(bytes) !== snapshot.index.sha256)
      fail('WORKSHOP_INDEX_DIGEST_MISMATCH')
    const index = parseIndex(parseJsonBytes(bytes, INDEX_MAX_BYTES))
    if (index.registry !== snapshot.registry) fail('WORKSHOP_REGISTRY_MISMATCH')
    return index
  }

  #bases(root: WorkshopRoot) {
    return [...new Set([...(this.#options.mirrors ?? []), ...root.mirrors])]
  }

  /** Try mirrors in order until one yields verified metadata. Errors from every mirror are reported together. */
  async #firstValid<T>(root: WorkshopRoot, signal: AbortSignal, attempt: (base: string) => Promise<T>) {
    const errors: string[] = []
    for (const base of this.#bases(root)) {
      signal.throwIfAborted()
      try {
        return await attempt(base)
      } catch (error) {
        if (signal.aborted) throw error
        errors.push(`${new URL(base).host}: ${errorInfo(error).code}`)
      }
    }
    fail('WORKSHOP_MIRRORS_FAILED', errors.join('; '))
  }

  /** Like #firstValid, but `null` from a reachable mirror means the file is absent there. */
  async #optional<T>(root: WorkshopRoot, signal: AbortSignal, attempt: (base: string) => Promise<T | null>) {
    let reached = false
    const errors: string[] = []
    for (const base of this.#bases(root)) {
      signal.throwIfAborted()
      try {
        const result = await attempt(base)
        if (result) return result
        reached = true
      } catch (error) {
        if (signal.aborted) throw error
        errors.push(`${new URL(base).host}: ${errorInfo(error).code}`)
      }
    }
    if (!reached) fail('WORKSHOP_MIRRORS_FAILED', errors.join('; '))
    return null
  }
}

export interface WorkshopInstallTarget {
  registry: string
  project: WorkshopProject
  release: WorkshopRelease
}

/** Resolve one exact release for installation. Only fresh, unrevoked entries authorize an install. */
export function resolveWorkshopRelease(view: WorkshopView, npm: string, version: string): WorkshopInstallTarget {
  if (view.freshness !== 'fresh') fail('WORKSHOP_INDEX_STALE', 'Refresh the workshop index before installing')
  const project = view.index.projects.find(item => item.npm === npm)
  if (!project) fail('WORKSHOP_PROJECT_UNKNOWN')
  const release = project.releases.find(item => item.version === version)
  if (!release) fail('WORKSHOP_RELEASE_UNKNOWN')
  const revoked = revocationFor(view.index, npm, version)
  if (revoked) fail('WORKSHOP_RELEASE_REVOKED', revoked.reason)
  return { registry: view.registry, project, release }
}

/** Reject an installed dependency graph containing any revoked package version from this registry. */
export function assertGraphNotRevoked(view: WorkshopView, graph: readonly { name: string; version: string }[]) {
  for (const item of graph) {
    const revoked = revocationFor(view.index, item.name, item.version)
    if (revoked) fail('WORKSHOP_RELEASE_REVOKED', `${item.name}@${item.version}: ${revoked.reason}`)
  }
}
