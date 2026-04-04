const { contextBridge, ipcRenderer } = require('electron')

const desktopApi = {
  getLocalServerPort: () => ipcRenderer.invoke('desktop:get-local-server-port'),
  downloadPetSwf: (petNum, remoteUrl) => ipcRenderer.invoke('desktop:download-pet-swf', { petNum, remoteUrl }),
  listCachedPets: () => ipcRenderer.invoke('desktop:list-cached-pets'),
  clearPetCache: () => ipcRenderer.invoke('desktop:clear-pet-cache'),
  listPackTemplates: () => ipcRenderer.invoke('desktop:list-pack-templates'),
  listWorkspacePacks: () => ipcRenderer.invoke('desktop:list-workspace-packs'),
  createPackFromTemplate: input => ipcRenderer.invoke('desktop:create-pack-from-template', input),
  setWorkspacePackEnabled: input => ipcRenderer.invoke('desktop:set-workspace-pack-enabled', input),
  readWorkspacePackManifest: input => ipcRenderer.invoke('desktop:read-workspace-pack-manifest', input),
  writeWorkspacePackManifest: input => ipcRenderer.invoke('desktop:write-workspace-pack-manifest', input),
  listWorkspacePackFiles: input => ipcRenderer.invoke('desktop:list-workspace-pack-files', input),
  readWorkspacePackFile: input => ipcRenderer.invoke('desktop:read-workspace-pack-file', input),
  writeWorkspacePackFile: input => ipcRenderer.invoke('desktop:write-workspace-pack-file', input),
  createWorkspacePackFolder: input => ipcRenderer.invoke('desktop:create-workspace-pack-folder', input),
  renameWorkspacePackPath: input => ipcRenderer.invoke('desktop:rename-workspace-pack-path', input),
  deleteWorkspacePackPath: input => ipcRenderer.invoke('desktop:delete-workspace-pack-path', input),
  getAppVersion: () => ipcRenderer.invoke('desktop:get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  downloadAndInstallUpdate: () => ipcRenderer.invoke('desktop:download-and-install-update'),
  relaunch: () => ipcRenderer.invoke('desktop:relaunch'),
}

contextBridge.exposeInMainWorld('arcadiaDesktop', desktopApi)
