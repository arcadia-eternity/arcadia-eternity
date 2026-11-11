const { contextBridge, ipcRenderer } = require('electron')

const desktopApi = {
  author: input => ipcRenderer.invoke('desktop:author', input),
  localEnvironment: input => ipcRenderer.invoke('desktop:local-environment', input),
  managementRequest: input => ipcRenderer.invoke('desktop:management-request', input),
  onAuthorChanged: callback => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('desktop:author-changed', listener)
    return () => ipcRenderer.removeListener('desktop:author-changed', listener)
  },
  getBackendConfig: () => ipcRenderer.invoke('desktop:get-backend-config'),
  openServerWebsite: input => ipcRenderer.invoke('desktop:open-server-website', input),
  openRemotePlay: input => ipcRenderer.invoke('desktop:open-remote-play', input),
  listContentPackages: () => ipcRenderer.invoke('desktop:list-content-packages'),
  prepareLocalContent: () => ipcRenderer.invoke('desktop:prepare-local-content'),
  readLocalRuntime: token => ipcRenderer.invoke('desktop:read-local-runtime', token),
  capturePersonalEnvironment: () => ipcRenderer.invoke('desktop:capture-personal-environment'),
  releaseLocalContent: token => ipcRenderer.invoke('desktop:release-local-content', token),
  selectContentPackageFile: options => ipcRenderer.invoke('desktop:select-content-package-file', options),
  inspectNpmContentPackage: options => ipcRenderer.invoke('desktop:inspect-npm-content-package', options),
  contentPackageAction: input => ipcRenderer.invoke('desktop:content-package-action', input),
  getLocalServerPort: () => ipcRenderer.invoke('desktop:get-local-server-port'),
  localServer: input => ipcRenderer.invoke('desktop:local-server', input),
  getLocalBattleStatus: () => ipcRenderer.invoke('desktop:get-local-battle-status'),
  installContentPackageFile: options => ipcRenderer.invoke('desktop:install-content-package-file', options),
  installNpmContentPackage: options => ipcRenderer.invoke('desktop:install-npm-content-package', options),
  listContentProjects: () => ipcRenderer.invoke('desktop:list-content-projects'),
  addContentProject: () => ipcRenderer.invoke('desktop:add-content-project'),
  contentProjectAction: input => ipcRenderer.invoke('desktop:content-project-action', input),
  downloadPetSwf: (petNum, remoteUrl) => ipcRenderer.invoke('desktop:download-pet-swf', { petNum, remoteUrl }),
  listCachedPets: () => ipcRenderer.invoke('desktop:list-cached-pets'),
  clearPetCache: () => ipcRenderer.invoke('desktop:clear-pet-cache'),
  getAppVersion: () => ipcRenderer.invoke('desktop:get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  downloadAndInstallUpdate: () => ipcRenderer.invoke('desktop:download-and-install-update'),
  relaunch: () => ipcRenderer.invoke('desktop:relaunch'),
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
