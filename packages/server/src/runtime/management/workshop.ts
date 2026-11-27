import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { acquireAuthorEnvironment } from '@arcadia-eternity/content-sdk/management-workspace'
import { fileWorkshopTrustStore, inspectNpmProject } from '@arcadia-eternity/pack-loader/node'
import {
  OFFICIAL_WORKSHOP_ROOT,
  WorkshopClient,
  canonicalJson,
  parseEnvelope,
  parseRoot,
  resolveWorkshopRelease,
  revocationFor,
  sha256Hex,
  verifyThreshold,
  verifyWorkshopDependencies,
  verifyWorkshopGraph,
  type SignedEnvelope,
  type WorkshopFetch,
  type WorkshopGraphPackage,
  type WorkshopInstallTarget,
  type WorkshopView,
} from '@arcadia-eternity/pack-loader/workshop'
import type { EnvironmentDocument } from '@arcadia-eternity/content-sdk/management-workspace'
import { publicWorkshopFetch } from './workshop-fetch'

/**
 * `required`: every install needs a fresh signed index. `available`: use a fresh index, else the verified offline
 * cache; with neither, installs proceed unchecked. `off`: no checks. Explicit workshop installs always need a fresh
 * index of the registry they install from.
 */
export type WorkshopCheckMode = 'required' | 'available' | 'off'

export interface WorkshopGraphCheck {
  /** Rejects an installed project whose graph contains revoked or tampered registry releases. */
  check(directory: string, signal?: AbortSignal): Promise<void>
}

/** An exact registry release selected through the management API. */
export interface WorkshopTarget {
  registry: string
  npm: string
  version: string
}

export interface WorkshopRecipe {
  document: EnvironmentDocument
  directory: string
  integrity?: string
}

const OFFICIAL_REGISTRY = 'official'
const BASE_PACKAGE = '@arcadia-eternity/data-pack-base'
/** The host always stages the official base from its own shipped or cached copy, so its archive digest differs. */
const hostProvided = (item: { name: string }) => item.name === BASE_PACKAGE
const failure = (code: string, status = 422, message?: string): never => {
  throw Object.assign(new Error(message ?? code), { code, status })
}

