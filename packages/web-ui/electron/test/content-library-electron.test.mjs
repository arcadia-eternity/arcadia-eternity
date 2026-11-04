import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const exec = promisify(execFile)
const frontend = fileURLToPath(new URL('../../', import.meta.url))
const repository = fileURLToPath(new URL('../../../../', import.meta.url))
test(
  'actual Electron window automatically converges package choices without confirmation or restart',
  {
    timeout: 240000,
    skip: process.env.ARCADIA_DESKTOP_GUI_TEST !== '1',
  },
  async t => {
    const { _electron, expect: playwrightExpect } = require('playwright/test')
    const expect = playwrightExpect.configure({ timeout: 30000 })
    const rendererUrl = process.env.ARCADIA_DESKTOP_GUI_URL ?? 'http://127.0.0.1:4173'
    assert.ok(
      (await fetch(rendererUrl, { signal: AbortSignal.timeout(5000) })).ok,
      'Start the renderer before running the native GUI test',
    )
    const output = join(frontend, 'native-content-qa.local')
    await mkdir(output, { recursive: true })
    const directory = await mkdtemp(join(output, 'runtime-'))
    let application
    try {
      const packed = await exec(
        'npm',
        ['pack', './examples/ugc/slow', '--json', '--ignore-scripts', '--pack-destination', directory],
        { cwd: repository },
      )
      const tarball = join(directory, JSON.parse(packed.stdout)[0].filename)
      const main = pathToFileURL(join(frontend, 'electron/main.mjs')).href
      const entry = join(directory, 'entry.mjs')
      await writeFile(
        entry,
        "import { app } from 'electron';\napp.setPath('userData', " +
          JSON.stringify(join(directory, 'user-data')) +
          ');\nawait import(' +
          JSON.stringify(main) +
          ');\n',
      )
      const env = {
        ...process.env,
        ARCADIA_ELECTRON_DEV_SERVER_URL: rendererUrl,
      }
      delete env.ELECTRON_RUN_AS_NODE
      application = await _electron.launch({ executablePath: require('electron'), args: [entry], env, timeout: 30000 })
      await application.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
      }, tarball)
      const page = await application.firstWindow({ timeout: 20000 })
      // Match the ordinary browser smoke fixture: scene readiness is independent of the CDN.
      await page.addInitScript(() => localStorage.setItem('gameSetting.battleRenderer', '"image"'))
      await page.route('**/png/battleBackground/*.png', route =>
        route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#283546"/></svg>',
        }),
      )
      await page.route('**/png/pet/*.png', route =>
        route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="45" fill="#7e9bbc"/></svg>',
        }),
      )
      await page.goto(rendererUrl + '/content', { timeout: 20000 })
      await page.getByRole('button', { name: '添加内容包', exact: true }).click()
      await page.getByRole('button', { name: '安装本地 .tgz 文件', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.locator('.package-detail > .detail-subtitle')).toContainText('本机已启用')
      const packages = await page.evaluate(() => window.arcadiaDesktop.listContentPackages())
      assert.equal(packages.packages.length, 1)
      const pkg = packages.packages[0]
      assert.equal(pkg.name, '@arcadia-example/slow')
      await expect(page.getByLabel('启用 ' + pkg.title, { exact: true })).toBeChecked()
      const status = await page.evaluate(() => window.arcadiaDesktop.getLocalBattleStatus())
      assert.equal(status.status, 'idle')
      // Personal editing and the ordinary local page consume the installed selection.
      await page.evaluate(async () => {
        const path = '/src/stores/petStorage.ts'
        const { usePetStorageStore } = await import(path)
        const store = usePetStorageStore()
        store.teams = [
          {
            name: 'UGC ordinary local',
            ruleSetId: 'casual_standard_ruleset',
            pets: [
              {
                id: '111111111111111111111',
                name: 'UGC pet',
                species: 'example-slow:pet',
                level: 100,
                nature: 'Hardy',
                gender: 'Male',
                skills: ['example-slow:strike'],
                evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
                ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
              },
            ],
          },
        ]
        store.currentTeamIndex = 0
        store.initialized = true
        if (!store.validateAndSave()) throw new Error('Invalid local UGC team fixture')
      })
      await page.goto(rendererUrl + '/team-builder')
      await expect(page.getByRole('heading', { name: '队伍编辑器', exact: true })).toBeVisible()
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const path = '/src/stores/gameData.ts'
            return !!(await import(path)).useGameDataStore().species.byId['example-slow:pet']
          }),
        )
        .toBe(true)
      await page.goto(rendererUrl + '/local-battle')
      await page.getByRole('button', { name: '开始本地对战', exact: true }).click()
      await page.waitForURL(/\/battle\?dev=true/)
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const path = '/src/stores/battle.ts'
            const system = (await import(path)).useBattleStore().battleInterface
            const state = await system.getState(undefined, true)
            return (await system.getAvailableSelection(state.players[0].id)).some(action => action.type === 'use-skill')
          }),
        )
        .toBe(true)
      const initial = await page.evaluate(async () => {
        const path = '/src/stores/battle.ts'
        const system = (await import(path)).useBattleStore().battleInterface
        return system.getState(undefined, true)
      })
      assert.equal(initial.players[0].team[0].speciesID, 'example-slow:pet')
      await page.evaluate(async () => {
        const path = '/src/stores/battle.ts'
        const store = (await import(path)).useBattleStore(),
          system = store.battleInterface
        const state = await system.getState(undefined, true)
        const actions = await system.getAvailableSelection(state.players[0].id)
        await system.submitAction(actions.find(action => action.type === 'use-skill'))
      })
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const path = '/src/stores/battle.ts'
            const state = await (await import(path)).useBattleStore().battleInterface.getState(undefined, true)
            return state.players[0].team[0].stats.spe
          }),
        )
        .toBeLessThan(initial.players[0].team[0].stats.spe)
      await page.evaluate(async () => {
        const path = '/src/stores/battle.ts'
        await (await import(path)).useBattleStore().resetBattleWithoutSurrender()
      })
      await page.goto(rendererUrl + '/content')
      await page.locator('.package-select').filter({ hasText: pkg.title }).click()
      await page.screenshot({ path: join(output, 'installed.png'), fullPage: true })
      await page.getByLabel('启用 ' + pkg.title, { exact: true }).uncheck()
      await expect(page.locator('.package-detail > .detail-subtitle')).toContainText('已安装，未启用')
      const current = await page.evaluate(() => window.arcadiaDesktop.listContentPackages())
      assert.deepEqual(current.activeIds, [])
      assert.equal(current.serviceStatus.url, status.url)
      assert.equal(current.serviceStatus.serverId, status.serverId)
      assert.equal(current.serviceNeedsRestart, false)
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.equal(current.serviceStatus.status, 'idle')
      await page.getByRole('button', { name: '浏览内容（只读）', exact: true }).click()
      await expect(page.locator('.app-header .badge')).toHaveText('只读')
      await page.getByRole('navigation', { name: '内容分类' }).getByRole('button', { name: /^技能/ }).click()
      await page.locator('.content-card').filter({ hasText: 'strike' }).click()
      await expect(page.getByLabel('威力', { exact: true })).toHaveValue('40')
      await expect(page.getByLabel('威力', { exact: true })).toBeDisabled()
      await page.goto(rendererUrl + '/settings/local-service')
      await expect(page.getByRole('heading', { name: '高级本机工具', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: '由本机托管联机对战', exact: true })).not.toBeVisible()
      t.diagnostic(
        'Real Electron renderer → preload → guarded IPC → npm → content validation passed; multiplayer hosting remained idle',
      )
    } catch (error) {
      if (application?.windows()[0]) {
        const diagnostics = await application
          .windows()[0]
          .evaluate(async () => ({
            page: location.href,
            text: document.body.innerText.slice(0, 4000),
            library: await window.arcadiaDesktop.listContentPackages(),
            host: await window.arcadiaDesktop.getLocalBattleStatus(),
          }))
          .catch(() => null)
        t.diagnostic(JSON.stringify(diagnostics))
      }
      throw error
    } finally {
      if (application) {
        const timeout = setTimeout(() => application.process().kill('SIGKILL'), 8000)
        try {
          await application.close()
        } finally {
          clearTimeout(timeout)
        }
      }
      await rm(directory, { recursive: true, force: true })
    }
  },
)
