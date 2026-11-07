import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const frontend = fileURLToPath(new URL('../../', import.meta.url))
const swf = process.env.ARCADIA_DESKTOP_SWF_GAMEPLAY === '1'
const originalUrls = [1, 2].map(number => `https://seer2-pet-resource.yuuinih.com/public/fight/${number}.swf`)

// Explicit production-renderer acceptance. Build the actual app first, then run:
// ARCADIA_DESKTOP_GAMEPLAY_TEST=1 node --import tsx --test electron/test/remote-gameplay-electron.test.mjs
// No Vite source imports, debug-store hooks, network interception or temporary renderer fixtures.
test(
  swf
    ? 'clean bundled desktop clients play original isolated SWFs with DOM canvas composition through battle, refresh, result and disposal'
    : 'clean bundled desktop clients play on two same-ID custom servers without sharing native rights or credentials',
  {
    skip: process.env.ARCADIA_DESKTOP_GAMEPLAY_TEST !== '1',
    timeout: swf ? 600000 : 360000,
  },
  async t => {
    const { _electron, expect: baseExpect } = require('playwright/test')
    const expect = baseExpect.configure({ timeout: 30000 })
    const { createSingleProcessApp } = await import('../../../server/src/standalone/app.ts')
    const { createNpmFixture } = await import('../../../server/test/fixtures/npm.ts')
    await readFile(join(frontend, 'dist/index.html'))
    const directory = await mkdtemp(join(tmpdir(), 'arcadia-desktop-gameplay-'))
    const evidence = join(frontend, 'native-content-qa.local', swf ? 'remote-gameplay-canvas' : 'remote-gameplay')
    await mkdir(evidence, { recursive: true })
    const applications = [],
      servers = [],
      fixtures = [],
      observations = []
    const audit = {
      uiOrigins: [],
      battleResults: [],
      serverId: 'same-untrusted-server-id',
      managerDenials: [],
      serverOrigins: [],
      decodedImages: [],
      nativePlayback: [],
      canvasPixels: [],
      layout: [],
      climax: [],
      loadingFailures: [],
      renderer: swf ? 'isolated-swf-dom-canvas' : 'image',
    }
    try {
      for (const skillName of swf ? ['同步冲击'] : ['同步冲击', '第二服冲击']) {
        const fixture = await createNpmFixture({ presentation: true, ...(swf ? { remoteUrl: originalUrls[0] } : {}) })
        fixtures.push(fixture)
        const contentFile = join(fixture.installedDirectory, 'content.json')
        const content = JSON.parse(await readFile(contentFile, 'utf8'))
        content.data.species[0].baseStats.hp = swf ? 30 : 10
        if (swf) {
          content.data.skills[0].category = 'Climax'
          content.data.skills[0].rage = 0
          content.data.species[0].name = '原作一号'
          const second = structuredClone(content.data.species[0])
          second.id = 'pet-two'
          second.num = 2
          second.name = '原作二号'
          second.presentation.battle.source = originalUrls[1]
          content.data.species.push(second)
          const presentationFile = join(fixture.installedDirectory, 'dist/presentation.json')
          const presentation = JSON.parse(await readFile(presentationFile, 'utf8'))
          presentation.resources.push({
            kind: 'http',
            id: originalUrls[1],
            source: originalUrls[1],
            mime: 'application/x-shockwave-flash',
          })
          presentation.locales['zh-CN'].species = { pet: { name: '原作一号' }, 'pet-two': { name: '原作二号' } }
          await writeFile(presentationFile, JSON.stringify(presentation))
        } else content.data.species[0].presentation.battle = { renderer: 'image', source: 'assets/icon.png' }
        content.data.skills[0].power = 60
        content.data.skills[0].name = skillName
        await writeFile(contentFile, JSON.stringify(content))
        const server = createSingleProcessApp({ host: '127.0.0.1', port: 0, serverId: audit.serverId })
        servers.push(server)
        const environment = await server.environments.prepareNpm(fixture.directory)
        const traffic = []
        observations.push({ traffic, environment, skillName, mediaHeaders: [] })
        server.httpServer.prependListener('request', request => {
          traffic.push({
            path: request.url,
            origin: request.headers.origin,
            authorization: request.headers.authorization,
          })
        })
        await server.start()
        audit.serverOrigins.push(`http://127.0.0.1:${server.address.port}`)
      }
      const players = []
      for (const name of ['Host', 'Guest']) {
        const entry = join(directory, `${name}.mjs`)
        await writeFile(
          entry,
          `import {app} from 'electron';app.setPath('userData',${JSON.stringify(join(directory, name))});await import(${JSON.stringify(pathToFileURL(join(frontend, 'electron/main.mjs')).href)});`,
        )
        const env = { ...process.env }
        delete env.ELECTRON_RUN_AS_NODE
        delete env.ARCADIA_ELECTRON_DEV_SERVER_URL
        const application = await _electron.launch({
          executablePath: require('electron'),
          args: [entry],
          env,
          timeout: 30000,
        })
        applications.push(application)
        await application.context().addInitScript(
          ({ name, swf }) => {
            if (window !== window.top || location.protocol !== 'arcadia-client:') return
            if (swf && window.arcadiaSwf) {
              window.desktopSwfEvents = []
              window.desktopSwfFrames = {}
              window.arcadiaSwf.onFrame?.(frame => {
                const stats = (window.desktopSwfFrames[frame.instance] ??= {
                  count: 0,
                  bytes: 0,
                  maxBytes: 0,
                  first: performance.now(),
                  last: 0,
                })
                stats.count++
                stats.bytes += frame.png.byteLength
                stats.maxBytes = Math.max(stats.maxBytes, frame.png.byteLength)
                stats.last = performance.now()
              })
              window.arcadiaSwf.onEvent(event => {
                window.desktopSwfEvents.push(event)
                if (window.desktopSwfEvents.length > 1000) window.desktopSwfEvents.shift()
              })
            }
            if (localStorage.getItem('desktop-gameplay-initialized')) return
            localStorage.setItem('desktop-gameplay-initialized', '1')
            const profile = { id: `desktop-${name}`, name }
            localStorage.setItem('player', JSON.stringify(profile))
            localStorage.setItem('player-data', JSON.stringify(profile))
            localStorage.setItem('gameSetting.battleRenderer', JSON.stringify(swf ? 'swf' : 'image'))
            localStorage.setItem(
              'petStorage',
              JSON.stringify({
                storage: [],
                teams: [{ name: '同步队伍', pets: [], ruleSetId: 'casual_standard_ruleset' }],
                currentTeamIndex: 0,
                lastMatchingConfig: null,
              }),
            )
          },
          { name, swf },
        )
        const manager = await application.firstWindow()
        await expect(manager.getByTestId('server-address-input')).toBeVisible({ timeout: 60000 })
        await manager.evaluate(() =>
          sessionStorage.setItem('desktop-official-credential-probe', 'official-secret-not-for-other-servers'),
        )
        assert.equal((await manager.evaluate(() => window.arcadiaDesktop.listContentPackages())).packages.length, 0)
        players.push({ name, application, manager })
      }

      async function openRemote(player, origin) {
        const previous = player.remote
        const created = player.application.waitForEvent('window')
        await player.manager.getByTestId('server-address-input').fill(origin)
        await player.manager.getByTestId('connect-server-button').click()
        player.remote = await created
        const page = player.remote
        player.imageRequests = []
        const imageTraffic = new Map()
        page.on('request', request => {
          if (request.resourceType() !== 'image') return
          const entry = { url: request.url(), startedAt: Date.now() }
          imageTraffic.set(request, entry)
          player.imageRequests.push(entry)
        })
        page.on('response', response => {
          const entry = imageTraffic.get(response.request())
          if (entry) entry.status = response.status()
        })
        page.on('requestfinished', request => {
          const entry = imageTraffic.get(request)
          if (entry) {
            entry.finishedAt = Date.now()
            entry.timing = request.timing()
          }
        })
        page.on('requestfailed', request => {
          const entry = imageTraffic.get(request)
          if (entry) {
            entry.finishedAt = Date.now()
            entry.failure = request.failure()?.errorText
          }
        })
        page.on('pageerror', error => t.diagnostic(`${player.name}: ${error.message}`))
        page.on('response', response => {
          if (response.url().startsWith(origin + '/api/v1/environments/') && response.url().includes('/assets/'))
            observations[audit.serverOrigins.indexOf(origin)].mediaHeaders.push(response.headerValue('cache-control'))
        })
        await expect(page.getByTestId('create-private-room-button')).toBeEnabled({ timeout: 60000 })
        assert.equal(await page.evaluate(() => location.origin), 'arcadia-client://app')
        assert.equal(await page.evaluate(() => typeof window.arcadiaDesktop), 'undefined')
        assert.equal(await page.evaluate(() => '__APP_DEBUG__' in window), false)
        assert.equal(await page.evaluate(() => sessionStorage.getItem('desktop-official-credential-probe')), null)
        assert.equal((await page.evaluate(() => window.arcadiaRemotePlay.getBootConfig())).backendOrigin, origin)
        await expect(page.getByTestId('server-address-input')).toHaveCount(0)
        await expect(page.getByTestId('current-server-address')).toHaveText(origin)
        if (previous) assert.equal(previous.isClosed(), true)
        audit.uiOrigins.push(await page.evaluate(() => location.origin))
        const remoteId = await (await player.application.browserWindow(page)).evaluate(window => window.id)
        const denials = await player.application.evaluate(async ({ ipcMain, BrowserWindow }, remoteId) => {
          const sender = BrowserWindow.fromId(remoteId).webContents
          const channels = [...ipcMain._invokeHandlers.keys()].filter(name => name.startsWith('desktop:'))
          const failed = []
          for (const channel of channels) {
            try {
              await ipcMain._invokeHandlers.get(channel)({ sender, senderFrame: sender.mainFrame }, {})
              failed.push(channel)
            } catch (error) {
              if (!error.message.includes('Unauthorized desktop frame')) failed.push(channel)
            }
          }
          return { count: channels.length, failed }
        }, remoteId)
        assert.ok(denials.count > 40)
        assert.deepEqual(denials.failed, [])
        audit.managerDenials.push(denials.count)
        return page
      }
      async function team(page, index) {
        const speciesName = swf ? ['原作一号', '原作二号'][index] : '展示精灵'
        await page.getByRole('link', { name: '编辑或创建队伍', exact: true }).click()
        await expect(page.getByRole('heading', { name: '队伍编辑器', exact: true })).toBeVisible()
        await page.getByRole('button', { name: '添加精灵', exact: true }).click()
        const species = page.locator('.el-select').first()
        await species.click()
        await species.locator('input[role=combobox]').fill(speciesName)
        await page.getByRole('option', { name: new RegExp(speciesName) }).click()
        await expect(page.getByPlaceholder('输入精灵名称')).toHaveValue(speciesName)
        await page.getByRole('button', { name: '保存', exact: true }).click()
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('petStorage')).teams[0].pets[0])
        assert.equal(saved.species, swf && index === 1 ? 'example-slow:pet-two' : 'example-slow:pet')
        assert.deepEqual(saved.skills, ['example-slow:strike'])
        await page.getByRole('link', { name: '返回房间', exact: true }).click()
        await page.getByTestId('room-team-selector').getByTestId('team-option-0').click()
      }
      const isolatedPlayers = player =>
        player.application.evaluate(({ webContents, BrowserWindow }) =>
          webContents
            .getAllWebContents()
            .filter(wc => wc.getURL().startsWith('arcadia-swf:'))
            .map(wc => ({
              pid: wc.getOSProcessId(),
              visible: BrowserWindow.fromWebContents(wc)?.isVisible(),
              sandboxed: wc.getLastWebPreferences().sandbox,
              offscreen: wc.isOffscreen(),
            })),
        )
      const playback = page => page.evaluate(() => window.desktopSwfEvents)
      const canvasPixels = page =>
        page.locator('canvas[data-swf-player]').evaluateAll(canvases =>
          canvases.map(canvas => {
            const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
            let visible = 0,
              transparent = 0,
              partial = 0
            for (let i = 3; i < data.length; i += 4) {
              if (data[i] > 0) visible++
              if (data[i] < 255) transparent++
              if (data[i] > 0 && data[i] < 255) partial++
            }
            return { width: canvas.width, height: canvas.height, visible, transparent, partial }
          }),
        )
      async function expectNativeReady(player) {
        const page = player.remote
        await expect
          .poll(
            () =>
              page.evaluate(() => {
                const active = [...document.querySelectorAll('canvas[data-swf-player]')].map(
                  canvas => canvas.dataset.swfPlayer,
                )
                return active.filter(instance =>
                  window.desktopSwfEvents.some(
                    event =>
                      event.instance === instance && event.type === 'ready' && event.states?.includes('物理攻击'),
                  ),
                ).length
              }),
            { timeout: 60000 },
          )
          .toBe(2)
        await expect(page.getByTestId('pet-static-fallback')).toHaveCount(0)
        await expect(page.locator('canvas[data-swf-player]')).toHaveCount(2)
        await expect
          .poll(
            async () =>
              (await canvasPixels(page)).filter(pixels => pixels.visible > 0 && pixels.transparent > 0).length,
          )
          .toBe(2)
        const renderers = await isolatedPlayers(player)
        assert.equal(renderers.length, 2)
        for (const renderer of renderers) {
          assert.equal(renderer.visible, false)
          assert.equal(renderer.sandboxed, true)
          assert.equal(renderer.offscreen, true)
        }
      }
      async function recordCanvasLayout(player, label) {
        const layout = await player.remote.locator('canvas[data-swf-player]').evaluateAll(canvases =>
          canvases.map(canvas => ({
            bitmap: { width: canvas.width, height: canvas.height },
            logical: { width: canvas.parentElement.clientWidth, height: canvas.parentElement.clientHeight },
            rect: canvas.getBoundingClientRect().toJSON(),
            parent: canvas.parentElement.getBoundingClientRect().toJSON(),
            pointerEvents: getComputedStyle(canvas).pointerEvents,
          })),
        )
        assert.equal(layout.length, 2)
        for (const item of layout) {
          assert.deepEqual(item.bitmap, item.logical)
          assert.equal(item.logical.width, 1600)
          assert.equal(item.logical.height, 900)
          assert.equal(item.pointerEvents, 'none')
          assert.ok(Math.abs(item.rect.width - item.parent.width) < 1)
          assert.ok(Math.abs(item.rect.height - item.parent.height) < 1)
        }
        audit.layout.push({ player: player.name, label, canvases: layout })
      }
      async function captureClimax(page) {
        const log = page.getByRole('button', { name: '战斗日志', exact: true })
        const before = await log.getAttribute('aria-pressed')
        await page.waitForFunction(
          () => document.querySelector('.climax-effect-container.playing .effect-frame.visible'),
          null,
          { polling: 'raf', timeout: 30000 },
        )
        const layers = await page.evaluate(() => {
          const button = document.querySelector('button[aria-label="战斗日志"]')
          const box = button.getBoundingClientRect()
          const x = box.x + box.width / 2,
            y = box.y + box.height / 2
          const effect = document.querySelector('.climax-effect-container.playing')
          const black = [...document.querySelectorAll('div')].find(
            element =>
              getComputedStyle(element).zIndex === '1050' &&
              getComputedStyle(element).backgroundColor === 'rgb(0, 0, 0)',
          )
          return {
            playing: !!effect,
            clickPoint: { x, y },
            hitStack: document
              .elementsFromPoint(x, y)
              .slice(0, 5)
              .map(element => ({ tag: element.tagName, className: element.className })),
            effectZ: getComputedStyle(effect.parentElement.parentElement).zIndex,
            black: black && {
              z: getComputedStyle(black).zIndex,
              pointerEvents: getComputedStyle(black).pointerEvents,
              rect: black.getBoundingClientRect().toJSON(),
            },
            canvases: [...document.querySelectorAll('canvas[data-swf-player]')].map(canvas =>
              canvas.getBoundingClientRect().toJSON(),
            ),
            clickTarget: document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'),
          }
        })
        await writeFile(join(evidence, 'climax-layer-observation.json'), JSON.stringify(layers, null, 2))
        assert.equal(layers.playing, true)
        assert.equal(layers.effectZ, '1060')
        assert.equal(layers.black?.z, '1050')
        assert.equal(layers.black?.pointerEvents, 'none')
        assert.equal(layers.clickTarget, '战斗日志')
        for (const rect of layers.canvases) {
          assert.ok(layers.black.rect.x <= rect.x + 1 && layers.black.rect.y <= rect.y + 1)
          assert.ok(layers.black.rect.right >= rect.right - 1 && layers.black.rect.bottom >= rect.bottom - 1)
        }
        await Promise.all([
          page.screenshot({ path: join(evidence, 'climax-over-both-pets.png'), fullPage: true }),
          page.mouse.click(layers.clickPoint.x, layers.clickPoint.y),
        ])
        await expect(log).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true')
        audit.climax.push({ ...layers, clickToggledLog: true })
        await log.click()
      }
      const tokensByServer = []
      for (let serverIndex = 0; serverIndex < servers.length; serverIndex++) {
        const pages = await Promise.all(players.map(player => openRemote(player, audit.serverOrigins[serverIndex])))
        const [host, guest] = pages
        const credentials = await Promise.all(
          pages.map(page =>
            page.evaluate(() =>
              Object.entries(sessionStorage)
                .filter(([key]) => key.startsWith('server-session:'))
                .map(([, value]) => JSON.parse(value)),
            ),
          ),
        )
        assert.equal(
          credentials.every(items => items.length === 1 && items[0].serverId === 'same-untrusted-server-id'),
          true,
        )
        const tokens = credentials.map(items => items[0].token)
        assert.notEqual(tokens[0], tokens[1])
        if (serverIndex)
          assert.equal(
            tokensByServer[0].some(token => tokens.includes(token)),
            false,
          )
        tokensByServer.push(tokens)
        await host.getByTestId('create-private-room-button').click()
        const dialog = host.getByRole('dialog')
        const timer = dialog.getByRole('switch').first()
        if ((await timer.getAttribute('aria-checked')) === 'true') await timer.click()
        await host.getByTestId('room-environment-select').click()
        await host.getByRole('option', { name: '@arcadia-example/slow 1.0.0', exact: true }).click()
        await host.getByTestId('confirm-create-private-room-button').click()
        await expect(host).toHaveURL(/\/room\/[A-Za-z0-9_-]+/, { timeout: 30000 })
        const roomCode = new URL(host.url()).pathname.split('/').at(-1)
        await guest.getByTestId('join-room-code-input').fill(roomCode)
        await guest.getByTestId('join-private-room-button').click()
        for (const [index, page] of pages.entries()) {
          await expect(page.getByText('玩家 (2/2)')).toBeVisible()
          await expect(page.getByTestId('room-environment')).toContainText('@arcadia-example/slow')
          await team(page, index)
        }
        await guest.getByTestId('toggle-ready-button').click()
        await expect(guest.getByTestId('toggle-ready-button')).toContainText('取消准备')
        await expect(host.getByTestId('start-battle-button')).toBeEnabled()
        await host.getByTestId('start-battle-button').click()
        const skill = page => page.locator('button').filter({ hasText: observations[serverIndex].skillName }).first()
        const result = page => page.getByText('胜利！', { exact: true }).or(page.getByText('失败...', { exact: true }))
        await Promise.all(
          pages.map(async page => {
            await expect(page).toHaveURL(/\/battle\?.*privateRoom=true/, { timeout: 30000 })
            const commands = page.getByRole('button', { name: '战斗', exact: true })
            const retry = page.getByRole('button', { name: '重试', exact: true })
            for (let attempt = 0; attempt < 2; attempt++) {
              await expect
                .poll(async () => (await commands.isVisible()) || (await retry.isVisible()), { timeout: 45000 })
                .toBe(true)
              if (await commands.isVisible()) break
              t.diagnostic(
                `Retrying production loading UI: ${(await page.getByTestId('battle-loading-overlay').innerText()).slice(-200)}`,
              )
              const player = players.find(player => player.remote === page)
              audit.loadingFailures.push({
                player: player.name,
                at: new Date().toISOString(),
                ui: await page.getByTestId('battle-loading-overlay').innerText(),
                runtime: await page.evaluate(() => ({
                  background: getComputedStyle(document.querySelector('.battle-stage__backdrop')).backgroundImage,
                  frames: window.desktopSwfFrames,
                  resources: performance
                    .getEntriesByType('resource')
                    .filter(entry => entry.initiatorType === 'img' || entry.name.includes('battleBackground'))
                    .map(entry => entry.toJSON()),
                })),
                imageRequests: structuredClone(player.imageRequests),
              })
              await writeFile(join(evidence, 'loading-failures.json'), JSON.stringify(audit.loadingFailures, null, 2))
              await retry.click()
            }
            await expect(commands).toBeVisible({ timeout: 45000 })
            await expect(page.getByTestId('battle-loading-overlay')).toHaveCount(0, { timeout: 45000 })
          }),
        )
        if (swf) {
          for (const player of players) {
            await expectNativeReady(player)
            audit.canvasPixels.push({ player: player.name, pixels: await canvasPixels(player.remote) })
            await recordCanvasLayout(player, 'initial')
            await player.remote.screenshot({
              path: join(evidence, `${player.name}-canvas-initial.png`),
              fullPage: true,
            })
            await writeFile(join(evidence, 'layout.json'), JSON.stringify(audit.layout, null, 2))
          }
          const owner = await players[0].application.browserWindow(host)
          for (const [width, height, zoom] of [
            [1100, 750, 1.25],
            [1440, 900, 0.8],
            [1280, 768, 1],
          ]) {
            await owner.evaluate(
              (window, { width, height, zoom }) => {
                window.setContentSize(width, height)
                window.webContents.setZoomFactor(zoom)
              },
              { width, height, zoom },
            )
            await expect.poll(() => host.evaluate(() => innerWidth)).toBeCloseTo(width / zoom, -1)
            await recordCanvasLayout(players[0], `${width}x${height}@${zoom}`)
          }
        } else
          for (const page of pages) {
            const image = page.getByTestId('pet-static-fallback').locator('img').first()
            await expect.poll(() => image.evaluate(image => image.naturalWidth)).toBe(1)
            const decoded = await image.evaluate(async image => {
              await image.decode()
              return { width: image.naturalWidth, height: image.naturalHeight }
            })
            assert.deepEqual(decoded, { width: 1, height: 1 })
            audit.decodedImages.push({ server: serverIndex + 1, ...decoded })
          }
        const attackLogs = host.getByText(swf ? /原作[一二]号 使用/ : /展示精灵 使用/)
        let turns = 0
        const playTurn = async () => {
          turns++
          const previousLogs = await attackLogs.count()
          const climax = swf && turns === 1 ? captureClimax(host) : Promise.resolve()
          for (const page of pages) {
            await expect
              .poll(async () => (await result(page).isVisible()) || (await skill(page).isEnabled()), { timeout: 30000 })
              .toBe(true)
            if (await result(page).isVisible()) return
            await skill(page).click()
          }
          await climax
          await expect.poll(() => attackLogs.count(), { timeout: 30000 }).toBeGreaterThan(previousLogs)
          await expect
            .poll(async () => (await result(host).isVisible()) || (await skill(host).isEnabled()), { timeout: 30000 })
            .toBe(true)
        }
        await playTurn()
        let beforeRefresh
        if (swf) {
          for (const page of pages) {
            await expect
              .poll(
                async () => (await playback(page)).some(event => event.type === 'hit' && event.state === '物理攻击'),
                { timeout: 30000 },
              )
              .toBe(true)
            await expect
              .poll(async () => (await playback(page)).some(event => event.type === 'complete'), { timeout: 30000 })
              .toBe(true)
          }
          beforeRefresh = await playback(guest)
          await host.screenshot({ path: join(evidence, `server-${serverIndex + 1}-canvas-battle.png`), fullPage: true })
        }
        await guest.reload()
        await expect(skill(guest)).toBeVisible({ timeout: 60000 })
        if (swf) {
          await expectNativeReady(players[1])
          assert.ok(
            (await playback(guest))
              .filter(event => event.type === 'ready')
              .every(event => !beforeRefresh.some(previous => previous.instance === event.instance)),
          )
        }
        for (let turn = 0; turn < 8; turn++) {
          if (await result(host).isVisible()) break
          await playTurn()
        }
        for (const page of pages) await expect(result(page)).toBeVisible({ timeout: 30000 })
        const results = await Promise.all(pages.map(page => result(page).innerText()))
        assert.deepEqual(results.toSorted(), ['失败...', '胜利！'].toSorted())
        audit.battleResults.push({ turns, results })
        await host.screenshot({ path: join(evidence, `server-${serverIndex + 1}-battle-result.png`), fullPage: true })
        if (swf) {
          const events = await Promise.all(pages.map(playback))
          for (const list of events)
            assert.deepEqual(
              list.filter(event => event.type === 'error'),
              [],
            )
          audit.nativePlayback.push({
            server: serverIndex + 1,
            events,
            frames: await Promise.all(
              pages.map(page =>
                page.evaluate(() =>
                  Object.fromEntries(
                    Object.entries(window.desktopSwfFrames).map(([instance, stats]) => [
                      instance,
                      {
                        ...stats,
                        fps: ((stats.count - 1) * 1000) / Math.max(1, stats.last - stats.first),
                        bytesPerSecond: (stats.bytes * 1000) / Math.max(1, stats.last - stats.first),
                      },
                    ]),
                  ),
                ),
              ),
            ),
          })
          for (const player of players) {
            await player.remote.getByRole('button', { name: '返回大厅', exact: true }).click()
            await expect(player.remote.locator('canvas[data-swf-player]')).toHaveCount(0)
            await expect.poll(async () => (await isolatedPlayers(player)).length).toBe(0)
          }
        }
        assert.ok(observations[serverIndex].mediaHeaders.length > 0)
        assert.equal(
          (await Promise.all(observations[serverIndex].mediaHeaders)).every(value => value === 'no-store'),
          true,
        )
        assert.equal(
          observations[serverIndex].traffic.some(request =>
            /\.tgz(?:[?#]|$)|\/src\/|\/node_modules\/|\.(?:ts|m?js)(?:[?#]|$)/.test(request.path),
          ),
          false,
        )
        assert.equal(
          observations[serverIndex].traffic.some(request => request.origin === 'arcadia-client://app'),
          true,
        )
        assert.equal(
          observations[serverIndex].traffic.some(request =>
            request.authorization?.includes('official-secret-not-for-other-servers'),
          ),
          false,
        )
      }
      assert.equal(
        observations[1]?.traffic.some(request =>
          tokensByServer[0].some(token => request.authorization?.includes(token)),
        ) ?? false,
        false,
      )
      for (const player of players) {
        assert.equal((await player.manager.evaluate(() => window.arcadiaDesktop.getLocalBattleStatus())).status, 'idle')
        assert.equal(
          (await player.manager.evaluate(() => window.arcadiaDesktop.listContentPackages())).packages.length,
          0,
        )
      }
      audit.mediaRequests = observations.map(({ mediaHeaders }) => mediaHeaders.length)
      audit.catalogRequests = observations.map(
        ({ traffic }) => traffic.filter(request => request.path.includes('/content')).length,
      )
      await writeFile(join(evidence, 'acceptance.json'), JSON.stringify(audit, null, 2))
      t.diagnostic(JSON.stringify(audit))
    } catch (error) {
      for (const [index, application] of applications.entries())
        for (const [pageIndex, page] of application.windows().entries()) {
          if (swf) {
            t.diagnostic(
              JSON.stringify(
                await page
                  .evaluate(() => ({
                    url: location.href,
                    events: window.desktopSwfEvents,
                    frames: window.desktopSwfFrames,
                    canvases: [...document.querySelectorAll('canvas[data-swf-player]')].map(canvas => ({
                      width: canvas.width,
                      height: canvas.height,
                      rect: canvas.getBoundingClientRect().toJSON(),
                    })),
                    setting: localStorage.getItem('gameSetting.battleRenderer'),
                    images: [...document.images].map(image => ({
                      src: image.src.slice(0, 240),
                      width: image.naturalWidth,
                    })),
                  }))
                  .catch(() => ({ closed: true })),
              ),
            )
            t.diagnostic(
              JSON.stringify(
                await application
                  .evaluate(({ webContents }) =>
                    webContents
                      .getAllWebContents()
                      .map(wc => ({ url: wc.getURL(), loading: wc.isLoading(), crashed: wc.isCrashed() })),
                  )
                  .catch(() => []),
              ),
            )
          }
          t.diagnostic(
            (
              await page
                .locator('body')
                .innerText()
                .catch(() => 'closed')
            ).slice(-6000),
          )
          await page
            .screenshot({ path: join(evidence, `failure-${index}-${pageIndex}.png`), fullPage: true })
            .catch(() => {})
        }
      throw error
    } finally {
      await Promise.all(
        applications.map(async application => {
          const timeout = setTimeout(() => application.process().kill('SIGKILL'), 8000)
          try {
            await application.close()
          } finally {
            clearTimeout(timeout)
          }
        }),
      )
      await Promise.all(servers.map(server => server.stop()))
      await Promise.all(fixtures.map(fixture => fixture.dispose()))
      await rm(directory, { recursive: true, force: true })
    }
  },
)
