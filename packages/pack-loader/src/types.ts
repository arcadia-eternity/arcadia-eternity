import type { V2DataRepository } from '@arcadia-eternity/battle'
import type { PackManifest } from '@arcadia-eternity/schema/src/pack.js'
import type { AssetManifest } from '@arcadia-eternity/schema/src/assets.js'

export type PackSource = 'node-fs' | 'http'

export type V2DataPackManifest = PackManifest

export type LocaleBundles = Record<string, Record<string, unknown>>

export type LockProvenance = 'npm' | 'workspace' | 'file' | 'git' | 'http' | 'builtin' | 'unknown'

export interface PackLockfile {
  lockfileVersion: 1
  generatedAt: string
  importers: Record<string, {
    specifiers?: Record<string, string>
    dependencies?: Record<string, {
      specifier: string
      version: string
      packageKey: string
    }>
  }>
  packages: Record<string, {
    name: string
    version: string
    kind: 'data' | 'asset'
    engine: string
    source: string
    entry: string
    provenance: LockProvenance
    resolution?: {
      integrity?: string
      resolved?: string
      tarball?: string
      path?: string
      commit?: string
    }
    dependencies?: Record<string, string>
  }>
}

export interface AssetConflict {
  kind: 'assetUri' | 'mapping'
  scope: 'assets' | 'species' | 'marks' | 'skills'
  key: string
  previous: string
  next: string
  manifestId: string
  manifestVersion: string
  manifestUrl: string
}

export interface PackLoaderOptions {
  source?: PackSource
  continueOnError?: boolean
  validateReferences?: boolean
  enforceLockfile?: boolean
}

export interface PackLoadResult {
  repository: V2DataRepository
  errors: string[]
  pack?: V2DataPackManifest
  locales?: LocaleBundles
  lockfile?: PackLockfile
  lockfileIssues?: string[]
  assets?: AssetManifest[]
  assetConflicts?: AssetConflict[]
  source: PackSource
  packRef: string
}

export interface PackLoadSummary {
  source: PackSource
  packRef: string
  packId?: string
  packVersion?: string
  hasLockfile: boolean
  lockfileIssueCount: number
  effectCount: number
  markCount: number
  skillCount: number
  speciesCount: number
  errorCount: number
}
