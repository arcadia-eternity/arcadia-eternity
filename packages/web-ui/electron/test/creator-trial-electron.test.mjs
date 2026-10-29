import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const frontend = fileURLToPath(new URL('../../', import.meta.url))
test(
  'desktop creator trials use the existing local battle and release their data without hosting',
  {
    timeout: 120000,
    skip: process.env.ARCADIA_DESKTOP_GUI_TEST !== '1',
  },
  async t => {
    const { _electron, expect: playwrightExpect } = require('playwright/test')
    const expect = playwrightExpect.configure({ timeout: 30000 })
    const rendererUrl = process.env.ARCADIA_DESKTOP_GUI_URL ?? 'http://127.0.0.1:4173'
    assert.ok((await fetch(rendererUrl, { signal: AbortSignal.timeout(5000) })).ok)
    const output = join(frontend, 'native-content-qa.local')
    await mkdir(output, { recursive: true })
    const directory = await mkdtemp(join(output, 'trial-'))
    let application
    try {
      const entry = join(directory, 'entry.mjs')
      await writeFile(
        entry,
        "import { app } from 'electron';\napp.setPath('userData', " +
          JSON.stringify(join(directory, 'user-data')) +
          ');\nawait import(' +
          JSON.stringify(pathToFileURL(join(frontend, 'electron/main.mjs')).href) +
          ');\n',
      )
      const env = { ...process.env, ARCADIA_ELECTRON_DEV_SERVER_URL: rendererUrl }
      delete env.ELECTRON_RUN_AS_NODE
      application = await _electron.launch({ executablePath: require('electron'), args: [entry], env, timeout: 30000 })
      const page = await application.firstWindow({ timeout: 20000 })
      const lifecycleErrors = []
      page.on('pageerror', error => lifecycleErrors.push(error.message))
      page.on('console', message => {
        if (message.text().includes('Native battle system is disposed')) lifecycleErrors.push(message.text())
      })
      await page.addInitScript(() => localStorage.setItem('gameSetting.battleRenderer', '"image"'))
      await page.route(/\/png\/(pet|battleBackground)\/.*\.png/, route =>
        route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#283546"/></svg>',
        }),
      )
      await page.goto(rendererUrl + '/creator')
      const before = await page.evaluate(async () => {
        const petsPath = '/src/stores/petStorage.ts',
          clientPath = '/src/stores/battleClient.ts'
        const { usePetStorageStore } = await import(petsPath)
        const { useBattleClientStore } = await import(clientPath)
        return { teams: JSON.stringify(usePetStorageStore().teams), server: useBattleClientStore().serverUrl }
      })
      assert.equal((await page.evaluate(() => window.arcadiaDesktop.getLocalBattleStatus())).status, 'idle')
      await page.getByLabel('作品名称', { exact: true }).fill('桌面试战')
      await page.getByLabel('命名空间', { exact: true }).fill('desktop_trial')
      await page.getByRole('button', { name: '创建作品', exact: true }).click()
      await expect(page.getByLabel('作品标题')).toHaveValue('桌面试战')
      await page.getByLabel('本地 ID', { exact: true }).fill('strike')
      await page.getByRole('button', { name: '添加内容', exact: true }).click()
      await page.getByLabel('显示名称').fill('桌面打击')
      await page.getByRole('button', { name: /^精灵（/ }).click()
      await page.getByLabel('本地 ID', { exact: true }).fill('pet')
      await page.getByRole('button', { name: '添加内容', exact: true }).click()
      const skills = page.getByLabel('可学技能（可多选）')
      const strike = await skills.locator('option').filter({ hasText: 'desktop_trial:strike' }).getAttribute('value')
      await skills.selectOption(strike)
      await page.getByRole('button', { name: '校验并准备试战', exact: true }).click()
      await expect(page.getByRole('status')).toContainText('校验通过')
      await page.getByRole('button', { name: '开始试战', exact: true }).click()
      await page.waitForURL(/\/local-battle\?trialKey=/)
      await page.getByRole('button', { name: '开始本地对战', exact: true }).click()
      await page.waitForURL(/\/battle\?dev=true/)
      await expect(page.getByRole('button', { name: /^桌面打击 ·/ })).toBeEnabled()
      assert.equal((await page.evaluate(() => window.arcadiaDesktop.getLocalBattleStatus())).status, 'idle')
      await page.getByRole('button', { name: /^桌面打击 ·/ }).click()
      await expect(
        page
          .getByRole('log', { name: '战斗记录' })
          .getByText(/使用 桌面打击/)
          .last(),
      ).toBeVisible()
      await page.screenshot({ path: join(output, 'creator-trial.png'), fullPage: true })
      await page.evaluate(async () => {
        const path = '/src/router/index.ts'
        const { default: router } = await import(path)
        void router.push('/creator')
      })
      await page.getByRole('button', { name: '确定', exact: true }).click()
      await page.waitForURL(/\/creator$/)
      await expect(page.getByRole('button', { name: '桌面试战 desktop_trial:…' })).toBeVisible()
      const after = await page.evaluate(async () => {
        const petsPath = '/src/stores/petStorage.ts',
          clientPath = '/src/stores/battleClient.ts'
        const dataPath = '/src/stores/gameData.ts',
          battlePath = '/src/stores/battle.ts'
        const { usePetStorageStore } = await import(petsPath)
        const { useBattleClientStore } = await import(clientPath)
        const { useGameDataStore } = await import(dataPath)
        const { useBattleStore } = await import(battlePath)
        return {
          teams: JSON.stringify(usePetStorageStore().teams),
          server: useBattleClientStore().serverUrl,
          temporary: useGameDataStore().species.allIds.filter(id => id.startsWith('desktop_trial:')),
          battle: useBattleStore().battleInterface,
          host: (await window.arcadiaDesktop.getLocalBattleStatus()).status,
        }
      })
      assert.deepEqual(after, { ...before, temporary: [], battle: null, host: 'idle' })
      assert.deepEqual(lifecycleErrors, [])
    } catch (error) {
      const page = application?.windows()[0]
      if (page) {
        t.diagnostic(
          await page
            .locator('body')
            .innerText()
            .catch(() => 'Window closed'),
        )
        await page.screenshot({ path: join(output, 'creator-trial-failure.png'), fullPage: true }).catch(() => {})
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
