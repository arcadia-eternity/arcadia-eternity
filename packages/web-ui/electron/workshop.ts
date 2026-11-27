import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { fileWorkshopTrustStore } from '@arcadia-eternity/pack-loader/node'
import { join } from 'node:path'
import {
  OFFICIAL_WORKSHOP_ROOT,
  OFFICIAL_WORKSHOP_SITE,
  WorkshopClient,
  assertGraphNotRevoked,
  canonicalJson,
  fetchWorkshopRoot,
  sha256Hex,
  verifyWorkshopDependencies,
  registryIdPattern,
  resolveWorkshopRelease,
  revocationFor,
  verifyWorkshopGraph,
  type SignedEnvelope,
  type WorkshopFetch,
  type WorkshopTrustStore,
  type WorkshopView,
} from '@arcadia-eternity/pack-loader/workshop'
import type { WorkshopRequest, WorkshopResult, WorkshopSummary } from '../src/types/workshop.ts'

export type { WorkshopRequest }

const OFFICIAL_REGISTRY = 'official'
/** The host always materializes the official base from its own shipped or cached copy. */
const hostProvided = (item: { name: string }) => item.name === '@arcadia-eternity/data-pack-base'

interface InstalledPackage {
  id: string
  name: string
  version: string
  graph?: { name: string; version: string; integrity?: string }[]
}
export interface WorkshopHost {
  listPackages(): Promise<InstalledPackage[]>
  installPackage(spec: string, verify: (graph: NonNullable<InstalledPackage['graph']>) => void): Promise<string>
  installEnvironment(
    spec: string,
    environmentId: string | undefined,
    verify: (recipe: { directory: string; integrity?: string }) => Promise<void>,
    verifyGraph: (graph: NonNullable<InstalledPackage['graph']>) => void,
  ): Promise<{ operationId: string }>
}

/** Packages pinned by a recipe lockfile; an environment without one resolves its ranges at apply time. */
async function lockedPackages(directory: string) {
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

const summary = (view: WorkshopView): Omit<WorkshopSummary, 'revokedInstalled' | 'official'> => ({
  registry: view.registry,
  freshness: view.freshness,
  checkedAt: view.checkedAt,
  snapshot: view.snapshot.version,
  expires: view.snapshot.expires,
  error: view.error,
  // Only the bundled official registry may mark projects as official.
  projects:
    view.registry === OFFICIAL_REGISTRY
      ? view.index.projects
      : view.index.projects.map(project => ({ ...project, official: false })),
  revocations: view.index.revocations,
})

interface StoredRegistry {
  site: string
  root: SignedEnvelope<unknown>
  addedAt: string
}
const environmentIdPattern = /^[a-z0-9][a-z0-9_-]{0,79}$/
const requestError = () => new Error('WORKSHOP_REQUEST_INVALID')
function exactKeys(input: object, allowed: string[]) {
  if (Object.keys(input).some(key => !allowed.includes(key))) throw requestError()
}
function registryField(value: unknown) {
  if (value === undefined) return OFFICIAL_REGISTRY
  if (typeof value !== 'string' || !registryIdPattern.test(value)) throw requestError()
  return value
}
function siteField(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) throw requestError()
  return value
}
/**
 * Workshop registries for the desktop client: the bundled official root plus third-party registries the user
 * trusted by confirming their root fingerprint. Only a fresh signed index authorizes an install.
 */
export class DesktopWorkshop {
  readonly #host: WorkshopHost
  readonly #directory: string
  readonly #store: WorkshopTrustStore
  readonly #fetch: WorkshopFetch | undefined
  readonly #now: (() => number) | undefined
  readonly #official: SignedEnvelope<unknown>
  readonly #clients = new Map<string, WorkshopClient>()
  #registries?: Promise<Record<string, StoredRegistry>>
  #tail = Promise.resolve()

  constructor(options: {
    directory: string
    host: WorkshopHost
    fetch?: WorkshopFetch
    now?: () => number
    trustedRoot?: SignedEnvelope<unknown>
  }) {
    this.#host = options.host
    this.#directory = options.directory
    this.#store = fileWorkshopTrustStore(join(options.directory, 'trust'))
    this.#fetch = options.fetch
    this.#now = options.now
    this.#official = options.trustedRoot ?? OFFICIAL_WORKSHOP_ROOT
  }

