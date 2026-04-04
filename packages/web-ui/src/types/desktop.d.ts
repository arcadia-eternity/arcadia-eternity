export interface PackTemplateSummary {
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

export interface CreatePackFromTemplateInput {
  folderName: string
  packId?: string
  version?: string
  template?: string
}

export interface CreatePackFromTemplateResult {
  folderName: string
  packId: string
  version: string
  packPath: string
  createdFiles: string[]
}

export interface SetWorkspacePackEnabledInput {
  folderName: string
  enabled: boolean
}

export interface SetWorkspacePackEnabledResult {
  folderName: string
  enabled: boolean
}

export interface ReadWorkspacePackManifestInput {
  folderName: string
}

export interface ReadWorkspacePackManifestResult {
  folderName: string
  manifest: Record<string, unknown>
}

export interface WriteWorkspacePackManifestInput {
  folderName: string
  manifest: Record<string, unknown>
}

export interface ReadWorkspacePackFileInput {
  folderName: string
  relativePath: string
}

export interface ReadWorkspacePackFileResult {
  folderName: string
  relativePath: string
  content: string
}

export interface WriteWorkspacePackFileInput {
  folderName: string
  relativePath: string
  content: string
}

export interface WriteWorkspacePackFileResult {
  folderName: string
  relativePath: string
}

export interface CreateWorkspacePackFolderInput {
  folderName: string
  relativePath: string
}

export interface CreateWorkspacePackFolderResult {
  folderName: string
  relativePath: string
}

export interface RenameWorkspacePackPathInput {
  folderName: string
  oldRelativePath: string
  newRelativePath: string
}

export interface RenameWorkspacePackPathResult {
  folderName: string
  oldRelativePath: string
  newRelativePath: string
}

export interface DeleteWorkspacePackPathInput {
  folderName: string
  relativePath: string
  recursive?: boolean
}

export interface DeleteWorkspacePackPathResult {
  folderName: string
  relativePath: string
}

export interface WorkspacePackFileEntry {
  relativePath: string
  size: number
  ext: string
  isDirectory?: boolean
}

export interface ListWorkspacePackFilesInput {
  folderName: string
}

export interface ListWorkspacePackFilesResult {
  folderName: string
  files: WorkspacePackFileEntry[]
}

export interface DesktopUpdateCheckResult {
  hasUpdate: boolean
  version?: string
}

export interface ArcadiaDesktopApi {
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
  createWorkspacePackFolder: (input: CreateWorkspacePackFolderInput) => Promise<CreateWorkspacePackFolderResult>
  renameWorkspacePackPath: (input: RenameWorkspacePackPathInput) => Promise<RenameWorkspacePackPathResult>
  deleteWorkspacePackPath: (input: DeleteWorkspacePackPathInput) => Promise<DeleteWorkspacePackPathResult>
  getAppVersion: () => Promise<string>
  checkForUpdates: () => Promise<DesktopUpdateCheckResult>
  downloadAndInstallUpdate: () => Promise<void>
  relaunch: () => Promise<void>
}

declare global {
  interface Window {
    arcadiaDesktop?: ArcadiaDesktopApi
  }
}

export {}
