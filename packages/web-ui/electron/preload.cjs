const { contextBridge, ipcRenderer } = require('electron')

const desktopApi = {
  getLocalServerPort: () => ipcRenderer.invoke('desktop:get-local-server-port'),
  downloadPetSwf: (petNum, remoteUrl) => ipcRenderer.invoke('desktop:download-pet-swf', { petNum, remoteUrl }),
  listCachedPets: () => ipcRenderer.invoke('desktop:list-cached-pets'),
  clearPetCache: () => ipcRenderer.invoke('desktop:clear-pet-cache'),
  listPackTemplates: () => ipcRenderer.invoke('desktop:list-pack-templates'),
  listWorkspacePacks: () => ipcRenderer.invoke('desktop:list-workspace-packs'),
  createPackFromTemplate: input => ipcRenderer.invoke('desktop:create-pack-from-template', input),
  getAppVersion: () => ipcRenderer.invoke('desktop:get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  downloadAndInstallUpdate: () => ipcRenderer.invoke('desktop:download-and-install-update'),
  relaunch: () => ipcRenderer.invoke('desktop:relaunch'),
}

contextBridge.exposeInMainWorld('arcadiaDesktop', desktopApi)