/** Packages pinned by a recipe lockfile; a recipe without one resolves its ranges at apply time. */
async function lockedPackages(directory: string): Promise<WorkshopGraphPackage[]> {
  let lock: unknown
  try {
    lock = JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const packages = (lock as { packages?: Record<string, { version?: unknown; integrity?: unknown }> }).packages ?? {}
  return Object.entries(packages).flatMap(([location, entry]) => {
    const name = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(location)?.[1]
    return name && typeof entry.version === 'string'
      ? [{ name, version: entry.version, integrity: typeof entry.integrity === 'string' ? entry.integrity : undefined }]
      : []
  })
}

/**
 * An explicit install may only bring in releases some trusted registry lists; the per-registry checks have already
 * matched each listed package's version and integrity. Host-provided packages are staged from the host's own copy.
 */
function requireListed(views: readonly WorkshopView[], graph: readonly WorkshopGraphPackage[]) {
  const unlisted = graph.filter(
    item => !hostProvided(item) && !views.some(view => view.index.projects.some(project => project.npm === item.name)),
  )
  if (unlisted.length)
    failure(
      'WORKSHOP_DEPENDENCY_UNLISTED',
      422,
      unlisted
        .slice(0, 10)
        .map(item => `${item.name}@${item.version}`)
        .join(', '),
    )
}

/** Official-registry graph checks only; `off` disables them. */
export function createWorkshopGraphCheck(options: {
  mode: WorkshopCheckMode
  directory: string
  offline?: boolean
  trustedRoot?: SignedEnvelope<unknown>
  fetch?: WorkshopFetch
  now?: () => number
  onUnavailable?: (error: unknown) => void
}): ServerWorkshop | undefined {
  if (options.mode === 'off') return undefined
  const { onUnavailable, ...rest } = options
  return new ServerWorkshop({ ...rest, ...(onUnavailable && { onUnavailable: (_, error) => onUnavailable(error) }) })
}

/** Verify a host-pinned third-party root: a self-signed, unexpired root of a registry other than the official one. */
export async function parseHostRegistryRoots(value: unknown, now = Date.now()) {
  const list = Array.isArray(value) ? value : (value as { registries?: unknown } | null)?.registries
  if (!Array.isArray(list) || list.length > 32) throw new Error('WORKSHOP_REGISTRIES_INVALID')
  const roots: SignedEnvelope<unknown>[] = []
  const ids = new Set<string>([OFFICIAL_REGISTRY])
  for (const item of list) {
    const envelope = parseEnvelope((item as { root?: unknown } | null)?.root ?? item)
    const root = parseRoot(envelope.signed)
    if (ids.has(root.registry)) throw new Error('WORKSHOP_REGISTRY_EXISTS')
    await verifyThreshold(envelope as SignedEnvelope<{ type: string }>, root.keys, root.roles.root)
    if (Date.parse(root.expires) <= now) throw new Error('WORKSHOP_ROOT_EXPIRED')
    ids.add(root.registry)
    roots.push(envelope as SignedEnvelope<unknown>)
  }
  return roots
}

/**
 * Signed registries for a standalone server: the bundled official root plus third-party roots pinned in host
 * configuration. Remote callers select only registry IDs; they can never add a root or a mirror.
 */
export class ServerWorkshop implements WorkshopGraphCheck {
  readonly #options: {
    mode: WorkshopCheckMode
    install: boolean
    directory: string
    offline?: boolean
    allowThirdPartyContent?: boolean
    npm?: { registry?: string; cache?: string }
    acquire?: (
      target: WorkshopInstallTarget,
      destination: string,
      signal: AbortSignal,
    ) => Promise<WorkshopRecipe & { name?: string; version?: string }>
    onUnavailable?: (registry: string, error: unknown) => void
  }
  readonly #clients = new Map<string, WorkshopClient>()
  readonly #fingerprints = new Map<string, string>()

  constructor(options: {
    mode: WorkshopCheckMode
    /** Host switch for explicit installs through management; graph checks still run when it is off. Default on. */
    install?: boolean
    /** Trust state and recipe staging. */
    directory: string
    offline?: boolean
    /** Host acquisition policy; without it only official projects of the official registry can be installed. */
    allowThirdPartyContent?: boolean
    trustedRoot?: SignedEnvelope<unknown>
    /** Third-party roots from host configuration, already checked with `parseHostRegistryRoots`. */
    registries?: readonly SignedEnvelope<unknown>[]
    /** Defaults to HTTPS requests that only reach public addresses. */
    fetch?: WorkshopFetch
    now?: () => number
    /** npm registry and cache used to download environment recipes. */
    npm?: { registry?: string; cache?: string }
    /** Replaces the npm download of an environment recipe, for hosts with their own acquisition. */
    acquire?: (
      target: WorkshopInstallTarget,
      destination: string,
      signal: AbortSignal,
    ) => Promise<WorkshopRecipe & { name?: string; version?: string }>
    onUnavailable?: (registry: string, error: unknown) => void
  }) {
    if (!isAbsolute(options.directory)) throw new Error('WORKSHOP_DIRECTORY_INVALID')
    this.#options = { ...options, install: options.install ?? true }
    const store = fileWorkshopTrustStore(join(options.directory, 'trust'))
    const fetch = options.fetch ?? publicWorkshopFetch
    for (const root of [options.trustedRoot ?? OFFICIAL_WORKSHOP_ROOT, ...(options.registries ?? [])]) {
      const client = new WorkshopClient({ trustedRoot: root, store, fetch, now: options.now })
      if (this.#clients.has(client.registry)) throw new Error('WORKSHOP_REGISTRY_EXISTS')
      this.#clients.set(client.registry, client)
      this.#fingerprints.set(client.registry, sha256Hex(new TextEncoder().encode(canonicalJson(root))))
    }
    if (!this.#clients.has(OFFICIAL_REGISTRY)) throw new Error('WORKSHOP_REGISTRY_INVALID')
  }

  get installEnabled() {
    return this.#options.install
  }

  registries() {
    return [...this.#clients.keys()].map(id => ({
      id,
      official: id === OFFICIAL_REGISTRY,
      fingerprint: this.#fingerprints.get(id)!,
    }))
  }

  #client(registry: string) {
    const client = this.#clients.get(registry)
    if (!client) failure('WORKSHOP_REGISTRY_UNKNOWN', 404)
    return client!
  }

  /** Cached view when one exists and `refresh` is false; otherwise the latest verified view. */
  async view(registry: string, refresh: boolean, signal?: AbortSignal): Promise<WorkshopView> {
    const client = this.#client(registry)
    if (this.#options.offline) return (await client.cached()) ?? failure('WORKSHOP_INDEX_UNAVAILABLE', 409)
    if (!refresh) {
      const cached = await client.cached()
      if (cached) return cached
    }
    return client.refresh(signal)
  }

  /** Views for the host graph check: every registry, following the configured mode. */
  async #checkViews(signal?: AbortSignal) {
    const views: WorkshopView[] = []
    for (const [registry, client] of this.#clients) {
      let view: WorkshopView | undefined
      if (this.#options.offline) view = await client.cached()
      else
        try {
          view = await client.refresh(signal)
        } catch (error) {
          signal?.throwIfAborted()
          if (this.#options.mode === 'required') throw error
          this.#options.onUnavailable?.(registry, error)
        }
      if (!view) {
        if (this.#options.mode === 'required') failure('WORKSHOP_INDEX_STALE', 409)
        continue
      }
      if (view.freshness !== 'fresh' && this.#options.mode === 'required') failure('WORKSHOP_INDEX_STALE', 409)
      views.push(view)
    }
    return views
  }

  async check(directory: string, signal?: AbortSignal) {
    if (this.#options.mode === 'off') return
    const views = await this.#checkViews(signal)
    if (!views.length) return
    const inspection = await inspectNpmProject(directory)
    signal?.throwIfAborted()
    for (const view of views) verifyWorkshopDependencies(view, inspection.packages, { hostProvided, allowStale: true })
  }

  /** A fresh, unrevoked exact release. The official base is staged by the host and is never installed this way. */
  async resolve(target: WorkshopTarget, signal?: AbortSignal) {
    if (!this.#options.install) failure('WORKSHOP_INSTALL_DISABLED', 403)
    if (this.#options.offline) failure('WORKSHOP_OFFLINE', 409)
    const view = await this.#client(target.registry).refresh(signal)
    if (view.freshness !== 'fresh') failure('WORKSHOP_INDEX_STALE', 409, view.error?.code)
    const resolved = resolveWorkshopRelease(view, target.npm, target.version)
    if (hostProvided({ name: resolved.project.npm })) failure('WORKSHOP_HOST_PROVIDED', 409)
    // Official projects come only from the bundled official registry.
    const official = view.registry === OFFICIAL_REGISTRY && resolved.project.official
    if (!official && !this.#options.allowThirdPartyContent) failure('THIRD_PARTY_CONTENT_NOT_AUTHORIZED', 403)
    return { view, target: resolved, official }
  }

  /** Fresh views of other registries that are reachable now, checked alongside the target registry. */
  async #others(registry: string, signal?: AbortSignal) {
    const views: WorkshopView[] = []
    for (const [id, client] of this.#clients) {
      if (id === registry) continue
      const view = await client.refresh(signal).catch(() => undefined)
      signal?.throwIfAborted()
      if (view?.freshness === 'fresh') views.push(view)
    }
    return views
  }

  /**
   * Download an environment recipe and confirm its archive and pinned lock against the signed release. The caller
   * owns the returned directory and must call `release`.
   */
  async acquireEnvironment(resolved: Awaited<ReturnType<ServerWorkshop['resolve']>>, signal: AbortSignal) {
    const { view, target } = resolved
    if (target.project.kind !== 'environment') failure('WORKSHOP_KIND_MISMATCH', 409)
    const staging = join(this.#options.directory, 'staging')
    await mkdir(staging, { recursive: true, mode: 0o700 })
    const directory = join(staging, 'recipe-' + randomUUID())
    const release = () => rm(directory, { recursive: true, force: true })
    try {
      const acquired = this.#options.acquire
        ? await this.#options.acquire(target, directory, signal)
        : await acquireAuthorEnvironment(
            { kind: 'npm', name: target.project.npm, version: target.release.version },
            directory,
            { signal, offline: false, cache: this.#options.npm?.cache, registry: this.#options.npm?.registry },
          )
      signal.throwIfAborted()
      if (
        (acquired.name !== undefined && acquired.name !== target.project.npm) ||
        (acquired.version !== undefined && acquired.version !== target.release.version)
      )
        failure('WORKSHOP_INTEGRITY_MISMATCH')
      const pinned = await lockedPackages(acquired.directory)
      verifyWorkshopGraph(view, target, [
        { name: target.project.npm, version: target.release.version, integrity: acquired.integrity },
        ...pinned,
      ])
      const others = await this.#others(view.registry, signal)
      for (const other of others) verifyWorkshopDependencies(other, pinned)
      requireListed([view, ...others], pinned)
      return { document: acquired.document, directory: acquired.directory, release }
    } catch (error) {
      await release()
      throw error
    }
  }

  /** Check a staged project prepared for an explicit workshop install, against fresh signed indexes. */
  async verifyInstalled(target: WorkshopTarget, directory: string, signal?: AbortSignal) {
    const { view, target: resolved } = await this.resolve(target, signal)
    const graph = (await inspectNpmProject(directory)).packages
    signal?.throwIfAborted()
    if (resolved.project.kind === 'package') verifyWorkshopGraph(view, resolved, graph, { hostProvided })
    else verifyWorkshopDependencies(view, graph, { hostProvided })
    const others = await this.#others(view.registry, signal)
    for (const other of others) verifyWorkshopDependencies(other, graph, { hostProvided })
    requireListed([view, ...others], graph)
  }

  /** Ready installations whose graph contains a version this view revokes. */
  revokedMembers(
    view: WorkshopView,
    installations: readonly { environmentId: string; members?: readonly { name: string; version: string }[] }[],
  ) {
    return installations.flatMap(installation =>
      (installation.members ?? []).flatMap(member => {
        const revoked = revocationFor(view.index, member.name, member.version)
        return revoked
          ? [
              {
                environmentId: installation.environmentId,
                name: member.name,
                version: member.version,
                reason: revoked.reason,
              },
            ]
          : []
      }),
    )
  }
}
