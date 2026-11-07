import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const enabled = process.env.ARCADIA_AUTHOR_GUI_TEST === '1'
async function desktop(run) {
  const { _electron, expect } = require('playwright/test')
  const root = await mkdtemp(join(tmpdir(), 'arcadia-author-performance-'))
  const main = fileURLToPath(new URL('../main.mjs', import.meta.url))
  const entry = join(root, 'entry.mjs')
  await writeFile(
    entry,
    `import {app} from 'electron';app.setPath('userData',${JSON.stringify(join(root, 'data'))});await import(${JSON.stringify(pathToFileURL(main).href)});`,
  )
  const origin = process.env.ARCADIA_AUTHOR_TEST_ORIGIN || 'http://127.0.0.1:5183'
  const env = { ...process.env, ARCADIA_ELECTRON_DEV_SERVER_URL: origin }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_TEST_CONTEXT
  let app
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [entry], env })
    const page = await app.firstWindow()
    page.setDefaultTimeout(30000)
    await page.goto(origin + '/creator')
    try {
      await run({ app, page, expect })
    } catch (error) {
      console.error(await page.locator('body').innerText())
      throw error
    }
  } finally {
    if (app) {
      await app
        .evaluate(({ BrowserWindow }) => {
          for (const window of BrowserWindow.getAllWindows()) window.destroy()
        })
        .catch(() => {})
      await app.close().catch(() => {})
    }
    await rm(root, { recursive: true, force: true })
  }
}

test('desktop logging survives a detached launcher pipe', { skip: !enabled, timeout: 60000 }, async () => {
  await desktop(async ({ app, page }) => {
    await app.evaluate(({ dialog }) => {
      globalThis.pipeDialogs = []
      dialog.showErrorBox = (title, message) => globalThis.pipeDialogs.push({ title, message })
    })
    app.process().stdout.destroy()
    await page.reload()
    await app.evaluate(async () => {
      // Playwright can keep a duplicate output handle open. Also deliver the exact asynchronous
      // stream error emitted by a launcher closing its pipe, outside the evaluation's try/catch.
      setImmediate(() => process.stdout.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })))
      setImmediate(() => process.stderr.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })))
      await new Promise(resolve => setTimeout(resolve, 100))
    })
    assert.deepEqual(await app.evaluate(() => globalThis.pipeDialogs), [])
  })
})

test(
  'full base catalog switches categories without long main-thread stalls',
  { skip: !enabled, timeout: 120000 },
  async () => {
    await desktop(async ({ app, page, expect }) => {
      await page.goto((process.env.ARCADIA_AUTHOR_TEST_ORIGIN || 'http://127.0.0.1:5183') + '/content')
      await page.getByRole('button', { name: '浏览内容（只读）', exact: true }).click()
      await expect(page.getByRole('heading', { name: '精灵', exact: true })).toBeVisible()
      await expect(page.locator('.content-card')).toHaveCount(60, { timeout: 30000 })
      const cdp = process.env.ARCADIA_AUTHOR_PROFILE ? await page.context().newCDPSession(page) : undefined
      if (cdp) {
        await cdp.send('Profiler.enable')
        await cdp.send('Profiler.start')
      }
      const timings = []
      for (const category of ['技能', '印记', '精灵', '技能']) {
        const duration = await page.evaluate(async name => {
          const button = [...document.querySelectorAll('nav[aria-label="内容分类"] button')].find(button =>
            button.textContent.trim().startsWith(name),
          )
          if (!button) throw new Error('Missing category ' + name)
          const start = performance.now()
          button.click()
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          return performance.now() - start
        }, category)
        await expect(page.getByRole('heading', { name: category, exact: true })).toBeVisible()
        timings.push({ category, ms: Math.round(duration) })
      }
      if (cdp) {
        const { profile } = await cdp.send('Profiler.stop')
        await writeFile('/tmp/arcadia-author-switch.cpuprofile', JSON.stringify(profile))
      }
      console.log('Category switch timings:', JSON.stringify(timings))
      assert.ok(
        timings.every(timing => timing.ms < 300),
        JSON.stringify(timings),
      )
      const categories = page.getByRole('navigation', { name: '技能类别' })
      for (const [label, category] of [
        ['物理', 'Physical'],
        ['特攻', 'Special'],
        ['属性', 'Status'],
        ['必杀', 'Climax'],
      ]) {
        await categories.getByRole('button', { name: new RegExp('^' + label) }).click()
        await expect(page.locator('.content-card').first()).toBeVisible()
        const displayed = await page
          .locator('.content-card .category-trait')
          .evaluateAll(nodes => nodes.map(node => node.dataset.category))
        assert.ok(displayed.length > 0 && displayed.every(value => value === category))
        await expect(page.locator('.content-card .element-icon').first()).toBeVisible()
      }
      await page.waitForFunction(() => {
        const icon = document.querySelector('.content-card .element-icon')
        return icon instanceof HTMLImageElement && icon.complete && icon.naturalWidth > 0
      })
      await page.screenshot({ path: '/tmp/arcadia-author-skill-categories.png' })
      await page.locator('.content-card').nth(15).click()
      const scroll = await page.locator('.object-library').evaluate(node => node.scrollTop)
      assert.ok(scroll > 0)
      await expect(page.locator('.page-heading .element-icon')).toBeVisible()
      await expect(page.locator('.record-form .element-icon')).toBeVisible()
      await expect(page.getByLabel('属性', { exact: true })).toBeDisabled()
      const navigation = page.getByRole('navigation', { name: '内容分类' })
      await navigation.getByRole('button', { name: /^精灵/ }).click()
      await navigation.getByRole('button', { name: /^技能/ }).click()
      await expect(page.getByLabel('属性', { exact: true })).toBeDisabled()
      await expect(categories.getByRole('button', { name: /^必杀/ })).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(() => page.locator('.object-library').evaluate(node => node.scrollTop)).toBe(scroll)
      // Search spans object types without changing the list or forcing a file-oriented view.
      await page.getByRole('searchbox', { name: '搜索内容' }).fill('pet_abao')
      await expect(page.locator('.library-entry[data-kind=species]')).toHaveCount(1)
      await page.locator('.library-entry[data-kind=species] .content-card').click()
      await expect(page.getByRole('button', { name: '技能、特性与纹章', exact: true })).toBeVisible()
      await expect(page.getByRole('searchbox', { name: '搜索内容' })).toHaveValue('pet_abao')
      await page.getByRole('button', { name: '← 返回上一项', exact: true }).click()
      await expect(page.getByLabel('威力', { exact: true })).toBeDisabled()
      await page
        .getByRole('navigation', { name: '内容分类' })
        .getByRole('button', { name: '资源', exact: true })
        .click()
      await expect(page.getByRole('heading', { name: '资源', exact: true })).toBeVisible()
      await expect(page.locator('.resource-list button[aria-pressed]')).toHaveCount(60)
      await page.getByRole('button', { name: /^显示更多资源/ }).click()
      await expect(page.locator('.resource-list button[aria-pressed]')).toHaveCount(120)
      await page.getByRole('searchbox', { name: '搜索资源' }).fill('icon:pet_abao')
      await expect(page.locator('.resource-list button[aria-pressed]')).toHaveCount(1)
      await expect(page.locator('.resource-list')).toContainText('1 处使用')
    })
  },
)
