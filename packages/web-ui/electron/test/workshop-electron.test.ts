import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const DEMO = { title: '工坊投稿测试包', npm: '@yuuinih/arcadia-workshop-demo', current: '0.1.2', revoked: '0.1.1' }

test(
  'actual Electron window installs a community workshop release, adds it to an environment and keeps it after restart',
  { timeout: 600000, skip: process.env.ARCADIA_LIVE_WORKSHOP_GUI !== '1' },
  async t => {
    const { _electron, expect: playwrightExpect } = require('playwright/test')
    const expect = playwrightExpect.configure({ timeout: 60000 })
    const origin = process.env.ARCADIA_DESKTOP_GUI_URL ?? 'http://127.0.0.1:5183'
    assert.ok((await fetch(origin, { signal: AbortSignal.timeout(5000) })).ok, 'Start the renderer first')
    const root = await mkdtemp(join(tmpdir(), 'arcadia-workshop-gui-'))
    t.after(() =>
      process.env.ARCADIA_KEEP_TEST_DATA ? t.diagnostic('kept ' + root) : rm(root, { recursive: true, force: true }),
    )
    const entry = join(root, 'entry.mjs')
    const main = pathToFileURL(fileURLToPath(new URL('../main.ts', import.meta.url))).href
    await writeFile(
      entry,
      `import {app} from 'electron';app.setPath('userData',${JSON.stringify(join(root, 'data'))});await import(${JSON.stringify(main)});`,
    )
    const env = { ...process.env, ARCADIA_ELECTRON_DEV_SERVER_URL: origin }
    delete env.ELECTRON_RUN_AS_NODE
    const launch = async () => {
      const application = await _electron.launch({
        executablePath: require('electron'),
        args: [entry],
        env,
        timeout: 30000,
      })
      // Accept the native install and effect-authorization dialogs, recording what they asked.
      await application.evaluate(({ dialog }) => {
        const prompts: string[] = ((globalThis as { __prompts?: string[] }).__prompts = [])
        const original = dialog.showMessageBox.bind(dialog)
        dialog.showMessageBox = ((window: unknown, options: { buttons?: string[]; message?: string }) => {
          const buttons = options?.buttons ?? []
          const accept = buttons.findIndex(label => label === '安装' || label === '允许此环境使用')
          if (accept < 0) return original(window as never, options as never)
          prompts.push(options.message ?? '')
          return Promise.resolve({ response: accept, checkboxChecked: false })
        }) as typeof dialog.showMessageBox
      })
      const page = await application.firstWindow({ timeout: 20000 })
      return { application, page }
    }
    const prompts = application => application.evaluate(() => (globalThis as { __prompts?: string[] }).__prompts ?? [])
    const snapshot = page =>
      page.evaluate(async () => (await window.arcadiaDesktop.localEnvironment({ action: 'snapshot' })).result)
    const workshop = (page, input) => page.evaluate(request => window.arcadiaDesktop.workshop(request), input)

    let { application, page } = await launch()
    try {
      await page.goto(origin + '/environments?target=local')
      await page.getByRole('button', { name: '复制环境', exact: true }).click()
      await page.getByRole('button', { name: '保存并应用', exact: true }).click()
      await expect
        .poll(async () => (await snapshot(page)).operations.find(job => job.kind === 'environment.apply')?.status)
        .toBe('succeeded')
      const copy = (await snapshot(page)).environments.find(item => !item.builtin)
      assert.ok(copy)

      await page.goto(origin + '/workshop')
      await page
        .getByRole('list', { name: '工坊项目' })
        .getByRole('button', { name: new RegExp(DEMO.title) })
        .click()
      const detail = page.getByRole('article', { name: DEMO.title })
      await expect(detail.getByRole('combobox', { name: '版本' })).toBeVisible()
      await expect(detail.getByText(DEMO.current, { exact: true })).toBeVisible()
      await detail.getByRole('button', { name: '安装', exact: true }).click()
      await expect(detail.getByText(`已安装 ${DEMO.title} ${DEMO.current}`)).toBeVisible({ timeout: 240000 })

      // Revoked releases stay refused even when requested directly over IPC.
      const refused = await workshop(page, { action: 'install', npm: DEMO.npm, version: DEMO.revoked })
      assert.match(JSON.stringify(refused), /WORKSHOP_RELEASE_REVOKED/)

      await detail.getByRole('button', { name: '加入环境', exact: true }).click()
      await page.waitForURL(/\/environments/)
      const form = page.getByRole('form', { name: '选择目标环境' })
      await expect(form.getByText(`${DEMO.npm} ${DEMO.current}`)).toBeVisible()
      await form.getByRole('button', { name: '加入环境', exact: true }).click()
      const member = async page => {
        const state = await snapshot(page)
        const target = state.environments.find(item => item.document.id === copy.document.id)
        const ready = state.installations.find(
          item =>
            item.status === 'ready' &&
            item.environmentId === copy.document.id &&
            item.draftRevision === target?.revision,
        )
        return ready?.members?.find(item => item.name === DEMO.npm && item.direct)?.version
      }
      await expect.poll(() => member(page), { timeout: 240000 }).toBe(DEMO.current)
      t.diagnostic('native prompts: ' + JSON.stringify(await prompts(application)))
      await application.close()

      ;({ application, page } = await launch())
      await page.goto(origin + '/environments?target=local')
      await expect.poll(() => member(page)).toBe(DEMO.current)
      const library = await page.evaluate(() => window.arcadiaDesktop.listContentPackages())
      assert.ok(library.packages.some(item => item.name === DEMO.npm && item.version === DEMO.current))
      t.diagnostic('Live registry → npm → library → environment apply → restart passed')
    } catch (error) {
      const failed = await snapshot(page).catch(() => undefined)
      t.diagnostic('operations: ' + JSON.stringify(failed?.operations?.map(job => [job.kind, job.status, job.error])))
      await page
        ?.screenshot({ path: join(tmpdir(), 'arcadia-workshop-gui-failure.png'), fullPage: true })
        .catch(() => {})
      throw error
    } finally {
      await application?.close().catch(() => {})
    }
  },
)
