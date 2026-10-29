import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const main = fileURLToPath(new URL('../main.mjs', import.meta.url))
const bundled = process.env.ARCADIA_DESKTOP_BUNDLED_RENDERER_TEST === '1'
const fixtureIndex = fileURLToPath(new URL('../../dist/index.html', import.meta.url))

test(
  'actual Electron denies all manager IPC from remote main frame and clears sessions on switch',
  { timeout: 120000, skip: process.env.ARCADIA_DESKTOP_GUI_TEST !== '1' },
  async () => {
    const { _electron } = require('playwright/test')
    const directory = await mkdtemp(join(tmpdir(), 'arcadia-permissions-'))
    const server = createServer((_req, res) => {
      if (_req.url === '/cors-echo') {
        res.setHeader('Access-Control-Allow-Origin', 'arcadia-client://app')
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ origin: _req.headers.origin }))
        return
      }
      res.setHeader('Content-Type', 'text/html')
      res.end('<html><body>Bundled UI test fixture</body></html>')
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    let app, originalIndex
    if (bundled) {
      originalIndex = await readFile(fixtureIndex).catch(() => null)
      await mkdir(fileURLToPath(new URL('../../dist/', import.meta.url)), { recursive: true })
      await writeFile(fixtureIndex, '<html><body>Bundled UI test fixture</body></html>')
    }
    try {
      const entry = join(directory, 'entry.mjs')
      await writeFile(
        entry,
        `import {app} from 'electron';app.setPath('userData',${JSON.stringify(join(directory, 'data'))});await import(${JSON.stringify(pathToFileURL(main).href)});`,
      )
      const env = { ...process.env, ARCADIA_ELECTRON_DEV_SERVER_URL: origin }
      delete env.ELECTRON_RUN_AS_NODE
      if (bundled) delete env.ARCADIA_ELECTRON_DEV_SERVER_URL
      app = await _electron.launch({ executablePath: require('electron'), args: [entry], env })
      const manager = await app.firstWindow()
      await manager.waitForLoadState('domcontentloaded')
      if (bundled) {
        assert.equal(manager.url(), 'arcadia-client://app/index.html')
        assert.equal(await manager.evaluate(() => location.origin), 'arcadia-client://app')
        assert.equal(await manager.evaluate(async () => (await fetch('/%2f..%2fpackage.json')).status), 403)
        assert.equal(await manager.evaluate(async () => (await fetch('/index.html', { method: 'POST' })).status), 403)
        assert.deepEqual(await manager.evaluate(async url => (await fetch(url)).json(), origin + '/cors-echo'), {
          origin: 'arcadia-client://app',
        })
      }
      assert.equal(await manager.evaluate(() => typeof window.arcadiaDesktop.openRemotePlay), 'function')
      const managementPort = await manager.evaluate(() => window.arcadiaDesktop.getLocalServerPort())
      const managementUrl = `http://127.0.0.1:${managementPort}/packs/workspace/index.json`
      assert.equal((await fetch(managementUrl)).status, 403)
      assert.equal(await manager.evaluate(async url => (await fetch(url)).status, managementUrl), 200)

      await manager.evaluate(() => window.arcadiaDesktop.openRemotePlay({ url: 'https://server-a.test' }))
      const remote = app.windows().find(page => page !== manager)
      await remote.waitForLoadState('domcontentloaded')
      assert.equal(await remote.evaluate(() => typeof window.arcadiaDesktop), 'undefined')
      assert.deepEqual(await remote.evaluate(() => Object.keys(window.arcadiaSwf).sort()), [
        'ackFrame',
        'bounds',
        'create',
        'dispose',
        'onEvent',
        'onFrame',
        'send',
      ])
      assert.equal(
        (await remote.evaluate(() => window.arcadiaRemotePlay.getBootConfig())).backendOrigin,
        'https://server-a.test',
      )
      await remote.evaluate(() => localStorage.setItem('official-token', 'secret-a'))
      await remote.evaluate(() => {
        const iframe = document.createElement('iframe')
        iframe.src = '/child'
        document.body.append(iframe)
      })
      await remote.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.readyState === 'complete')
      const remoteId = await (await app.browserWindow(remote)).evaluate(window => window.id)
      const denied = await app.evaluate(async ({ ipcMain, BrowserWindow }, remoteId) => {
        const remoteWindow = BrowserWindow.fromId(remoteId)
        const sender = remoteWindow.webContents
        const channels = [...ipcMain._invokeHandlers.keys()].filter(name => name.startsWith('desktop:'))
        const results = []
        const frames = [sender.mainFrame, ...sender.mainFrame.frames]
        for (const channel of channels)
          for (const senderFrame of frames) {
            try {
              await ipcMain._invokeHandlers.get(channel)({ sender, senderFrame }, {})
              results.push(channel)
            } catch (error) {
              if (!error.message.includes('Unauthorized desktop frame')) results.push(`${channel}: ${error.message}`)
            }
          }
        for (const senderFrame of sender.mainFrame.frames) {
          try {
            await ipcMain._invokeHandlers.get('swf:create')({ sender, senderFrame }, { instance: 'test-child' })
            results.push('subframe SWF create')
          } catch (error) {
            if (!error.message.includes('Untrusted SWF controller')) results.push(error.message)
          }
        }
        return { count: channels.length, failures: results }
      }, remoteId)
      assert.ok(denied.count > 40)
      assert.deepEqual(denied.failures, [])
      await manager.evaluate(() => window.arcadiaDesktop.openRemotePlay({ url: 'https://server-b.test' }))
      const second = app.windows().find(page => page !== manager)
      await second.waitForLoadState('domcontentloaded')
      assert.equal(await second.evaluate(() => localStorage.getItem('official-token')), null)
      assert.equal(remote.isClosed(), true)
      await second
        .evaluate(() => window.arcadiaRemotePlay.close())
        .catch(error => {
          if (!error.message.includes('closed')) throw error
        })
      assert.equal(await manager.evaluate(() => typeof window.arcadiaDesktop.readWorkWorkspace), 'function')
    } finally {
      if (app) await app.close()
      if (bundled) {
        if (originalIndex) await writeFile(fixtureIndex, originalIndex)
        else await rm(fixtureIndex, { force: true })
      }
      await new Promise(resolve => server.close(resolve))
      await rm(directory, { recursive: true, force: true })
    }
  },
)
