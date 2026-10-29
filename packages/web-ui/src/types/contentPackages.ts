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
export interface InstalledContentPackage {
  id: string
  name: string
  title: string
  version: string
  namespace: string
  projectId: string
  description: string
  author: string
  source: { kind: 'file' | 'npm'; label: string; spec?: string; file?: string }
  graph: PackageGraphEntry[]
  contentIds: ContentIds
  counts: { species: number; skills: number; marks: number }
  containsCode: boolean
  installedAt: string
  error?: string
}
export interface ContentLibrarySnapshot {
  revision: number
  packages: InstalledContentPackage[]
  activeIds: string[]
  hasSelection: boolean
  serviceStatus: LocalBattleHostStatus
  serviceNeedsRestart: boolean
}
export type ContentPackagePlan =
  | { id: string; kind: 'install'; package: InstalledContentPackage; requiresApproval: boolean }
  | {
      id: string
      kind: 'selection'
      ids: string[]
      graph: PackageGraphEntry[]
      contentIds: ContentIds
      newDependencies: PackageGraphEntry[]
      requiresApproval: boolean
    }
export type ContentPackageAction =
  | { action: 'confirm-install'; planId: string; allowCode: boolean }
  | { action: 'plan-selection'; ids: string[]; offline?: boolean }
  | { action: 'apply-selection'; planId: string; allowCode: boolean }
  | { action: 'cancel'; planId: string }
  | { action: 'uninstall'; packageId: string }
  | { action: 'start' }
