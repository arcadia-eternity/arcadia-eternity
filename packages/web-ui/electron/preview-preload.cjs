const { contextBridge, ipcRenderer } = require('electron')
// Preview windows have no account, file, author or generic IPC capabilities.
contextBridge.exposeInMainWorld('arcadiaRemotePlay', {
  getBootConfig: async () => ({ schemaVersion: 1, backendOrigin: 'http://offline.invalid' }),
})

// A fixed return action only; author/file APIs stay in the editor window.
contextBridge.exposeInMainWorld('arcadiaAuthorPreview', {
  returnToEditor: () => ipcRenderer.send('author-preview:return'),
})
