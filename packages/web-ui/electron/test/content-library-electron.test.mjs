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
    timeout: 120000,
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
      await page.goto(rendererUrl + '/content', { timeout: 20000 })
      await page.getByRole('button', { name: '添加内容包', exact: true }).click()
      await page.getByRole('button', { name: '安装本地 .tgz 文件', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.locator('.selection-state')).toContainText('所选内容已就绪')
      const packages = await page.evaluate(() => window.arcadiaDesktop.listContentPackages())
      assert.equal(packages.packages.length, 1)
      const pkg = packages.packages[0]
      assert.equal(pkg.name, '@arcadia-example/slow')
      await expect(page.getByLabel('启用 ' + pkg.title, { exact: true })).toBeChecked()
      const status = await page.evaluate(() => window.arcadiaDesktop.getLocalBattleStatus())
      assert.equal(status.status, 'idle')
      await page.screenshot({ path: join(output, 'installed.png'), fullPage: true })
      await page.getByLabel('启用 ' + pkg.title, { exact: true }).uncheck()
      await expect(page.locator('.selection-state')).toContainText('所选内容已就绪')
      const current = await page.evaluate(() => window.arcadiaDesktop.listContentPackages())
      assert.deepEqual(current.activeIds, [])
      assert.equal(current.serviceStatus.url, status.url)
      assert.equal(current.serviceStatus.serverId, status.serverId)
      assert.equal(current.serviceNeedsRestart, false)
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.equal(current.serviceStatus.status, 'idle')
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
