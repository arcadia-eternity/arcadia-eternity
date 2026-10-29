import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const main = fileURLToPath(new URL('../main.mjs', import.meta.url))

test(
  'actual Electron denies all manager IPC from remote main frame and clears sessions on switch',
  { timeout: 120000, skip: process.env.ARCADIA_DESKTOP_GUI_TEST !== '1' },
  async () => {
    const { _electron } = require('playwright/test')
    const directory = await mkdtemp(join(tmpdir(), 'arcadia-permissions-'))
    const server = createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.end('<html><body>Bundled UI test fixture</body></html>')
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    let app
    try {
      const entry = join(directory, 'entry.mjs')
      await writeFile(
        entry,
        `import {app} from 'electron';app.setPath('userData',${JSON.stringify(join(directory, 'data'))});await import(${JSON.stringify(pathToFileURL(main).href)});`,
      )
      const env = { ...process.env, ARCADIA_ELECTRON_DEV_SERVER_URL: origin }
      delete env.ELECTRON_RUN_AS_NODE
      app = await _electron.launch({ executablePath: require('electron'), args: [entry], env })
      const manager = await app.firstWindow()
      assert.equal(await manager.evaluate(() => typeof window.arcadiaDesktop.openRemotePlay), 'function')
      const managementPort = await manager.evaluate(() => window.arcadiaDesktop.getLocalServerPort())
      const managementUrl = `http://127.0.0.1:${managementPort}/packs/workspace/index.json`
      assert.equal((await fetch(managementUrl)).status, 403)
      assert.equal(await manager.evaluate(async url => (await fetch(url)).status, managementUrl), 200)

      await manager.evaluate(() => window.arcadiaDesktop.openRemotePlay({ url: 'https://server-a.test' }))
      const remote = app.windows().find(page => page !== manager)
      await remote.waitForLoadState('domcontentloaded')
      assert.equal(await remote.evaluate(() => typeof window.arcadiaDesktop), 'undefined')
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
      await new Promise(resolve => server.close(resolve))
      await rm(directory, { recursive: true, force: true })
    }
  },
)
