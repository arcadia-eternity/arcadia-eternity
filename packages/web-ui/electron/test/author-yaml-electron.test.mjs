import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, rename, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)

test(
  'desktop YAML forms preserve sharing and draft conflicts through real file changes',
  {
    timeout: 90000,
    skip: process.env.ARCADIA_AUTHOR_GUI_TEST !== '1',
  },
  async () => {
    const { _electron, expect } = require('playwright/test')
    const root = await mkdtemp(join(tmpdir(), 'arcadia-yaml-desktop-'))
    const project = join(root, 'project'),
      userData = join(root, 'app-data')
    const file = join(project, 'data/marks/status.yaml')
    const origin = process.env.ARCADIA_AUTHOR_TEST_ORIGIN || 'http://127.0.0.1:5185'
    await mkdir(join(project, 'data/marks'), { recursive: true })
    await mkdir(join(userData, 'ugc/state'), { recursive: true })
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({ name: 'yaml-test', arcadia: { projectId: 'yaml-test', namespace: 'yaml-test', sdkApi: 2 } }),
    )
    await writeFile(
      file,
      `# shared status
- id: first
  name: First
  config: &status
    duration: 3 # turns
    maxStacks: 6
- id: second
  name: Second
  config: *status
- id: override
  name: Override
  config:
    <<: *status
    duration: 5
`,
    )
    await writeFile(
      join(userData, 'ugc/state/projects.json'),
      JSON.stringify([{ id: 'yaml', name: 'YAML test', directory: await realpath(project) }]),
    )
    const entry = join(root, 'entry.mjs')
    const main = fileURLToPath(new URL('../main.mjs', import.meta.url))
    await writeFile(
      entry,
      `import {app} from 'electron';app.setPath('userData',${JSON.stringify(userData)});await import(${JSON.stringify(pathToFileURL(main).href)});`,
    )
    const env = { ...process.env, ARCADIA_ELECTRON_DEV_SERVER_URL: origin }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.NODE_TEST_CONTEXT
    let app, page
    try {
      app = await _electron.launch({ executablePath: require('electron'), args: [entry], env })
      page = await app.firstWindow()
      page.setDefaultTimeout(15000)
      await page.goto(origin + '/creator')
      await page.getByText('打开内容包源项目', { exact: true }).waitFor({ timeout: 45000 })
      await page.locator('.project-settings select').first().selectOption('yaml')
      await page.locator('nav').getByRole('button', { name: /^印记/ }).click()
      await page.locator('.content-card').filter({ hasText: 'second' }).click()
      const duration = page.getByLabel('持续回合（-1 为无限）', { exact: true })
      await expect(duration).toHaveValue('3')
      await expect(duration).toBeDisabled()
      await page.locator('.sharing summary').click()
      await expect(page.locator('.sharing')).toContainText('status')
      const save = async () => {
        await page.getByRole('button', { name: /^查看并保存/ }).click()
        await page.getByRole('button', { name: '确认保存', exact: true }).click()
        await expect(page.getByRole('status').filter({ hasText: '已保存 1 个源文件。' })).toBeVisible()
      }
      await page.getByLabel('标签', { exact: true }).fill('renamed')
      await page.getByLabel('标签', { exact: true }).blur()
      await save()
      let text = await readFile(file, 'utf8')
      assert.match(text, /config: &status/)
      assert.match(text, /config: \*status/)
      assert.match(text, /# turns/)
      assert.match(text, /tags:\s+- renamed/)
      await writeFile(file, text.replace('duration: 3', 'duration: 4'))
      await expect(duration).toHaveValue('4')
      await page.getByLabel('标签', { exact: true }).fill('draft')
      await page.getByLabel('标签', { exact: true }).blur()
      text = await readFile(file, 'utf8')
      await writeFile(file, text.replace('duration: 4', 'duration: 8'))
      await page.getByRole('button', { name: '核对外部变化', exact: true }).waitFor()
      await expect(page.getByLabel('标签', { exact: true })).toHaveValue('draft')
      await page.getByRole('button', { name: '放弃修改', exact: true }).click()
      await page.getByRole('button', { name: '确认放弃修改', exact: true }).click()
      await expect(duration).toHaveValue('8')
      await page.getByRole('navigation', { name: '内容分类' }).getByRole('button', { name: /^印记/ }).click()
      await page.locator('.content-card').filter({ hasText: 'override' }).click()
      await expect(duration).toBeEnabled()
      await expect(page.getByLabel('最多层数', { exact: true })).toBeDisabled()
      await duration.fill('9')
      await save()
      assert.match(await readFile(file, 'utf8'), /<<: \*status\s+duration: 9/)
      // External moves relocate an existing draft after review, without recreating the old source.
      await duration.fill('10')
      const moved = join(project, 'data/marks/moved.yaml')
      await rename(file, moved)
      await page.getByRole('button', { name: '核对外部变化', exact: true }).click()
      await expect(page.getByText('对象的来源位置已改变。完成核对后，草稿将使用新的位置。')).toBeVisible()
      await page.getByLabel('这一项保留哪个值？').selectOption('draft')
      await page.getByRole('button', { name: '按选择更新草稿', exact: true }).click()
      assert.match(await readFile(moved, 'utf8'), /duration: 9/)
      await save()
      await assert.rejects(access(file), { code: 'ENOENT' })
      assert.match(await readFile(moved, 'utf8'), /<<: \*status\s+duration: 10/)
      if (process.env.ARCADIA_AUTHOR_SCREENSHOT)
        await page.screenshot({ path: process.env.ARCADIA_AUTHOR_SCREENSHOT, fullPage: true })
    } catch (error) {
      console.error(
        await page
          ?.locator('body')
          .innerText()
          .catch(() => 'No page'),
      )
      await page?.screenshot({ path: '/tmp/arcadia-author-yaml-failure.png', fullPage: true }).catch(() => {})
      throw error
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
  },
)
