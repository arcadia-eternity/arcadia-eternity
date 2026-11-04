import type { ContentWorkspace, EnvironmentVersion, StaticPreparer } from './content-workspace.mjs'
import type { ManagedSource } from './managed-sources.mjs'
export interface ManagedProjectsOptions {
  registry?: string
  offline?: boolean
  /** Host permission to acquire metadata/materials; never grants authority to execute them. */
  allowThirdPartyContent?: boolean
  sources?: Record<string, ManagedSource>
  npmUserConfig?: string
  timeoutMs?: number
  maxBytes?: number
  maxFiles?: number
  maxConcurrent?: number
}
export class ManagedProjects {
  readonly root: string
  constructor(root: string, options?: ManagedProjectsOptions)
  prepareProject<T>(
    document: unknown,
    input: { signal?: AbortSignal },
    consume: (directory: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T>
  prepareVersion(
    workspace: ContentWorkspace,
    input: {
      environmentId: string
      expectedRevision: string
      signal?: AbortSignal
      beforeCommit?: () => Promise<void>
    },
    validate: StaticPreparer,
  ): Promise<EnvironmentVersion>
  close(): Promise<void>
}
