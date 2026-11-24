import { randomUUID } from 'node:crypto'
import type { BrowserWindow, BrowserWindowConstructorOptions, Session, session as electronSession } from 'electron'
import type { ProfileData, ProfileSnapshot } from '@arcadia-eternity/local-profile'
import { isTrustedDesktopRequest, type DesktopFrameEvent } from './local-battle-ipc.ts'

const closeTimeoutMs = 12_000

interface RemoteProfileSave {
  data?: ProfileData
  expectedRevision: number
}

interface RemotePlayOptions {
  BrowserWindow: new (options: BrowserWindowConstructorOptions) => BrowserWindow
  session: Pick<typeof electronSession, 'fromPartition'>
  rendererUrl: string
  preload: string
  onWindow?: (window: BrowserWindow) => void
  setupSession?: (session: Session) => void
  isManagementUrl?: (url: string) => boolean
  readProfile?: () => Promise<ProfileSnapshot | null>
  saveProfile?: (input: RemoteProfileSave) => Promise<ProfileSnapshot>
  validateProfile?: (value: ProfileData) => ProfileData
  confirmProfileClose?: (window: BrowserWindow) => Promise<'cancel' | 'save' | 'discard'>
}

interface RemoteWindowRecord {
  window: BrowserWindow
  config: {
    schemaVersion: 1
    mode: 'remote-play'
    backendOrigin: string
    sessionId: string
    autoConnect?: false
    profile?: ProfileSnapshot | null
  }
  dirty?: boolean
  closingApproved?: boolean
  closePending?: Promise<boolean>
  closeRequest?: Promise<boolean>
  draft?: ProfileData
  draftGeneration?: number
}

export function normalizeRemoteBackend(value: unknown) {
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
export function protectDesktopNavigation(window: BrowserWindow, rendererUrl: string) {
  const expected = new URL(rendererUrl)
  const allowed = (value: string) => {
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
  const guardNavigation = (event: Electron.Event, url: string) => {
    if (!allowed(url)) event.preventDefault()
  }
  window.webContents.on('will-navigate', guardNavigation)
  window.webContents.on('will-redirect', guardNavigation)
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
}: RemotePlayOptions) {
  let active: RemoteWindowRecord | undefined
  let openingPlay = false
  let quitPending: Promise<boolean> | undefined
  let destroyed = false
  const windows = new Map<number, RemoteWindowRecord>()
  const trustedRecord = (event: DesktopFrameEvent) => {
    const record = windows.get(event.sender?.id)
    if (!record || !isTrustedDesktopRequest(event, record.window.webContents, rendererUrl))
      throw new Error('Unauthorized remote frame')
    return record
  }
  const approveClose = (record: RemoteWindowRecord) => {
    if (!record.dirty || record.closingApproved) return Promise.resolve(true)
    if (record.closePending) return record.closePending
    record.closePending = (async () => {
      try {
        const action = await confirmProfileClose(record.window)
        if (action === 'cancel') return false
        if (action === 'save') {
          if (!record.config.profile) return false
          const generation = record.draftGeneration
          record.config.profile = await saveProfile({
            data: record.draft,
            expectedRevision: record.config.profile.revision,
          })
          if (generation !== record.draftGeneration) return false
          record.dirty = false
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
  const requestClose = (record: RemoteWindowRecord) => {
    const { window } = record
    record.closeRequest ??= approveClose(record)
      .then(async approved => {
        if (!approved) return false
        if (window.isDestroyed()) return true
        const contents = window.webContents
        const { promise, resolve } = Promise.withResolvers<boolean>()
        const closed = () => resolve(true)
        const preventClose = (event: Electron.Event) => {
          if (event.defaultPrevented) resolve(false)
        }
        const preventUnload = (event: Electron.Event) => {
          // Main's team-draft guard can override the renderer's veto after confirmation.
          if (!event.defaultPrevented) resolve(false)
        }
        window.on('close', preventClose)
        window.once('closed', closed)
        contents.on('will-prevent-unload', preventUnload)
        const timeout = setTimeout(() => resolve(false), closeTimeoutMs)
        try {
          window.close()
          const didClose = await promise
          if (!didClose) record.closingApproved = false
          return didClose
        } finally {
          clearTimeout(timeout)
          if (!window.isDestroyed()) {
            window.off('close', preventClose)
            window.off('closed', closed)
            contents.off('will-prevent-unload', preventUnload)
          }
        }
      })
      .finally(() => {
        record.closeRequest = undefined
      })
    return record.closeRequest
  }
  const requireOpenController = () => {
    if (quitPending || destroyed) throw new Error('应用正在退出')
  }
  const openWindow = async (backendOrigin: string, mode: 'play' | 'management') => {
    requireOpenController()
    const profile = mode === 'play' ? await readProfile() : undefined
    requireOpenController()
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
    const record: RemoteWindowRecord = {
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
    if (mode === 'play') active = record
    protectDesktopNavigation(window, rendererUrl)
    window.on('close', event => {
      if (!record.dirty || record.closingApproved) return
      event.preventDefault()
      void requestClose(record).catch(error => console.error('远程窗口关闭失败', error))
    })
    window.on('closed', () => {
      windows.delete(contentsId)
      if (active === record) active = undefined
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
  }
  return {
    prepareQuit() {
      quitPending ??= (async () => {
        for (const record of windows.values()) if (!(await approveClose(record))) return false
        return true
      })().then(approved => {
        if (!approved) quitPending = undefined
        return approved
      })
      return quitPending
    },
    isTrusted(event: DesktopFrameEvent) {
      try {
        trustedRecord(event)
        return true
      } catch {
        return false
      }
    },
    getBootConfig(event: DesktopFrameEvent) {
      return trustedRecord(event).config
    },
    updateProfileDraft(event: DesktopFrameEvent, input: ProfileData | null | undefined) {
      const record = trustedRecord(event)
      if (!record.config.profile || input?.profile?.id !== record.config.profile.data.profile.id)
        throw new Error('Invalid profile identity')
      record.draftGeneration = (record.draftGeneration ?? 0) + 1
      record.draft = validateProfile(input)
      record.dirty = JSON.stringify(record.draft) !== JSON.stringify(record.config.profile.data)
    },
    async saveProfile(event: DesktopFrameEvent, input: { data?: ProfileData } | null | undefined) {
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
    close(event: DesktopFrameEvent) {
      trustedRecord(event).window.close()
    },
    async open(value: unknown, { mode = 'play' }: { mode?: 'play' | 'management' } = {}) {
      if (!['play', 'management'].includes(mode)) throw new Error('Invalid remote window mode')
      const backendOrigin = normalizeRemoteBackend(value)
      if (isManagementUrl(backendOrigin)) throw new Error('Local management endpoint is not a game server')
      requireOpenController()
      if (mode === 'management') return openWindow(backendOrigin, mode)
      if (openingPlay) throw new Error('正在打开远程窗口')
      openingPlay = true
      try {
        if (active && !(await requestClose(active))) throw new Error('请先保存或关闭当前远程窗口')
        // Do not reuse the manager partition or even a previous visit to the same server.
        return await openWindow(backendOrigin, mode)
      } finally {
        openingPlay = false
      }
    },
    destroy() {
      destroyed = true
      for (const record of windows.values()) record.window.destroy()
    },
  }
}
