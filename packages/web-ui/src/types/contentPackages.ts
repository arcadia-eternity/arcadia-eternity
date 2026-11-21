import type { ManagedReadyEnvironmentInstallation } from '@arcadia-eternity/protocol'
import type { LocalBattleHostStatus } from './desktop'

export interface PackageGraphEntry {
  name: string
  version: string
  integrity?: string
  dependencies: Record<string, string>
  projectId?: string
  namespace?: string
  containsCode?: boolean
}
export interface ContentIds {
  species: string[]
  skills: string[]
  marks: string[]
}
export interface PackageRuleCatalog {
  members: NonNullable<ManagedReadyEnvironmentInstallation['members']>
  ruleSets: NonNullable<ManagedReadyEnvironmentInstallation['ruleComposition']>['ruleSets']
}
export interface InstalledContentPackage {
  id: string
  bundled?: boolean
  name: string
  title: string
  version: string
  namespace: string
  projectId: string
  description: string
  author: string
  sdkApi?: number
  license?: string
  engines?: Record<string, string>
  dependencyRanges?: Record<string, string>
  source: { kind: 'file' | 'npm'; label: string; spec?: string; file?: string; provenance?: Record<string, string> }
  graph: PackageGraphEntry[]
  ruleCatalog?: PackageRuleCatalog
  contentIds: ContentIds
  counts: { species: number; skills: number; marks: number }
  containsCode: boolean
  installedAt: string
  error?: string
}
export interface ContentLibrarySnapshot {
  operations?: {
    id: string
    label: string
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
    stage: string
    error?: string
  }[]
  revision: number
  packages: InstalledContentPackage[]
  serviceStatus: LocalBattleHostStatus
  serviceNeedsRestart: boolean
}
export type RemotePackageSource =
  { kind: 'url'; url: string; integrity?: string } | { kind: 'git'; url: string; commit: string; artifactPath?: string }
export type ContentPackageAction =
  | { action: 'install-remote'; source: RemotePackageSource }
  | { action: 'cancel-install' | 'retry-install'; operationId: string }
  | { action: 'clear-install-tasks' }
  | { action: 'check-update' | 'uninstall'; packageId: string }
  | { action: 'apply-update'; packageId: string; version: string }
