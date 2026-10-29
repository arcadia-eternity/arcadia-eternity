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
  'actual Electron window installs and enables a local package through preload IPC and starts the real host',
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
      await page.getByRole('button', { name: '选择本地 .tgz 文件', exact: true }).click()
      await expect(page.getByRole('dialog')).toContainText('@arcadia-example/slow')
      await page.getByRole('button', { name: '安装并允许运行', exact: true }).click()
      await expect(page.getByRole('status')).toContainText('内容包已安装')
      const packages = await page.evaluate(() => window.arcadiaDesktop.listContentPackages())
      assert.equal(packages.packages.length, 1)
      const pkg = packages.packages[0]
      assert.equal(pkg.name, '@arcadia-example/slow')
      await page.getByLabel('启用 ' + pkg.title, { exact: true }).check()
      await page.getByRole('button', { name: '检查并应用更改', exact: true }).click()
      await page.getByRole('button', { name: '确认应用', exact: true }).click()
      await expect(page.getByRole('status')).toContainText('本机内容选择已应用')
      await page.screenshot({ path: join(output, 'installed.png'), fullPage: true })
      await page.goto(env.ARCADIA_ELECTRON_DEV_SERVER_URL + '/settings/local-service')
      await page.getByRole('button', { name: '启动本机服务', exact: true }).click()
      await expect(page.locator('main.local-service')).toContainText('运行中：', { timeout: 45000 })
      const status = await page.evaluate(() => window.arcadiaDesktop.getLocalBattleStatus())
      assert.equal(status.status, 'running')
      const catalogue = (await (await fetch(status.url + '/api/v1/environments')).json()).environments
      assert.ok(catalogue.some(env => env.packages.some(pkg => pkg.name === '@arcadia-example/slow')))
      await page.getByRole('button', { name: '停止本机服务', exact: true }).click()
      await expect(page.locator('main.local-service')).toContainText('服务未运行')
      t.diagnostic(
        'Real Electron renderer → preload → guarded IPC → npm → content validation → loopback service passed',
      )
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
