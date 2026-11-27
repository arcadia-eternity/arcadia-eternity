import type { WorkshopProject, WorkshopRevocation } from '@arcadia-eternity/pack-loader/workshop'

/** Omitting `registry` selects the official registry. */
export type WorkshopRequest =
  | { action: 'registries' }
  | { action: 'preview-registry'; site: string }
  | { action: 'add-registry'; site: string; fingerprint: string }
  | { action: 'remove-registry'; registry: string }
  | { action: 'view' | 'refresh'; registry?: string }
  | { action: 'install'; registry?: string; npm: string; version: string; environmentId?: string }

export interface WorkshopRevokedInstall {
  packageId: string
  name: string
  version: string
  reason: string
}

export interface WorkshopSummary {
  registry: string
  official: boolean
  freshness: 'fresh' | 'stale'
  checkedAt?: string
  snapshot: number
  expires: string
  error?: { code: string; message: string }
  projects: WorkshopProject[]
  revocations: WorkshopRevocation[]
  revokedInstalled: WorkshopRevokedInstall[]
}

export interface WorkshopRegistryEntry {
  id: string
  site: string
  official: boolean
  addedAt?: string
  fingerprint?: string
}

export interface WorkshopRegistryPreview {
  id: string
  fingerprint: string
  mirrors: string[]
  expires: string
}

/** Package installs return the library entry id; environment installs return a local environment operation. */
export type WorkshopInstallResult = { packageId: string } | { operationId: string }

export type WorkshopResult =
  | WorkshopSummary
  | WorkshopInstallResult
  | WorkshopRegistryPreview
  | { registries: WorkshopRegistryEntry[] }
  | { id: string }
