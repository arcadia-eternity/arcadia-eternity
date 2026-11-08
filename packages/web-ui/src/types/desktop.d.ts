interface PackTemplateSummary {
  id: string
  name: string
  description: string
}

export interface WorkspacePackSummary {
  folderName: string
  id: string
  version: string
  manifestPath: string
  enabled: boolean
  canDisable: boolean
}

interface CreatePackFromTemplateInput {
  folderName: string
  packId?: string
  version?: string
  template?: string
}

interface CreatePackFromTemplateResult {
  folderName: string
  packId: string
  version: string
  packPath: string
  createdFiles: string[]
}

interface SetWorkspacePackEnabledInput {
  folderName: string
  enabled: boolean
}

interface SetWorkspacePackEnabledResult {
  folderName: string
  enabled: boolean
}

interface ReadWorkspacePackManifestInput {
  folderName: string
}

interface ReadWorkspacePackManifestResult {
  folderName: string
  manifest: Record<string, unknown>
}

interface WriteWorkspacePackManifestInput {
  folderName: string
  manifest: Record<string, unknown>
}

interface ReadWorkspacePackFileInput {
  folderName: string
  relativePath: string
}

interface ReadWorkspacePackFileResult {
  folderName: string
  relativePath: string
  content: string
}

interface WriteWorkspacePackFileInput {
  folderName: string
  relativePath: string
  content: string
}

interface WriteWorkspacePackFileResult {
  folderName: string
  relativePath: string
}

interface CreateWorkspacePackFolderInput {
  folderName: string
  relativePath: string
}

interface CreateWorkspacePackFolderResult {
  folderName: string
  relativePath: string
}

interface RenameWorkspacePackPathInput {
  folderName: string
  oldRelativePath: string
  newRelativePath: string
}

interface RenameWorkspacePackPathResult {
  folderName: string
  oldRelativePath: string
  newRelativePath: string
}

interface DeleteWorkspacePackPathInput {
  folderName: string
  relativePath: string
  recursive?: boolean
}

interface DeleteWorkspacePackPathResult {
  folderName: string
  relativePath: string
}

interface WorkspacePackFileEntry {
  relativePath: string
  size: number
  ext: string
  isDirectory?: boolean
}

interface ListWorkspacePackFilesInput {
  folderName: string
}

interface ListWorkspacePackFilesResult {
  folderName: string
  files: WorkspacePackFileEntry[]
}

interface DesktopUpdateCheckResult {
  hasUpdate: boolean
  version?: string
}

export type LocalBattleHostStatus =
  | { status: 'idle' | 'starting' | 'stopping' }
  | { status: 'cancelled' }
  | {
      status: 'running'
      url: string
      serverId: string
      projectName: string
      localRecovery?: boolean
      network?: {
        host: string
        port: number
        scope: 'local' | 'network'
        publicOrigin?: string
        availableHosts: string[]
        inviteUrls: string[]
      }
    }
  | { status: 'failed'; code: string; message: string }

