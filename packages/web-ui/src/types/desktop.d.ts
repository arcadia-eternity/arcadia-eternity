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
  onProfileChanged?: (callback: () => void) => () => void
  profile?: (input: { action: 'read' | 'raw' } | { action: 'activity'; busy: boolean } | { action: 'commit'; expected: import('@arcadia-eternity/local-profile').ProfileExpectation; next: import('@arcadia-eternity/local-profile').Envelope }) => Promise<{ value?: unknown; error?: { code: string; message: string } }>

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
    resources: import('@arcadia-eternity/schema').PresentationManifest['resources']
  }>
  readLocalRuntime?: (token: string) => Promise<import('@arcadia-eternity/battle/sandbox').SandboxEnvironment>
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
  getLocalServerPort: () => Promise<number | null>
  downloadPetSwf: (petNum: number, remoteUrl: string) => Promise<string>
  listCachedPets: () => Promise<number[]>
  clearPetCache: () => Promise<void>
  getAppVersion: () => Promise<string>
  checkForUpdates: () => Promise<DesktopUpdateCheckResult>
  downloadAndInstallUpdate: () => Promise<void>
  relaunch: () => Promise<void>
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
      updateProfileDraft?: (data: import('@arcadia-eternity/local-profile').ProfileData) => Promise<void>
      requestProfileSave?: (input: { data: import('@arcadia-eternity/local-profile').ProfileData; expectedRevision: number | null }) => Promise<void>
      getBootConfig(): Promise<{ schemaVersion: 1; mode: 'remote-play'; backendOrigin: string; sessionId: string; profile?: import('@arcadia-eternity/local-profile').ProfileSnapshot }>
      close(): Promise<void>
    }
  }
}
