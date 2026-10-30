const { contextBridge, ipcRenderer } = require('electron')

const desktopApi = {
  author: input => ipcRenderer.invoke('desktop:author', input),
  onAuthorChanged: callback => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('desktop:author-changed', listener)
    return () => ipcRenderer.removeListener('desktop:author-changed', listener)
  },
  getBackendConfig: () => ipcRenderer.invoke('desktop:get-backend-config'),
  openRemotePlay: input => ipcRenderer.invoke('desktop:open-remote-play', input),
  listContentPackages: () => ipcRenderer.invoke('desktop:list-content-packages'),
  selectContentPackageFile: options => ipcRenderer.invoke('desktop:select-content-package-file', options),
  inspectNpmContentPackage: options => ipcRenderer.invoke('desktop:inspect-npm-content-package', options),
  contentPackageAction: input => ipcRenderer.invoke('desktop:content-package-action', input),
  readWorkWorkspace: () => ipcRenderer.invoke('desktop:read-work-workspace'),
  compareAndSwapWorkWorkspace: input => ipcRenderer.invoke('desktop:write-work-workspace', input),
  getLocalServerPort: () => ipcRenderer.invoke('desktop:get-local-server-port'),
  selectAndStartLocalBattle: () => ipcRenderer.invoke('desktop:select-and-start-local-battle'),
  getLocalBattleStatus: () => ipcRenderer.invoke('desktop:get-local-battle-status'),
  installContentPackageFile: options => ipcRenderer.invoke('desktop:install-content-package-file', options),
  installNpmContentPackage: options => ipcRenderer.invoke('desktop:install-npm-content-package', options),
  stopLocalBattle: () => ipcRenderer.invoke('desktop:stop-local-battle'),
  listContentProjects: () => ipcRenderer.invoke('desktop:list-content-projects'),
  addContentProject: () => ipcRenderer.invoke('desktop:add-content-project'),
  contentProjectAction: input => ipcRenderer.invoke('desktop:content-project-action', input),
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
  writeBasePackFile: input => ipcRenderer.invoke('desktop:write-base-pack-file', input),
  readBasePackFile: input => ipcRenderer.invoke('desktop:read-base-pack-file', input),
  readAllBasePackData: () => ipcRenderer.invoke('desktop:read-all-base-pack-data'),
  createWorkspacePackFolder: input => ipcRenderer.invoke('desktop:create-workspace-pack-folder', input),
  renameWorkspacePackPath: input => ipcRenderer.invoke('desktop:rename-workspace-pack-path', input),
  deleteWorkspacePackPath: input => ipcRenderer.invoke('desktop:delete-workspace-pack-path', input),
  getAppVersion: () => ipcRenderer.invoke('desktop:get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  downloadAndInstallUpdate: () => ipcRenderer.invoke('desktop:download-and-install-update'),
  relaunch: () => ipcRenderer.invoke('desktop:relaunch'),
  getBasePackDir: () => ipcRenderer.invoke('desktop:get-base-pack-dir'),
  showItemInFolder: path => ipcRenderer.invoke('desktop:show-item-in-folder', { path }),
}

contextBridge.exposeInMainWorld('arcadiaDesktop', desktopApi)

// Fixed presentation controls only. The main process checks the actual owning main frame.
contextBridge.exposeInMainWorld('arcadiaSwf', {
  create: input => ipcRenderer.invoke('swf:create', input),
  send: command => ipcRenderer.invoke('swf:send', command),
  bounds: input => ipcRenderer.invoke('swf:bounds', input),
  dispose: input => ipcRenderer.invoke('swf:dispose', input),
  ackFrame: input =>
    ipcRenderer.send('swf:frame-ack', { instance: input?.instance, task: input?.task, frame: input?.frame }),
  onFrame: callback => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('swf:frame', listener)
    return () => ipcRenderer.removeListener('swf:frame', listener)
  },
  onEvent: callback => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('swf:event', listener)
    return () => ipcRenderer.removeListener('swf:event', listener)
  },
})