export interface ArcadiaDesktopApi {
  localEnvironment?: (input: Record<string, unknown>) => Promise<{ result?: unknown; error?: { code: string; message: string } }>
  managementRequest?: import('@/services/managementClient').ManagementIpcBridge
  author?: (
    input: Record<string, unknown>,
  ) => Promise<{ result?: unknown; error?: { code: string; message: string; file?: string } }>
  onAuthorChanged?: (callback: (event: { id: string; file?: string; type: string }) => void) => () => void
  getBackendConfig(): Promise<{ schemaVersion: 1; backendOrigin: string }>
  openServerWebsite(input: { url: string }): Promise<void>
  openRemotePlay(input: { url: string; mode?: 'play' | 'management' }): Promise<unknown>
  listContentPackages?: () => Promise<import('./contentPackages').ContentLibrarySnapshot>
  prepareLocalContent?: () => Promise<{
    token: string
    environment?: import('@arcadia-eternity/battle/sandbox').SandboxEnvironment
    content: import('@arcadia-eternity/protocol').ServerEnvironmentContent
  }>
  readLocalRuntime?: (token: string) => Promise<import('@arcadia-eternity/battle/sandbox').SandboxEnvironment>
  readCreatorBase?: () => Promise<import('@/features/creator/content').CreatorContent>
  capturePersonalEnvironment?: () => Promise<{
    environment: import('@arcadia-eternity/battle/sandbox').SandboxEnvironment
    content: import('@arcadia-eternity/protocol').ServerEnvironmentContent
    runtime: import('@arcadia-eternity/protocol').NativeRuntimeIdentity
    packages: import('@arcadia-eternity/protocol').ServerEnvironmentDescriptor['packages']
    assets: { id: string; mime: string; data: string }[]
  }>
  releaseLocalContent?: (token: string) => Promise<void>
  selectContentPackageFile?: (options: {
    offline?: boolean
  }) => Promise<import('./contentPackages').ContentPackagePlan | null>
  inspectNpmContentPackage?: (options: {
    spec: string
    offline?: boolean
  }) => Promise<import('./contentPackages').ContentPackagePlan>
  contentPackageAction?: (
    input: import('./contentPackages').ContentPackageAction,
  ) => Promise<import('./contentPackages').ContentPackagePlan | string | null>
  listContentProjects?: () => Promise<ContentProjectSummary[]>
  addContentProject?: () => Promise<string | null>
  contentProjectAction?: (input: ContentProjectAction) => Promise<unknown>
  localServer?: (input: import('./localServer').LocalServerRequest) => Promise<import('./localServer').LocalServerSnapshot>
  getLocalBattleStatus?: () => Promise<LocalBattleHostStatus>
  installContentPackageFile?: (options?: { offline?: boolean }) => Promise<string | null>
  installNpmContentPackage?: (options: { spec: string; offline?: boolean }) => Promise<string>
  readWorkWorkspace?: () => Promise<import('@arcadia-eternity/pack-loader/native').WorkSnapshot>
  compareAndSwapWorkWorkspace?: (input: {
    expected: number
    workspace: import('@arcadia-eternity/pack-loader/native').WorkWorkspace
  }) => Promise<boolean>
  getLocalServerPort: () => Promise<number | null>
  downloadPetSwf: (petNum: number, remoteUrl: string) => Promise<string>
  listCachedPets: () => Promise<number[]>
  clearPetCache: () => Promise<void>
  listPackTemplates: () => Promise<PackTemplateSummary[]>
  listWorkspacePacks: () => Promise<WorkspacePackSummary[]>
  createPackFromTemplate: (input: CreatePackFromTemplateInput) => Promise<CreatePackFromTemplateResult>
  setWorkspacePackEnabled: (input: SetWorkspacePackEnabledInput) => Promise<SetWorkspacePackEnabledResult>
  readWorkspacePackManifest: (input: ReadWorkspacePackManifestInput) => Promise<ReadWorkspacePackManifestResult>
  writeWorkspacePackManifest: (input: WriteWorkspacePackManifestInput) => Promise<void>
  listWorkspacePackFiles: (input: ListWorkspacePackFilesInput) => Promise<ListWorkspacePackFilesResult>
  readWorkspacePackFile: (input: ReadWorkspacePackFileInput) => Promise<ReadWorkspacePackFileResult>
  writeWorkspacePackFile: (input: WriteWorkspacePackFileInput) => Promise<WriteWorkspacePackFileResult>
  writeBasePackFile: (input: WriteWorkspacePackFileInput) => Promise<WriteWorkspacePackFileResult>
  readBasePackFile: (input: ReadWorkspacePackFileInput) => Promise<ReadWorkspacePackFileResult>
  readAllBasePackData: () => Promise<Record<string, Record<string, unknown>[]>>
  createWorkspacePackFolder: (input: CreateWorkspacePackFolderInput) => Promise<CreateWorkspacePackFolderResult>
  renameWorkspacePackPath: (input: RenameWorkspacePackPathInput) => Promise<RenameWorkspacePackPathResult>
  deleteWorkspacePackPath: (input: DeleteWorkspacePackPathInput) => Promise<DeleteWorkspacePackPathResult>
  getAppVersion: () => Promise<string>
  checkForUpdates: () => Promise<DesktopUpdateCheckResult>
  downloadAndInstallUpdate: () => Promise<void>
  relaunch: () => Promise<void>
  getBasePackDir: () => Promise<string>
  showItemInFolder: (path: string) => Promise<void>
}

interface ContentProjectPackage {
  name: string
  version: string
  location: string
  dependencies: Record<string, string>
  integrity?: string
  projectId?: string
  namespace?: string
  containsCode?: boolean
}
export interface ContentProjectSummary {
  id: string
  name: string
  directory: string
  installed: boolean
  approved: boolean
  running: boolean
  exported?: boolean
  dependencies: Record<string, string>
  error?: string
  inspection?: {
    checkedAt: string
    digest: string
    packages: ContentProjectPackage[]
    contentIds: { species: string[]; skills: string[]; marks: string[] }
  }
}
export interface ContentProjectAction {
  id: string
  action: 'inspect' | 'install' | 'approve' | 'validate' | 'verify' | 'rename' | 'forget' | 'export'
  name?: string
  offline?: boolean
  includeLocalArtifacts?: boolean
}

declare global {
  interface Window {
    arcadiaDesktop?: ArcadiaDesktopApi
    arcadiaAuthorPreview?: {
      onChanged?(listener: (change: { type: string; file?: string }) => void): () => void
      environment: import('@/features/authoring/debugEnvironment').DebugEnvironmentBridge
      teams: import('@/components/team/library').ProjectTeamStorage
      returnToEditor(): void
    }
    arcadiaRemotePlay?: {
      getBootConfig(): Promise<{ schemaVersion: 1; mode: 'remote-play'; backendOrigin: string; sessionId: string }>
      close(): Promise<void>
    }
  }
}
