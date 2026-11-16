import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { normalizeRemoteBackend, createRemotePlayController } from './remote-play.mjs'

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

test('remote partitions are disposable, frame-authorized and never share manager APIs', async () => {
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
      this.destroy()
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
  await controller.open('https://server-b.test')
  assert.equal(first.destroyed, true)
  assert.throws(() => controller.getBootConfig(event))
  assert.notEqual(sessions[0].name, sessions[1].name)
  assert.ok(!sessions[0].name.startsWith('persist:'))
  assert.throws(() => controller.getBootConfig({ sender: {}, senderFrame: {} }))
  await assert.rejects(controller.open('http://127.0.0.1:8103'))
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
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.equal(source.match(/ipcMain\.handle\('desktop:/g)?.length ?? 0, 0)
  assert.match(source, /requireLocalBattleCaller\(event\)\s+return handler\(event, \.\.\.args\)/)
  const preload = await readFile(new URL('./remote-preload.cjs', import.meta.url), 'utf8')
  assert.ok(!preload.includes("'arcadiaDesktop'"))
  assert.equal(preload.match(/ipcRenderer.invoke/g).length, 8)
  assert.ok(!preload.includes('invoke: ipcRenderer'))
})

test('remote edits need owner confirmation, preserve newer drafts and block cancelled quit', async () => {
  let current,
    nextId = 100,
    action = 'cancel',
    finishSave
  const original = { revision: 1, data: { profile: { id: 'uid', name: 'Original' } }, digest: 'fixture' }
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
      if (!prevented) this.destroy()
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
  controller.updateProfileDraft(event, { profile: { id: 'uid', name: 'Newer' } })
  finishSave()
  await saving
  // A completed save of the older snapshot must not silently discard newer work.
  assert.equal(await controller.prepareQuit(), false)
  action = 'discard'
  assert.equal(await controller.prepareQuit(), true)
  controller.destroy()
  assert.equal(current.isDestroyed(), true)
})
