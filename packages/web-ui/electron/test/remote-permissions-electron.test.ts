import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const main = fileURLToPath(new URL('../main.ts', import.meta.url))
const bundled = process.env.ARCADIA_DESKTOP_BUNDLED_RENDERER_TEST === '1'
const fixtureIndex = fileURLToPath(new URL('../../dist/index.html', import.meta.url))

test(
  'actual Electron denies all manager IPC from remote main frame and clears sessions on switch',
  { timeout: 120000, skip: process.env.ARCADIA_DESKTOP_GUI_TEST !== '1' },
  async () => {
    const { _electron, expect } = require('playwright/test')
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
      delete env.NODE_TEST_CONTEXT
      if (bundled) delete env.ARCADIA_ELECTRON_DEV_SERVER_URL
      app = await _electron.launch({ executablePath: require('electron'), args: [entry], env })
      const manager = await app.firstWindow()
      await manager.waitForURL(bundled ? 'arcadia-client://app/index.html' : origin + '/', {
        waitUntil: 'domcontentloaded',
      })
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
      const offline = await manager.evaluate(async () => {
        const api = window.arcadiaDesktop
        const before = await api.getLocalBattleStatus()
        const saved = await api.localEnvironment({
          action: 'apply',
          document: {
            schemaVersion: 2,
            id: 'offline-check',
            name: '离线环境',
            packages: {},
            sources: ['@arcadia-eternity/data-pack-base'],
            rules: { schemaVersion: 1 },
            requires: {},
          },
          expectedRevision: null,
          allowDownload: false,
        })
        return { before, saved }
      })
      assert.ifError(offline.saved.error)
      const { operationId } = offline.saved.result
      assert.equal(typeof operationId, 'string')
      let snapshot
      let operation
      await expect
        .poll(
          async () => {
            const response = await manager.evaluate(() =>
              window.arcadiaDesktop.localEnvironment({ action: 'snapshot' }),
            )
            assert.ifError(response.error)
            snapshot = response.result
            operation = snapshot.operations.find(item => item.id === operationId)
            return operation?.status
          },
          { timeout: 45000, message: 'Offline environment apply should reach a terminal state' },
        )
        .toMatch(/^(succeeded|failed|cancelled)$/)
      assert.equal(operation.status, 'succeeded', JSON.stringify(operation.error))
      const applied = snapshot.environments.find(item => item.document.id === 'offline-check')
      assert.equal(applied?.document.name, '离线环境')
      const removed = await manager.evaluate(
        expectedRevision =>
          window.arcadiaDesktop.localEnvironment({
            action: 'delete-draft',
            environmentId: 'offline-check',
            expectedRevision,
          }),
        applied.revision,
      )
      assert.ifError(removed.error)
      assert.equal(removed.result.deleted, true)
      assert.equal(offline.before.status, 'idle')
      assert.equal(
        await manager.evaluate(async () => (await window.arcadiaDesktop.getLocalBattleStatus()).status),
        'idle',
      )
      await assert.rejects(
        manager.evaluate(() => window.arcadiaDesktop.openServerWebsite({ url: 'file:///etc/passwd' })),
      )
      await app.evaluate(({ shell }) => {
        globalThis.testWebsiteUrls = []
        shell.openExternal = async url => {
          globalThis.testWebsiteUrls.push(url)
        }
      })
      await manager.evaluate(() => window.arcadiaDesktop.openServerWebsite({ url: 'https://player.example.com/' }))
      assert.deepEqual(await app.evaluate(() => globalThis.testWebsiteUrls), ['https://player.example.com'])
      const managementPort = await manager.evaluate(() => window.arcadiaDesktop.getLocalServerPort())
      const managementUrl = `http://127.0.0.1:${managementPort}/local-content/00000000-0000-0000-0000-000000000000/${'0'.repeat(64)}`
      assert.equal((await fetch(managementUrl)).status, 403)
      assert.equal(await manager.evaluate(async url => (await fetch(url)).status, managementUrl), 404)

      const [remote] = await Promise.all([
        app.waitForEvent('window'),
        manager.evaluate(() => window.arcadiaDesktop.openRemotePlay({ url: 'https://server-a.test' })),
      ])
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
      const firstBoot = await remote.evaluate(() => window.arcadiaRemotePlay.getBootConfig())
      assert.equal(firstBoot.backendOrigin, 'https://server-a.test')
      await remote.evaluate(() => localStorage.setItem('official-token', 'secret-a'))
      await remote.evaluate(() => {
        const iframe = document.createElement('iframe')
        iframe.src = '/child'
        document.body.append(iframe)
      })
      await remote.waitForFunction(() => {
        const document = window.document.querySelector('iframe')?.contentDocument
        return document?.readyState === 'complete' && new URL(document.URL).pathname === '/child'
      })
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
        return { channels, subframes: sender.mainFrame.frames.length, failures: results }
      }, remoteId)
      assert.equal(denied.subframes, 1)
      for (const channel of [
        'desktop:author',
        'desktop:local-environment',
        'desktop:local-server',
        'desktop:management-request',
        'desktop:install-npm-content-package',
        'desktop:read-local-runtime',
      ])
        assert.ok(denied.channels.includes(channel), `Missing manager IPC coverage for ${channel}`)
      assert.deepEqual(denied.failures, [])
      const [management] = await Promise.all([
        app.waitForEvent('window'),
        manager.evaluate(() =>
          window.arcadiaDesktop.openRemotePlay({ url: 'https://server-a.test', mode: 'management' }),
        ),
      ])
      await management.waitForLoadState('domcontentloaded')
      assert.equal(remote.isClosed(), false, 'opening management preserves the play window')
      assert.equal((await management.evaluate(() => window.arcadiaRemotePlay.getBootConfig())).autoConnect, false)
      assert.equal(await management.evaluate(() => typeof window.arcadiaDesktop), 'undefined')
      assert.equal(new URL(management.url()).searchParams.get('entry'), 'management')
      await management.close()
      await remote.locator('body').click()
      await remote.evaluate(() => {
        window.onbeforeunload = event => {
          event.preventDefault()
          event.returnValue = ''
        }
      })
      await assert.rejects(
        manager.evaluate(() => window.arcadiaDesktop.openRemotePlay({ url: 'https://server-b.test' })),
        /请先保存或关闭当前远程窗口/,
      )
      assert.equal(remote.isClosed(), false)
      await remote.evaluate(() => {
        window.onbeforeunload = null
      })
      const [second] = await Promise.all([
        app.waitForEvent('window'),
        remote.waitForEvent('close'),
        manager.evaluate(() => window.arcadiaDesktop.openRemotePlay({ url: 'https://server-b.test' })),
      ])
      assert.equal(remote.isClosed(), true)
      await second.waitForLoadState('domcontentloaded')
      const secondBoot = await second.evaluate(() => window.arcadiaRemotePlay.getBootConfig())
      assert.equal(secondBoot.backendOrigin, 'https://server-b.test')
      assert.notEqual(secondBoot.sessionId, firstBoot.sessionId)
      assert.equal(await second.evaluate(() => localStorage.getItem('official-token')), null)
      await Promise.all([
        second.waitForEvent('close'),
        second
          .evaluate(() => window.arcadiaRemotePlay.close())
          .catch(error => {
            if (!error.message.includes('closed')) throw error
          }),
      ])
      assert.equal(await manager.evaluate(() => typeof window.arcadiaDesktop.listContentProjects), 'function')
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