  get #file() {
    return join(this.#directory, 'registries.json')
  }
  #load() {
    this.#registries ??= readFile(this.#file, 'utf8').then(
      text => JSON.parse(text) as Record<string, StoredRegistry>,
      error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
        throw error
      },
    )
    return this.#registries
  }
  async #save(registries: Record<string, StoredRegistry>) {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 })
    const temp = join(this.#directory, `.registries.${randomUUID()}.tmp`)
    try {
      await writeFile(temp, JSON.stringify(registries, null, 2), { flag: 'wx', mode: 0o600 })
      await rename(temp, this.#file)
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }
    this.#registries = Promise.resolve(registries)
  }
  #exclusive<T>(run: () => Promise<T>) {
    const next = this.#tail.then(run)
    this.#tail = next.then(
      () => {},
      () => {},
    )
    return next
  }

  async #client(registry: string) {
    let client = this.#clients.get(registry)
    if (client) return client
    const root = registry === OFFICIAL_REGISTRY ? this.#official : (await this.#load())[registry]?.root
    if (!root) throw new Error('WORKSHOP_REGISTRY_UNKNOWN')
    client = new WorkshopClient({ trustedRoot: root, store: this.#store, fetch: this.#fetch, now: this.#now })
    if (client.registry !== registry) throw new Error('WORKSHOP_REGISTRY_INVALID')
    this.#clients.set(registry, client)
    return client
  }

  async #installed(view: WorkshopView) {
    return (await this.#host.listPackages()).flatMap(item => {
      const graph = item.graph ?? [{ name: item.name, version: item.version }]
      return graph.flatMap(pkg => {
        const revoked = revocationFor(view.index, pkg.name, pkg.version)
        return revoked ? [{ packageId: item.id, name: pkg.name, version: pkg.version, reason: revoked.reason }] : []
      })
    })
  }

  /** Fresh views of the target registry and, for third-party installs, the official one when it is reachable. */
  async #checkers(view: WorkshopView) {
    if (view.registry === OFFICIAL_REGISTRY) return [view]
    const official = await (await this.#client(OFFICIAL_REGISTRY)).refresh().catch(() => undefined)
    return official?.freshness === 'fresh' ? [view, official] : [view]
  }

  /**
   * Check a staged project before any environment commits it: no package version may be revoked by a trusted
   * registry. Uses a fresh index when reachable within a short timeout, else the verified cache; a registry with
   * neither is skipped. Local archives and development builds stay allowed, so digests are only checked for
   * explicit workshop installs.
   */
  async checkProject(directory: string, signal?: AbortSignal) {
    const registries = [OFFICIAL_REGISTRY, ...Object.keys(await this.#load())]
    const views: WorkshopView[] = []
    for (const registry of registries) {
      // A registry removed while this check runs is no longer trusted.
      const client = await this.#client(registry).catch(() => undefined)
      if (!client) continue
      const view = await client
        .refresh(AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]))
        .catch(async () => {
          signal?.throwIfAborted()
          return client.cached().catch(() => undefined)
        })
      if (view) views.push(view)
    }
    if (!views.length) return
    // The validator that runs next checks this lock against the installed tree.
    const graph = await lockedPackages(directory)
    signal?.throwIfAborted()
    for (const view of views) assertGraphNotRevoked(view, graph)
  }

  async request(input: WorkshopRequest): Promise<WorkshopResult> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw requestError()
    switch (input.action) {
      case 'registries': {
        exactKeys(input, ['action'])
        const stored = await this.#load()
        return {
          registries: [
            { id: OFFICIAL_REGISTRY, site: OFFICIAL_WORKSHOP_SITE, official: true },
            ...Object.entries(stored).map(([id, entry]) => ({
              id,
              site: entry.site,
              official: false,
              addedAt: entry.addedAt,
              fingerprint: rootFingerprint(entry.root),
            })),
          ],
        }
      }
      case 'preview-registry': {
        exactKeys(input, ['action', 'site'])
        const { root, fingerprint } = await fetchWorkshopRoot(siteField(input.site), this.#fetch)
        return { id: root.registry, fingerprint, mirrors: root.mirrors, expires: root.expires }
      }
      case 'add-registry': {
        exactKeys(input, ['action', 'site', 'fingerprint'])
        const site = siteField(input.site)
        if (typeof input.fingerprint !== 'string') throw requestError()
        const fetched = await fetchWorkshopRoot(site, this.#fetch)
        if (fetched.fingerprint !== input.fingerprint) throw new Error('WORKSHOP_ROOT_CHANGED')
        return this.#exclusive(async () => {
          const stored = await this.#load()
          const id = fetched.root.registry
          if (id === OFFICIAL_REGISTRY || stored[id]) throw new Error('WORKSHOP_REGISTRY_EXISTS')
          await this.#save({
            ...stored,
            [id]: { site, root: fetched.envelope, addedAt: new Date(this.#now?.() ?? Date.now()).toISOString() },
          })
          return { id }
        })
      }
      case 'remove-registry': {
        exactKeys(input, ['action', 'registry'])
        const registry = registryField(input.registry)
        if (registry === OFFICIAL_REGISTRY) throw requestError()
        return this.#exclusive(async () => {
          const { [registry]: removed, ...rest } = await this.#load()
          if (!removed) throw new Error('WORKSHOP_REGISTRY_UNKNOWN')
          await this.#save(rest)
          this.#clients.delete(registry)
          await rm(join(this.#directory, 'trust', registry + '.json'), { force: true })
          return { id: registry }
        })
      }
      case 'view':
      case 'refresh': {
        exactKeys(input, ['action', 'registry'])
        const client = await this.#client(registryField(input.registry))
        const view =
          input.action === 'view' ? ((await client.cached()) ?? (await client.refresh())) : await client.refresh()
        return {
          ...summary(view),
          official: view.registry === OFFICIAL_REGISTRY,
          revokedInstalled: await this.#installed(view),
        }
      }
      case 'install': {
        exactKeys(input, ['action', 'registry', 'npm', 'version', 'environmentId'])
        if (
          typeof input.npm !== 'string' ||
          typeof input.version !== 'string' ||
          (input.environmentId !== undefined &&
            (typeof input.environmentId !== 'string' ||
              !environmentIdPattern.test(input.environmentId) ||
              input.environmentId === 'default'))
        )
          throw requestError()
        const view = await (await this.#client(registryField(input.registry))).refresh()
        const target = resolveWorkshopRelease(view, input.npm, input.version)
        const checkers = await this.#checkers(view)
        const spec = `${target.project.npm}@${target.release.version}`
        if (target.project.kind === 'package') {
          if (input.environmentId !== undefined) throw requestError()
          if (hostProvided({ name: target.project.npm })) {
            const shipped = (await this.#host.listPackages()).find(
              item => item.name === target.project.npm && item.version === target.release.version,
            )
            if (shipped) return { packageId: shipped.id }
          }
          return {
            packageId: await this.#host.installPackage(spec, graph => {
              verifyWorkshopGraph(view, target, graph)
              for (const other of checkers.slice(1)) verifyWorkshopDependencies(other, graph)
            }),
          }
        }
        return this.#host.installEnvironment(
          spec,
          input.environmentId,
          async recipe => {
            const pinned = await lockedPackages(recipe.directory)
            verifyWorkshopGraph(view, target, [
              { name: target.project.npm, version: target.release.version, integrity: recipe.integrity },
              ...pinned,
            ])
            for (const other of checkers.slice(1)) verifyWorkshopDependencies(other, pinned)
          },
          graph => {
            for (const checker of checkers) verifyWorkshopDependencies(checker, graph, { hostProvided })
          },
        )
      }
    }
    throw requestError()
  }
}

function rootFingerprint(root: SignedEnvelope<unknown>) {
  return sha256Hex(new TextEncoder().encode(canonicalJson(root)))
}
