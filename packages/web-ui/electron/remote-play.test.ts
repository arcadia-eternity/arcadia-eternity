import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { normalizeRemoteBackend, createRemotePlayController } from './remote-play.ts'

test('remote backend selection accepts only explicit HTTP(S) origins', () => {
  assert.equal(normalizeRemoteBackend('https://example.com:443/'), 'https://example.com')
  for (const url of [
    'file:///tmp/test',
    'javascript:alert(1)',
    'https://user:pass@a.test',
    'https://a.test/path',
    'https://a.test/?backend=x',
    'https://a.test/#x',
  ])
    assert.throws(() => normalizeRemoteBackend(url))
})

test('remote partitions are disposable, frame-authorized and never share manager APIs', async t => {
  let nextId = 1
  const sessions = []
  class Window extends EventEmitter {
    constructor(options) {
      super()
      this.options = options
      this.webContents = new EventEmitter()
      Object.assign(this.webContents, {
        id: nextId++,
        mainFrame: { url: 'https://ui.test/' },
        setWindowOpenHandler: handler => (this.openHandler = handler),
      })
    }
    async loadURL(url) {
      this.url = url
    }
    destroy() {
      this.destroyed = true
      this.emit('closed')
    }
    close() {
      queueMicrotask(() => {
        if (this.blockUnload) {
          const event = {
            defaultPrevented: false,
            preventDefault() {
              this.defaultPrevented = true
            },
          }
          this.webContents.emit('will-prevent-unload', event)
          if (!event.defaultPrevented) return
        }
        this.destroy()
      })
    }
    isDestroyed() {
      return this.destroyed === true
    }
  }
  let current
  const session = {
    fromPartition(name, options) {
      const instance = new EventEmitter()
      Object.assign(instance, {
        name,
        options,
        setPermissionRequestHandler: h => (instance.request = h),
        setPermissionCheckHandler: h => (instance.check = h),
        webRequest: { onBeforeRequest: h => (instance.filter = h) },
        closeAllConnections: async () => {},
        clearStorageData: async () => {},
        clearCache: async () => {},
      })
      sessions.push(instance)
      return instance
    },
  }
  const controller = createRemotePlayController({
    BrowserWindow: Window,
    session,
    rendererUrl: 'https://ui.test/',
    preload: 'remote-preload.cjs',
    onWindow: w => (current = w),
    isManagementUrl: value => value.startsWith('http://127.0.0.1:8103'),
  })
  await controller.open('https://server-a.test')
  const first = current
  const event = { sender: first.webContents, senderFrame: first.webContents.mainFrame }
  assert.equal(controller.getBootConfig(event).backendOrigin, 'https://server-a.test')
  assert.throws(() => controller.getBootConfig({ ...event, senderFrame: { url: 'https://ui.test/' } }))
  assert.equal(first.options.webPreferences.sandbox, true)
  assert.equal(first.options.webPreferences.webSecurity, true)
  assert.equal(sessions[0].check(), false)
  assert.deepEqual(first.openHandler(), { action: 'deny' })
  sessions[0].filter({ url: 'http://127.0.0.1:8103/local-content/blocked' }, result =>
    assert.equal(result.cancel, true),
  )
  const { promise: closeRequested, resolve: signalClose } = Promise.withResolvers<void>()
  const close = first.close
  first.close = signalClose
  t.mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const blocked = assert.rejects(controller.open('https://server-b.test'), /保存或关闭/)
    await closeRequested
    t.mock.timers.tick(12_000)
    await blocked
    assert.equal(first.isDestroyed(), false)
    assert.equal(first.listenerCount('closed'), 1)
    assert.equal(first.webContents.listenerCount('will-prevent-unload'), 0)
  } finally {
    t.mock.timers.reset()
    first.close = close
  }
  first.blockUnload = true
  await assert.rejects(controller.open('https://server-b.test'), /保存或关闭/)
  assert.equal(first.isDestroyed(), false)
  assert.equal(sessions.length, 1)
  assert.equal(first.webContents.listenerCount('will-prevent-unload'), 0)
  first.webContents.on('will-prevent-unload', event => event.preventDefault())
  const replacement = controller.open('https://server-b.test')
  await assert.rejects(controller.open('https://server-c.test'), /正在打开远程窗口/)
  await replacement
  assert.equal(first.destroyed, true)
  assert.throws(() => controller.getBootConfig(event))
  assert.notEqual(sessions[0].name, sessions[1].name)
  assert.ok(!sessions[0].name.startsWith('persist:'))
  assert.throws(() => controller.getBootConfig({ sender: {}, senderFrame: {} }))
  await assert.rejects(controller.open('http://127.0.0.1:8103'))
  const stopped = assert.rejects(controller.open('https://server-c.test'), /正在退出/)
  assert.equal(await controller.prepareQuit(), true)
  await stopped
  assert.equal(sessions.length, 2)
  controller.destroy()
  class FailedWindow extends Window {
    async loadURL() {
      throw new Error('fixture load failed')
    }
  }
  const failed = createRemotePlayController({
    BrowserWindow: FailedWindow,
    session,
    rendererUrl: 'https://ui.test/',
    preload: 'remote-preload.cjs',
    onWindow: window => (current = window),
  })
  await assert.rejects(failed.open('https://unavailable.test'), /fixture load failed/)
  assert.equal(current.destroyed, true)
  assert.equal(failed.isTrusted({ sender: current.webContents, senderFrame: current.webContents.mainFrame }), false)
})

