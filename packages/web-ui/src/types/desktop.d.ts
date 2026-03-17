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
