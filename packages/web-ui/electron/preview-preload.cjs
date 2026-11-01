const { contextBridge } = require('electron')
// Preview windows have no account, file, author or generic IPC capabilities.
contextBridge.exposeInMainWorld('arcadiaRemotePlay', {
  getBootConfig: async () => ({ schemaVersion: 1, backendOrigin: 'http://offline.invalid' }),
})
