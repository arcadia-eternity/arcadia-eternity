import type { PackManifest, AssetManifest, PresentationManifest } from '@arcadia-eternity/schema'

export type PackSource = 'node-fs' | 'http'

export type V2DataPackManifest = PackManifest

export type LocaleBundles = Record<string, Record<string, unknown>>

export type LockProvenance = 'npm' | 'workspace' | 'file' | 'git' | 'http' | 'builtin' | 'unknown'

export interface PackLockfile {
  lockfileVersion: 1
  generatedAt: string
  importers: Record<
    string,
    {
      specifiers?: Record<string, string>
      dependencies?: Record<
        string,
        {
          specifier: string
          version: string
          packageKey: string
        }
      >
    }
  >
  packages: Record<
    string,
    {
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
    }
  >
}

export interface AssetConflict {
  kind: 'assetUri'
  scope: 'assets'
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

export interface PackMetadataResult {
  errors: string[]
  pack?: V2DataPackManifest
  locales?: LocaleBundles
  lockfile?: PackLockfile
  lockfileIssues?: string[]
  presentation?: PresentationManifest[]
  assets?: AssetManifest[]
  assetConflicts?: AssetConflict[]
  source: PackSource
  packRef: string
}
