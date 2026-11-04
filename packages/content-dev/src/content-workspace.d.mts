export interface EnvironmentRules {
  schemaVersion: 1
  tier?: string
  allow?: { species?: string[]; skills?: string[]; marks?: string[] }
  deny?: { species?: string[]; skills?: string[]; marks?: string[] }
  team?: { minSize?: number; maxSize?: number; uniqueSpecies?: boolean }
}
export interface EnvironmentDocument {
  schemaVersion: 2
  id: string
  name: string
  packages: Record<string, string>
  sources: string[]
  rules: EnvironmentRules
  requires: { engine?: string; sdk?: string; capabilities?: string[] }
}
export interface EnvironmentDraft {
  document: EnvironmentDocument
  revision: string
}
export interface EnvironmentVersion {
  format: 'arcadia.environment-version/1'
  versionId: string
  workspaceId: string
  environmentId: string
  document: EnvironmentDocument
  draftRevision: string
  contentRevision: string
  packages: unknown[]
  createdAt: number
  adopted: boolean
  materialDirectory: string
  directory: string
  status: 'ready'
}
export interface UnavailableVersion {
  versionId: string
  workspaceId: string
  environmentId?: string
  status: 'unavailable'
  reason: string
}
export interface PrepareVersionInput {
  environmentId: string
  expectedRevision: string
  projectDirectory?: string
  directory?: string
  signal?: AbortSignal
  beforeCommit?: () => Promise<void>
}
export type StaticPreparer = (input: {
  directory: string
  draft: EnvironmentDocument
  signal?: AbortSignal
}) => Promise<{
  contentRevision: string
  packages?: unknown[]
}>
export interface ContentWorkspaceOptions {
  maxBytes?: number
  maxFiles?: number
  stagingRetentionMs?: number
  resolveProject?: (environmentId: string) => string | undefined | Promise<string | undefined>
  acquireMaterials?: (directory: string, versionId: string) => Promise<() => void | Promise<void>>
  retentions?: {
    list(versionId: string): Promise<Record<string, unknown>[]>
    put?(versionId: string, retentionId: string): Promise<void>
    remove?(retentionId: string): Promise<void>
  }
}
export interface EnvironmentExport {
  format: 'arcadia.environment-export/1'
  document: EnvironmentDocument
  contentRevision: string
  files: { path: string; data: string }[]
}
export interface WorkspaceSnapshot {
  format: 'arcadia.workspace-snapshot/1'
  workspaceId: string
  drafts: EnvironmentDraft[]
  versions: {
    version: Pick<
      EnvironmentVersion,
      'versionId' | 'environmentId' | 'document' | 'draftRevision' | 'contentRevision' | 'packages' | 'createdAt'
    >
    files: { path: string; data: string }[]
  }[]
}
export interface WorkspaceSnapshotStamp {
  workspaceId: string
  bootId: string
  generation: number
}
export interface WorkspaceSnapshotCapture {
  snapshot: WorkspaceSnapshot
  stamp: WorkspaceSnapshotStamp
}
export class ContentWorkspace {
  readonly root: string
  readonly workspaceId: string
  readonly bootId: string
  static open(directory: string, options?: ContentWorkspaceOptions): Promise<ContentWorkspace>
  listDrafts(): Promise<EnvironmentDraft[]>
  getDraft(environmentId: string): Promise<EnvironmentDraft>
  saveDraft(input: { document: unknown; expectedRevision: string | null }): Promise<EnvironmentDraft>
  deleteDraft(input: { environmentId: string; expectedRevision: string }): Promise<void>
  prepareVersion(input: PrepareVersionInput, preparer: StaticPreparer): Promise<EnvironmentVersion>
  adoptVersion(input: PrepareVersionInput, preparer: StaticPreparer): Promise<EnvironmentVersion>
  getVersion(versionId: string): Promise<EnvironmentVersion>
  listVersions(environmentId?: string): Promise<(EnvironmentVersion | UnavailableVersion)[]>
  acquire(versionId: string, owner?: string): Promise<EnvironmentVersion & { release(): Promise<void> }>
  retain(versionId: string, retentionId: string): Promise<void>
  releaseRetention(retentionId: string): Promise<void>
  references(versionId: string): Promise<Record<string, unknown>[]>
  deleteVersion(versionId: string): Promise<void>
  exportVersion(versionId: string): Promise<EnvironmentExport>
  exportSnapshot(): Promise<WorkspaceSnapshot>
  captureSnapshot(): Promise<WorkspaceSnapshotCapture>
  isSnapshotCurrent(stamp: WorkspaceSnapshotStamp): Promise<boolean>
  restoreSnapshot(
    snapshot: WorkspaceSnapshot,
    input: { mode: 'restore' | 'clone' },
    preparer: StaticPreparer,
  ): Promise<{ workspaceId: string; versionIds: Record<string, string> }>
  importVersion(
    bundle: EnvironmentExport,
    input: {
      environmentId?: string
      expectedRevision?: string | null
      signal?: AbortSignal
      beforeCommit?: () => Promise<void>
      importId?: string
    },
    preparer: StaticPreparer,
  ): Promise<EnvironmentVersion>
  recoverImport(importId: string): Promise<EnvironmentVersion>
  forgetImport(importId: string, input?: { discard?: boolean }): Promise<void>
  reconcile(): Promise<{
    workspaceId: string
    versions: (EnvironmentVersion | UnavailableVersion)[]
    abandoned: string[]
  }>
  close(input?: { force?: boolean }): Promise<void>
  cleanupStaging(): Promise<string[]>
}