test('all legacy desktop handlers register through the shared manager guard', async () => {
  const source = await readFile(new URL('./main.ts', import.meta.url), 'utf8')
  assert.equal(source.match(/ipcMain\.handle\('desktop:/g)?.length ?? 0, 0)
  assert.match(source, /requireLocalBattleCaller\(event\)\s+return handler\(event, \.\.\.args\)/)
  const preload = await readFile(new URL('./remote-preload.cjs', import.meta.url), 'utf8')
  assert.ok(!preload.includes("'arcadiaDesktop'"))
  const channels = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(match => match[1])
  assert.deepEqual(channels.sort(), [
    'remote-play:close',
    'remote-play:get-boot-config',
    'remote-play:media-clear',
    'remote-play:media-has',
    'remote-play:media-read',
    'remote-play:media-usage',
    'remote-play:media-write',
    'remote-play:profile-draft',
    'remote-play:save-profile',
    'swf:bounds',
    'swf:create',
    'swf:dispose',
    'swf:send',
  ])
  assert.equal(preload.match(/ipcRenderer\.invoke/g).length, channels.length)
  assert.ok(!preload.includes('invoke: ipcRenderer'))
})

test('remote edits need owner confirmation, preserve newer drafts and block cancelled quit', async () => {
  let current,
    nextId = 100,
    action = 'cancel',
    finishSave
  const original = { revision: 1, data: { profile: { id: 'uid', name: 'Original' } } }
  const newer = { profile: { id: 'uid', name: 'Newer' } }
  const { promise: saveStarted, resolve: notifySave } = Promise.withResolvers<void>()
  class Window extends EventEmitter {
    constructor() {
      super()
      this.webContents = new EventEmitter()
      Object.assign(this.webContents, {
        id: nextId++,
        mainFrame: { url: 'https://ui.test/' },
        setWindowOpenHandler() {},
      })
    }
    async loadURL() {}
    isDestroyed() {
      return this.destroyed === true
    }
    close() {
      let prevented = false
      this.emit('close', {
        preventDefault() {
          prevented = true
        },
      })
      if (prevented) return
      if (this.blockUnload) {
        this.webContents.emit('will-prevent-unload', { defaultPrevented: false })
        return
      }
      this.destroy()
    }
    destroy() {
      this.destroyed = true
      this.emit('closed')
    }
  }
  const controller = createRemotePlayController({
    BrowserWindow: Window,
    rendererUrl: 'https://ui.test/',
    preload: 'fixture',
    onWindow: w => {
      current = w
    },
    session: {
      fromPartition() {
        return Object.assign(new EventEmitter(), {
          setPermissionRequestHandler() {},
          setPermissionCheckHandler() {},
          webRequest: { onBeforeRequest() {} },
          async closeAllConnections() {},
          async clearStorageData() {},
          async clearCache() {},
        })
      },
    },
    readProfile: async () => structuredClone(original),
    saveProfile: input =>
      new Promise(resolve => {
        finishSave = () => resolve({ ...original, revision: 2, data: input.data })
        if (input.data.profile.name === newer.profile.name) notifySave()
      }),
    confirmProfileClose: async () => action,
  })
  await controller.open('https://server.test')
  const event = { sender: current.webContents, senderFrame: current.webContents.mainFrame }
  assert.deepEqual(controller.getBootConfig(event).profile, original)
  assert.throws(() => controller.updateProfileDraft(event, { profile: { id: 'forged' } }))
  const edited = { profile: { id: 'uid', name: 'Edited' } }
  controller.updateProfileDraft(event, edited)
  assert.equal(await controller.prepareQuit(), false)
  await assert.rejects(controller.open('https://other.test'), /保存或关闭/)
  const saving = controller.saveProfile(event, { data: edited })
  controller.updateProfileDraft(event, newer)
  finishSave()
  await saving
  // A completed save of the older snapshot must not silently discard newer work.
  assert.equal(await controller.prepareQuit(), false)
  action = 'save'
  const previous = current
  previous.blockUnload = true
  const veto = assert.rejects(controller.open('https://other.test'), /保存或关闭/)
  await saveStarted
  finishSave()
  await veto
  assert.equal(previous.isDestroyed(), false)
  assert.equal(controller.getBootConfig(event).profile.data.profile.name, 'Newer')
  previous.blockUnload = false
  action = 'cancel'
  await controller.open('https://other.test')
  assert.equal(previous.isDestroyed(), true)
  controller.updateProfileDraft({ sender: current.webContents, senderFrame: current.webContents.mainFrame }, edited)
  action = 'discard'
  assert.equal(await controller.prepareQuit(), true)
  controller.destroy()
  assert.equal(current.isDestroyed(), true)
})
