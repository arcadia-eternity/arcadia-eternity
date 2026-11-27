import type { WorkshopProject, WorkshopRevocation } from '@arcadia-eternity/pack-loader/workshop'

export type WorkshopRequest =
  | { action: 'view' }
  | { action: 'refresh' }
  | { action: 'install'; npm: string; version: string; environmentId?: string }

export interface WorkshopRevokedInstall {
  packageId: string
  name: string
  version: string
  reason: string
}

export interface WorkshopSummary {
  registry: string
  freshness: 'fresh' | 'stale'
  checkedAt?: string
  snapshot: number
  expires: string
  error?: { code: string; message: string }
  projects: WorkshopProject[]
  revocations: WorkshopRevocation[]
  revokedInstalled: WorkshopRevokedInstall[]
}

/** Package installs return the library entry id; environment installs return a local environment operation. */
export type WorkshopInstallResult = { packageId: string } | { operationId: string }
