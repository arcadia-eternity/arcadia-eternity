import { BrowserWindow, session, webContents, protocol } from 'electron'
import { createFrameBroker, validFrameSize } from './swf-frame-broker.mjs'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PLAYER_URL, validInstance, validBounds, validCommand, validEvent, rateGate } from './swf-policy.mjs'

protocol.registerSchemesAsPrivileged([
  { scheme: 'arcadia-swf', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

/** Call after app.whenReady(). Each owner/instance gets an ephemeral session and hidden offscreen renderer. */
export function createSwfHost({
  isTrustedController,
  getControllerWindow = event => BrowserWindow.fromWebContents(event.sender),
  playerPath = fileURLToPath(new URL('../dist/swf-player.html', import.meta.url)),
  runtimeDirectory = fileURLToPath(new URL('../dist/ruffle/', import.meta.url)),
  watchdogMs = 8000,
}) {
  const records = new Map(),
    registered = []
  let ipc
  const key = (id, instance) => `${id}:${instance}`
  function controller(event) {
    if (!isTrustedController(event) || event.senderFrame !== event.sender.mainFrame)
      throw new Error('Untrusted SWF controller')
    const owner = getControllerWindow(event)
    if (!owner || owner.isDestroyed() || owner.webContents !== event.sender) throw new Error('SWF owner unavailable')
    return owner
  }
  function emit(r, value) {
    if (!r.owner.isDestroyed() && !r.ownerContents.isDestroyed()) r.ownerContents.send('swf:event', value)
  }
  function dispose(r, reason) {
    if (r.dead) return
    r.dead = true
    r.owner.removeListener('closed', r.ownerClosed)
    r.ownerContents.removeListener('did-start-navigation', r.ownerNavigation)
    r.ownerContents.removeListener('render-process-gone', r.ownerGone)
    r.ownerContents.removeListener('destroyed', r.ownerGone)
    clearInterval(r.timer)
    r.frames.dispose()
    r.view.webContents.removeListener('paint', r.paint)
    records.delete(r.key)
    const wc = r.view.webContents
    // Window/session isolation alone does not prove a unique process. Never crash a shared UI process.
    if (!wc.isDestroyed()) {
      const pid = wc.getOSProcessId()
      const shared = webContents
        .getAllWebContents()
        .some(other => other.id !== wc.id && !other.isDestroyed() && pid > 0 && other.getOSProcessId() === pid)
      if (reason && !shared && pid > 0) wc.forcefullyCrashRenderer()
      r.view.destroy()
    }
    r.session.protocol.unhandle('arcadia-swf')
    r.session.webRequest.onBeforeRequest(null)
    void r.session.closeAllConnections().catch(() => {})
    void r.session.clearStorageData().catch(() => {})
    if (reason)
      emit(r, { v: 1, instance: r.instance, task: r.task || 1, seq: ++r.eventSeq, type: 'error', message: reason })
  }
  function applyBounds(r, input) {
    const width = Math.round(input.width),
      height = Math.round(input.height)
    if (!validFrameSize(width, height)) throw new Error('Invalid SWF frame size')
    r.frames.resize(width, height)
    r.view.setContentSize(width, height)
    r.view.webContents.invalidate()
  }
  function owned(event, instance) {
    const owner = controller(event)
    const r = records.get(key(owner.webContents.id, instance))
    if (!r || r.dead) throw new Error('Unknown SWF instance')
    return r
  }
  async function create(event, input) {
    const owner = controller(event)
    if (!validInstance(input?.instance)) throw new Error('Invalid SWF instance')
    const id = key(owner.webContents.id, input.instance)
    if (records.has(id) || [...records.values()].filter(r => r.owner === owner).length >= 2)
      throw new Error('SWF instance limit')
    const isolated = session.fromPartition(`swf-${randomUUID()}`, { cache: false })
    isolated.setPermissionCheckHandler(() => false)
    isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    isolated.setDevicePermissionHandler(() => false)
    isolated.setDisplayMediaRequestHandler((_request, callback) => callback({}))
    isolated.on('will-download', event => event.preventDefault())
    isolated.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: details.url !== PLAYER_URL && !details.url.startsWith('blob:') }),
    )
    // Exact singleton resource: no file paths, runtime proxies, redirects, or remote URLs.
    isolated.protocol.handle('arcadia-swf', async request => {
      if (request.url !== PLAYER_URL || request.method !== 'GET') return new Response(null, { status: 403 })
      return new Response(await readFile(playerPath), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      })
    })
    const view = new BrowserWindow({
      width: 1,
      height: 1,
      show: false,
      transparent: true,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        session: isolated,
        offscreen: { useSharedTexture: false, deviceScaleFactor: 1 },
        // Loading/callback readiness must progress while the DOM owner is hidden by a modal or fade.
        backgroundThrottling: false,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        preload: fileURLToPath(new URL('./swf-player-preload.cjs', import.meta.url)),
      },
    })
    view.setBackgroundColor('#00000000')
    const r = {
      key: id,
      instance: input.instance,
      owner,
      ownerContents: owner.webContents,
      view,
      session: isolated,
      task: 0,
      seq: 0,
      eventSeq: 0,
      heartbeat: Date.now(),
      commands: rateGate(120),
      events: rateGate(60),
      dead: false,
    }
    r.frames = createFrameBroker({
      instance: r.instance,
      send: frame => {
        if (!r.dead && !r.ownerContents.isDestroyed()) r.ownerContents.send('swf:frame', frame)
      },
      fail: message => dispose(r, message),
    })
    r.paint = (_event, dirty, image) => r.frames.paint(dirty, image)
    view.webContents.on('paint', r.paint)
    view.webContents.setFrameRate(24)
    records.set(id, r)
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    view.webContents.on('will-navigate', event => event.preventDefault())
    view.webContents.on('will-frame-navigate', event => event.preventDefault())
    view.webContents.on('will-attach-webview', event => event.preventDefault())
    view.webContents.on('render-process-gone', () => dispose(r, 'SWF player process exited'))
    view.webContents.on('unresponsive', () => dispose(r, 'SWF player unresponsive'))
    view.once('closed', () => dispose(r, 'SWF player closed'))
    r.ownerClosed = () => dispose(r)
    // Views belong to the controller document, not just its BrowserWindow. A reload
    // must release the old document's slots before the next one creates its players.
    r.ownerNavigation = details => {
      if (details.isMainFrame && !details.isSameDocument) dispose(r)
    }
    r.ownerGone = () => dispose(r)
    owner.once('closed', r.ownerClosed)
    r.ownerContents.on('did-start-navigation', r.ownerNavigation)
    r.ownerContents.once('render-process-gone', r.ownerGone)
    r.ownerContents.once('destroyed', r.ownerGone)
    r.timer = setInterval(
      () => {
        if (Date.now() - r.heartbeat > watchdogMs) dispose(r, 'SWF player watchdog timeout')
      },
      Math.min(watchdogMs, 1000),
    )
    try {
      await view.webContents.loadURL(PLAYER_URL)
    } catch (error) {
      dispose(r)
      throw error
    }
    if (r.dead) throw new Error('SWF player disposed during initialization')
    // Report actual ownership for QA; do not claim one view implies a unique process.
    return {
      instance: r.instance,
      processId: view.webContents.getOSProcessId(),
      ownerProcessId: owner.webContents.getOSProcessId(),
    }
  }
  function registerIpc(ipcMain) {
    if (ipc) throw new Error('SWF IPC already registered')
    ipc = ipcMain
    const handle = (channel, fn) => {
      ipc.handle(channel, fn)
      registered.push(channel)
    }
    handle('swf:create', create)
    handle('swf:send', async (event, command) => {
      const r = owned(event, command?.instance)
      if (
        !r.commands() ||
        !validCommand(command) ||
        command.task < r.task ||
        (command.task === r.task && command.seq <= r.seq) ||
        (command.task > r.task && command.type !== 'load')
      )
        throw new Error('Invalid SWF command')
      if (command.task > r.task) r.eventSeq = 0
      r.task = command.task
      r.seq = command.seq
      if (command.type === 'dispose') {
        dispose(r)
        return
      }
      if (command.type === 'load') {
        r.frames.reset(command.task)
        // Runtime code comes only from the installed distribution, never from the caller.
        const names = (await readdir(runtimeDirectory)).filter(name =>
          /^(ruffle\.js|core\.ruffle\.[a-f0-9]+\.js|[a-f0-9]+\.wasm)$/.test(name),
        )
        if (!names.includes('ruffle.js') || names.length > 8) throw new Error('Bundled Ruffle runtime unavailable')
        const runtime = Object.fromEntries(
          await Promise.all(
            names.map(async name => {
              const bytes = await readFile(new URL(name, pathToFileURL(runtimeDirectory + '/')))
              return [name, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)]
            }),
          ),
        )
        command = { ...command, runtime }
        if (!validCommand(command)) throw new Error('Bundled Ruffle runtime exceeds limits')
      }
      if (!r.dead && r.task === command.task && r.seq === command.seq)
        r.view.webContents.send('swf:player-command', command)
    })
    handle('swf:bounds', (event, input) => {
      const r = owned(event, input?.instance)
      if (!r.commands() || !validBounds(input)) throw new Error('Invalid SWF bounds')
      applyBounds(r, input)
    })
    handle('swf:dispose', (event, input) => dispose(owned(event, input?.instance)))
    ipc.on('swf:frame-ack', frameAck)
    ipc.on('swf:heartbeat', heartbeat)
    ipc.on('swf:player-event', playerEvent)
  }
  function frameAck(event, value) {
    // Fire-and-forget IPC must never throw into the main event loop.
    try {
      if (!Number.isSafeInteger(value?.task) || !Number.isSafeInteger(value?.frame)) return
      owned(event, value?.instance).frames.ack(value)
    } catch {}
  }
  function playerRecord(event) {
    return [...records.values()].find(
      r =>
        !r.dead &&
        r.view.webContents === event.sender &&
        event.senderFrame === event.sender.mainFrame &&
        event.senderFrame.url === PLAYER_URL,
    )
  }
  function heartbeat(event) {
    const r = playerRecord(event)
    if (r) r.heartbeat = Date.now()
  }
  function playerEvent(event, value) {
    const r = playerRecord(event)
    if (!r) return
    if (!r.events()) {
      dispose(r, 'SWF callback limit exceeded')
      return
    }
    if (!validEvent(value) || value.instance !== r.instance || value.task !== r.task || value.seq <= r.eventSeq) return
    r.eventSeq = value.seq
    if (value.type === 'ready') {
      r.frames.ready()
      r.view.webContents.invalidate()
    }
    emit(r, value)
  }
  return {
    registerIpc,
    dispose() {
      for (const r of [...records.values()]) dispose(r)
      if (ipc) {
        for (const c of registered) ipc.removeHandler(c)
        ipc.removeListener('swf:frame-ack', frameAck)
        ipc.removeListener('swf:heartbeat', heartbeat)
        ipc.removeListener('swf:player-event', playerEvent)
      }
    },
    inspect() {
      return [...records.values()].map(r => ({
        instance: r.instance,
        processId: r.view.webContents.getOSProcessId(),
        ownerProcessId: r.owner.webContents.getOSProcessId(),
        partition: r.session.getStoragePath(),
        bounds: r.view.getBounds(),
        visible: r.view.isVisible(),
        offscreen: r.view.webContents.isOffscreen(),
        frames: r.frames.inspect(),
        zoomFactor: r.view.webContents.getZoomFactor(),
        sandboxed: r.view.webContents.getLastWebPreferences().sandbox,
      }))
    },
  }
}
