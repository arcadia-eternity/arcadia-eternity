import { randomUUID } from 'node:crypto'
import { isTrustedDesktopRequest } from './local-battle-ipc.mjs'

export function normalizeRemoteBackend(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid server URL')
  const url = new URL(value)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Server must be an HTTP(S) origin')
  return url.origin
}

/** Keep every desktop renderer on the bundled application document. Hash routes remain local. */
export function protectDesktopNavigation(window, rendererUrl) {
  const expected = new URL(rendererUrl)
  const allowed = value => {
    try {
      const url = new URL(value)
      return (
        !url.username &&
        !url.password &&
        url.protocol === expected.protocol &&
        url.host === expected.host &&
        (expected.protocol !== 'file:' || url.pathname === expected.pathname)
      )
    } catch {
      return false
    }
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  for (const name of ['will-navigate', 'will-redirect']) {
    window.webContents.on(name, (event, url) => {
      if (!allowed(url)) event.preventDefault()
    })
  }
  window.webContents.on('will-attach-webview', event => event.preventDefault())
}

export function createRemotePlayController({
  BrowserWindow,
  session,
  rendererUrl,
  preload,
  onWindow,
  setupSession,
  isManagementUrl = () => false,
}) {
  let active
  const windows = new Map()
  const trustedRecord = event => {
    const record = windows.get(event.sender?.id)
    if (!record || !isTrustedDesktopRequest(event, record.window.webContents, rendererUrl))
      throw new Error('Unauthorized remote frame')
    return record
  }
  return {
    isTrusted(event) {
      try {
        trustedRecord(event)
        return true
      } catch {
        return false
      }
    },
    getBootConfig(event) {
      return trustedRecord(event).config
    },
    close(event) {
      trustedRecord(event).window.close()
    },
    async open(value) {
      const backendOrigin = normalizeRemoteBackend(value)
      if (isManagementUrl(backendOrigin)) throw new Error('Local management endpoint is not a game server')
      // Do not reuse the manager partition, or even a previous visit to the same server.
      active?.destroy()
      const sessionId = randomUUID()
      const isolatedSession = session.fromPartition(`remote-play-${sessionId}`, { cache: false })
      setupSession?.(isolatedSession)
      isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      isolatedSession.setPermissionCheckHandler(() => false)
      isolatedSession.webRequest.onBeforeRequest((details, callback) => {
        let cancel = isManagementUrl(details.url)
        try {
          const url = new URL(details.url)
          if (url.protocol === 'file:') {
            const root = new URL('.', rendererUrl)
            cancel ||= url.host !== root.host || !url.pathname.startsWith(root.pathname)
          }
          if (!['arcadia-client:', 'file:', 'http:', 'https:', 'ws:', 'wss:', 'data:', 'blob:'].includes(url.protocol))
            cancel = true
        } catch {
          cancel = true
        }
        callback({ cancel })
      })
      isolatedSession.on('will-download', event => event.preventDefault())
      const window = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 700,
        webPreferences: {
          preload,
          session: isolatedSession,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          webviewTag: false,
          navigateOnDragDrop: false,
        },
      })
      const record = { window, config: { schemaVersion: 1, mode: 'remote-play', backendOrigin, sessionId } }
      const contentsId = window.webContents.id
      windows.set(contentsId, record)
      active = window
      protectDesktopNavigation(window, rendererUrl)
      window.on('closed', () => {
        windows.delete(contentsId)
        if (active === window) active = undefined
        void isolatedSession.closeAllConnections()
        void isolatedSession.clearStorageData()
        void isolatedSession.clearCache()
      })
      onWindow?.(window)
      try {
        await window.loadURL(rendererUrl)
      } catch (error) {
        if (!window.isDestroyed()) window.destroy()
        throw error
      }
      return { backendOrigin }
    },
    destroy() {
      for (const record of windows.values()) record.window.destroy()
    },
  }
}
