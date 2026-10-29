const { contextBridge, ipcRenderer } = require('electron')
// No generic IPC and no manager, filesystem, package, updater or process APIs.
contextBridge.exposeInMainWorld('arcadiaRemotePlay', {
  getBootConfig: () => ipcRenderer.invoke('remote-play:get-boot-config'),
  close: () => ipcRenderer.invoke('remote-play:close'),
})

// Fixed presentation controls only. The main process checks the actual owning main frame.
contextBridge.exposeInMainWorld('arcadiaSwf', {
  create: input => ipcRenderer.invoke('swf:create', input),
  send: command => ipcRenderer.invoke('swf:send', command),
  bounds: input => ipcRenderer.invoke('swf:bounds', input),
  dispose: input => ipcRenderer.invoke('swf:dispose', input),
  onEvent: callback => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('swf:event', listener)
    return () => ipcRenderer.removeListener('swf:event', listener)
  },
})
