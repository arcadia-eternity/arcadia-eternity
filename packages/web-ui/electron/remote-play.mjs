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
  readProfile = async () => null,
  saveProfile = async () => {
    throw new Error('Profile saving unavailable')
  },
  validateProfile = value => value,
  confirmProfileClose = async () => 'cancel',
}) {
  let active
  const windows = new Map()
  const trustedRecord = event => {
    const record = windows.get(event.sender?.id)
    if (!record || !isTrustedDesktopRequest(event, record.window.webContents, rendererUrl))
      throw new Error('Unauthorized remote frame')
    return record
  }
  const approveClose = record => {
    if (!record.dirty || record.closingApproved) return Promise.resolve(true)
    if (record.closePending) return record.closePending
    record.closePending = (async () => {
      try {
        const action = await confirmProfileClose(record.window)
        if (action === 'cancel') return false
        if (action === 'save') {
          const generation = record.draftGeneration
          record.config.profile = await saveProfile({
            data: record.draft,
            expectedRevision: record.config.profile.revision,
          })
          if (generation !== record.draftGeneration) return false
        }
        record.closingApproved = true
        return true
      } catch {
        return false
      } finally {
        record.closePending = undefined
      }
    })()
    return record.closePending
  }
  return {
    async prepareQuit() {
      for (const record of windows.values()) if (!(await approveClose(record))) return false
      return true
    },
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
    updateProfileDraft(event, input) {
      const record = trustedRecord(event)
      if (!record.config.profile || input?.profile?.id !== record.config.profile.data.profile.id)
        throw new Error('Invalid profile identity')
      record.draftGeneration = (record.draftGeneration ?? 0) + 1
      record.draft = validateProfile(input)
      record.dirty = JSON.stringify(record.draft) !== JSON.stringify(record.config.profile.data)
    },
    async saveProfile(event, input) {
      const record = trustedRecord(event)
      const original = record.config.profile
      if (!original || input?.data?.profile?.id !== original.data.profile.id)
        throw new Error('Remote profile identity cannot change')
      const draftGeneration = record.draftGeneration
      const result = await saveProfile({ ...input, expectedRevision: original.revision })
      record.config.profile = result
      record.dirty =
        record.draftGeneration !== draftGeneration ||
        JSON.stringify(record.draft ?? result.data) !== JSON.stringify(result.data)
      return result
    },
    close(event) {
      trustedRecord(event).window.close()
    },
    async open(value, { mode = 'play' } = {}) {
      if (!['play', 'management'].includes(mode)) throw new Error('Invalid remote window mode')
      const backendOrigin = normalizeRemoteBackend(value)
      if (isManagementUrl(backendOrigin)) throw new Error('Local management endpoint is not a game server')
      // Do not reuse the manager partition, or even a previous visit to the same server.
      if (mode === 'play' && active) {
        const previous = active
        previous.close()
        if (!previous.isDestroyed()) throw new Error('请先保存或关闭当前远程窗口')
      }
      const profile = mode === 'play' ? await readProfile() : undefined
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
      const record = {
        window,
        config: {
          schemaVersion: 1,
          mode: 'remote-play',
          backendOrigin,
          sessionId,
          ...(mode === 'play' ? { profile } : {}),
          ...(mode === 'management' ? { autoConnect: false } : {}),
        },
      }
      const contentsId = window.webContents.id
      windows.set(contentsId, record)
      if (mode === 'play') active = window
      protectDesktopNavigation(window, rendererUrl)
      window.on('close', event => {
        if (!record.dirty || record.closingApproved) return
        event.preventDefault()
        void approveClose(record).then(approved => {
          if (approved && !window.isDestroyed()) window.close()
        })
      })
      window.on('closed', () => {
        windows.delete(contentsId)
        if (active === window) active = undefined
        void isolatedSession.closeAllConnections()
        void isolatedSession.clearStorageData()
        void isolatedSession.clearCache()
      })
      onWindow?.(window)
      try {
        const entry = new URL(rendererUrl)
        entry.searchParams.set('entry', mode === 'management' ? 'management' : 'lobby')
        await window.loadURL(entry.href)
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
