import { fileWorkshopTrustStore, inspectNpmProject } from '@arcadia-eternity/pack-loader/node'
import {
  OFFICIAL_WORKSHOP_ROOT,
  WorkshopClient,
  verifyWorkshopDependencies,
  type SignedEnvelope,
  type WorkshopFetch,
  type WorkshopView,
} from '@arcadia-eternity/pack-loader/workshop'

/**
 * `required`: every install needs a fresh signed index. `available`: use a fresh index, else the verified offline
 * cache; with neither, installs proceed unchecked. `off`: no checks.
 */
export type WorkshopCheckMode = 'required' | 'available' | 'off'

export interface WorkshopGraphCheck {
  /** Rejects an installed project whose graph contains revoked or tampered registry releases. */
  check(directory: string, signal?: AbortSignal): Promise<void>
}

/** The host always stages the official base from its own shipped or cached copy, so its archive digest differs. */
const hostProvided = (item: { name: string }) => item.name === '@arcadia-eternity/data-pack-base'

export function createWorkshopGraphCheck(options: {
  mode: WorkshopCheckMode
  directory: string
  offline?: boolean
  trustedRoot?: SignedEnvelope<unknown>
  fetch?: WorkshopFetch
  now?: () => number
  onUnavailable?: (error: unknown) => void
}): WorkshopGraphCheck | undefined {
  if (options.mode === 'off') return undefined
  const client = new WorkshopClient({
    trustedRoot: options.trustedRoot ?? OFFICIAL_WORKSHOP_ROOT,
    store: fileWorkshopTrustStore(options.directory),
    fetch: options.fetch,
    now: options.now,
  })
  const view = async (signal?: AbortSignal): Promise<WorkshopView | undefined> => {
    if (options.offline) return client.cached()
    try {
      return await client.refresh(signal)
    } catch (error) {
      signal?.throwIfAborted()
      if (options.mode === 'required') throw error
      options.onUnavailable?.(error)
      return undefined
    }
  }
  return {
    async check(directory, signal) {
      const current = await view(signal)
      if (!current) {
        if (options.mode === 'required')
          throw Object.assign(new Error('WORKSHOP_INDEX_STALE'), { code: 'WORKSHOP_INDEX_STALE' })
        return
      }
      const inspection = await inspectNpmProject(directory)
      signal?.throwIfAborted()
      verifyWorkshopDependencies(current, inspection.packages, {
        hostProvided,
        allowStale: options.mode === 'available',
      })
    },
  }
}
