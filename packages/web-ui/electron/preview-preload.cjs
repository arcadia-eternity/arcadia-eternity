const { contextBridge, ipcRenderer } = require('electron')
// Preview windows have no account, file, author or generic IPC capabilities.
contextBridge.exposeInMainWorld('arcadiaRemotePlay', {
  getBootConfig: async () => ({ schemaVersion: 1, backendOrigin: 'http://offline.invalid' }),
})

// Only project-bound team operations; no arbitrary source path or generic author IPC.
contextBridge.exposeInMainWorld('arcadiaAuthorPreview', {
  environment: (action, input) => ipcRenderer.invoke('author-preview:environment', action, input),
  teams: (action, input) => ipcRenderer.invoke('author-preview:teams', action, input),
  returnToEditor: () => ipcRenderer.send('author-preview:return'),
})
