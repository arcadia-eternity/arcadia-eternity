import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  OFFICIAL_WORKSHOP_ROOT,
  WorkshopClient,
  registryIdPattern,
  resolveWorkshopRelease,
  revocationFor,
  verifyWorkshopGraph,
  type SignedEnvelope,
  type WorkshopFetch,
  type WorkshopTrustState,
  type WorkshopTrustStore,
  type WorkshopView,
} from '@arcadia-eternity/pack-loader/workshop'
import type { WorkshopInstallResult, WorkshopRequest, WorkshopSummary } from '../src/types/workshop.ts'

export type { WorkshopRequest }

/** Trust state on disk, one file per registry, replaced atomically. */
export function fileTrustStore(directory: string): WorkshopTrustStore {
  let tail = Promise.resolve()
  const file = (registry: string) => {
    if (!registryIdPattern.test(registry)) throw new Error('WORKSHOP_REGISTRY_INVALID')
    return join(directory, registry + '.json')
  }
  return {
    async read(registry) {
      try {
        return JSON.parse(await readFile(file(registry), 'utf8')) as WorkshopTrustState
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    },
    write(registry, state) {
      let target: string
      try {
        target = file(registry)
      } catch (error) {
        return Promise.reject(error)
      }
      const write = tail.then(async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 })
        const temp = join(directory, `.${registry}.${randomUUID()}.tmp`)
        try {
          await writeFile(temp, JSON.stringify(state), { flag: 'wx', mode: 0o600 })
          await rename(temp, target)
        } catch (error) {
          await rm(temp, { force: true })
          throw error
        }
      })
      tail = write.catch(() => {})
      return write
    },
  }
}

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

const summary = (view: WorkshopView): Omit<WorkshopSummary, 'revokedInstalled'> => ({
  registry: view.registry,
  freshness: view.freshness,
  checkedAt: view.checkedAt,
  snapshot: view.snapshot.version,
  expires: view.snapshot.expires,
  error: view.error,
  projects: view.index.projects,
  revocations: view.index.revocations,
})

/** Official registry access for the desktop client. Only a fresh signed index authorizes an install. */
export class DesktopWorkshop {
  readonly #client: WorkshopClient
  readonly #host: WorkshopHost

  constructor(options: {
    directory: string
    host: WorkshopHost
    fetch?: WorkshopFetch
    now?: () => number
    trustedRoot?: SignedEnvelope<unknown>
  }) {
    this.#host = options.host
    this.#client = new WorkshopClient({
      trustedRoot: options.trustedRoot ?? OFFICIAL_WORKSHOP_ROOT,
      store: fileTrustStore(options.directory),
      fetch: options.fetch,
      now: options.now,
    })
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

  async request(input: WorkshopRequest): Promise<WorkshopSummary | WorkshopInstallResult> {
    if (!input || typeof input !== 'object') throw new Error('WORKSHOP_REQUEST_INVALID')
    if (input.action === 'view' || input.action === 'refresh') {
      const view =
        input.action === 'view'
          ? ((await this.#client.cached()) ?? (await this.#client.refresh()))
          : await this.#client.refresh()
      return { ...summary(view), revokedInstalled: await this.#installed(view) }
    }
    if (input.action === 'install') {
      if (
        Object.keys(input).some(key => !['action', 'npm', 'version', 'environmentId'].includes(key)) ||
        typeof input.npm !== 'string' ||
        typeof input.version !== 'string' ||
        (input.environmentId !== undefined &&
          (typeof input.environmentId !== 'string' ||
            !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(input.environmentId) ||
            input.environmentId === 'default'))
      )
        throw new Error('WORKSHOP_REQUEST_INVALID')
      const view = await this.#client.refresh()
      const target = resolveWorkshopRelease(view, input.npm, input.version)
      const spec = `${target.project.npm}@${target.release.version}`
      if (target.project.kind === 'package') {
        if (input.environmentId !== undefined) throw new Error('WORKSHOP_REQUEST_INVALID')
        return { packageId: await this.#host.installPackage(spec, graph => verifyWorkshopGraph(view, target, graph)) }
      }
      return this.#host.installEnvironment(spec, input.environmentId, async recipe => {
        const pinned = await lockedPackages(recipe.directory)
        verifyWorkshopGraph(view, target, [
          { name: target.project.npm, version: target.release.version, integrity: recipe.integrity },
          ...pinned,
        ])
      })
    }
    throw new Error('WORKSHOP_REQUEST_INVALID')
  }
}
