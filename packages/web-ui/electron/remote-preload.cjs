const { contextBridge, ipcRenderer } = require('electron')
// No generic IPC and no manager, filesystem, package, updater or process APIs.
contextBridge.exposeInMainWorld('arcadiaRemotePlay', {
  getBootConfig: () => ipcRenderer.invoke('remote-play:get-boot-config'),
  close: () => ipcRenderer.invoke('remote-play:close'),
})
