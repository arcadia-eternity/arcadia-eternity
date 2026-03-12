import type { PackLoadResult, PackLockfile } from './types'

export type InstallSource = 'builtin' | 'workspace' | 'file' | 'git' | 'npm' | 'http'

export interface InstalledPack {
  packageName?: string
  id: string
  version: string
  kind: 'data' | 'asset'
  source: InstallSource
  entry: string
  root?: string
  resolved?: string
  integrity?: string
  installedAt?: string
}

export interface PackResolveResult {
  lockfile: PackLockfile
  installed: InstalledPack[]
  missing: Array<{
    name: string
    packageKey: string
    source?: string
  }>
  conflicts: string[]
}

export interface PackInstallRequest {
  source: InstallSource
  specifier: string
  entry?: string
  integrity?: string
}

export interface PackManager {
  listInstalled(): Promise<InstalledPack[]>
  has(packageKey: string): Promise<boolean>
  verify(lockfile: PackLockfile): Promise<PackResolveResult>
  install(request: PackInstallRequest): Promise<InstalledPack>
  resolve(lockfile: PackLockfile): Promise<PackResolveResult>
  load(entryRef: string, options?: {
    enforceLockfile?: boolean
  }): Promise<PackLoadResult>
}
