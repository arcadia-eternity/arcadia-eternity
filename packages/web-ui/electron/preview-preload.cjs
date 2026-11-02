const { contextBridge, ipcRenderer } = require('electron')
// Preview windows have no account, file, author or generic IPC capabilities.
contextBridge.exposeInMainWorld('arcadiaRemotePlay', {
  getBootConfig: async () => ({ schemaVersion: 1, backendOrigin: 'http://offline.invalid' }),
})

// Only project-bound team operations; no arbitrary source path or generic author IPC.
contextBridge.exposeInMainWorld('arcadiaAuthorPreview', {
  onChanged: listener => {
    const handler = (_event, change) => listener(change)
    ipcRenderer.on('author-preview:changed', handler)
    return () => ipcRenderer.removeListener('author-preview:changed', handler)
  },
  environment: (action, input) => ipcRenderer.invoke('author-preview:environment', action, input),
  teams: {
    list: () => ipcRenderer.invoke('author-preview:teams', 'list'),
    readDraft: () => ipcRenderer.invoke('author-preview:teams', 'draft-read'),
    writeDraft: draft => ipcRenderer.invoke('author-preview:teams', 'draft-write', draft),
    files: {
      save: input => ipcRenderer.invoke('author-preview:teams', 'save', input),
      remove: input => ipcRenderer.invoke('author-preview:teams', 'remove', input),
    },
  },
  returnToEditor: () => ipcRenderer.send('author-preview:return'),
})
