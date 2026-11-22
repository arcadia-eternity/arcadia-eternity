const { contextBridge, ipcRenderer } = require('electron')
// No generic IPC and no manager, filesystem, package, updater or process APIs.
contextBridge.exposeInMainWorld('arcadiaRemotePlay', {
  setTeamDraftPending: pending => ipcRenderer.send('team-draft:pending', pending),
  updateProfileDraft: input => ipcRenderer.invoke('remote-play:profile-draft', input),
  requestProfileSave: input => ipcRenderer.invoke('remote-play:save-profile', input),
  readMediaCache: (scope, url, limit, originalUrl) =>
    ipcRenderer.invoke('remote-play:media-read', scope, url, limit, originalUrl),
  writeMediaCache: (scope, url, bytes) => ipcRenderer.invoke('remote-play:media-write', scope, url, bytes),
  clearMediaCache: scope => ipcRenderer.invoke('remote-play:media-clear', scope),
  getBootConfig: () => ipcRenderer.invoke('remote-play:get-boot-config'),
  close: () => ipcRenderer.invoke('remote-play:close'),
})

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
