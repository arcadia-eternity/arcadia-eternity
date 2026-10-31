import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)

test(
  'unified content workspace edits independent objects, exposes live MCP context and preserves reviewed saves',
  {
    timeout: 120000,
    skip: process.env.ARCADIA_AUTHOR_GUI_TEST !== '1',
  },
  async () => {
    const { _electron, expect } = require('playwright/test')
    const root = await mkdtemp(join(tmpdir(), 'arcadia-library-'))
    const origin = process.env.ARCADIA_AUTHOR_TEST_ORIGIN || 'http://127.0.0.1:5183'
    const main = fileURLToPath(new URL('../main.mjs', import.meta.url))
    const entry = join(root, 'entry.mjs')
    await writeFile(
      entry,
      `import {app} from 'electron';app.setPath('userData',${JSON.stringify(join(root, 'data'))});await import(${JSON.stringify(pathToFileURL(main).href)});`,
    )
    const env = { ...process.env, ARCADIA_ELECTRON_DEV_SERVER_URL: origin }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.NODE_TEST_CONTEXT
    let app, page, client
    try {
      app = await _electron.launch({ executablePath: require('electron'), args: [entry], env })
      page = await app.firstWindow()
      page.setDefaultTimeout(15000)
      await page.goto(origin + '/content')
      await page.getByRole('button', { name: '新建内容包', exact: true }).click()
      await page.getByLabel('内容包名称', { exact: true }).fill('独立对象验收')
      await page.getByRole('button', { name: '创建并打开', exact: true }).click()
      await page.getByRole('heading', { name: '精灵', exact: true }).waitFor()
      await expect(page.locator('.project-settings')).toHaveCount(0)
      await expect(page.locator('.savebar')).toHaveCount(0)
      const toolbar = await page.locator('.app-header').boundingBox()
      assert.ok(toolbar.height <= 64, `Clean toolbar should fit one row, got ${toolbar.height}`)
      const [project] = await page.evaluate(async () => (await window.arcadiaDesktop.author({ action: 'list' })).result)
      const category = name => page.getByRole('navigation', { name: '内容分类' }).getByRole('button', { name })
      const save = async count => {
        await page.getByRole('button', { name: /^查看并保存/ }).click()
        await page.getByRole('button', { name: '确认保存', exact: true }).click()
        await expect(page.getByRole('status').filter({ hasText: `已保存 ${count} 个源文件。` })).toBeVisible()
      }
      // A mark is a first-class starting point, with no creature required.
      await page.getByRole('button', { name: '新建内容', exact: true }).click()
      await page.getByLabel('内容类型', { exact: true }).selectOption('marks')
      await page.getByLabel('显示名称', { exact: true }).fill('光辉印记')
      await page.getByText('对象标识与保存位置', { exact: true }).click()
      await page.getByLabel('稳定标识', { exact: true }).fill('radiance')
      await page.getByRole('button', { name: '创建草稿', exact: true }).click()
      await expect(page.getByRole('heading', { name: '光辉印记草稿' })).toBeVisible()
      await assert.rejects(readFile(join(project.directory, 'data/marks/radiance.yaml')))
      await save(2)
      assert.match(await readFile(join(project.directory, 'data/marks/radiance.yaml'), 'utf8'), /id: radiance/)
      await expect(category(/^全部内容/)).toHaveCount(0)
      await expect(page.locator('.pick-object')).toHaveCount(0)
      await category(/^技能/).click()
      await page.locator('.content-card').filter({ hasText: '霜击' }).click()
      await expect(page.getByRole('region', { name: '对象列表' })).toBeVisible()
      await expect(page.locator('.content-card .object-icon')).toHaveCount(0)
      await page.getByLabel('威力', { exact: true }).fill('77')
      // Navigation retains the draft; translation is an object field, not the meaning of selection.
      await category(/^印记/).click()
      await page.locator('.content-card').filter({ hasText: '光辉印记' }).click()
      await page.getByRole('region', { name: '对象编辑' }).getByRole('button', { name: '多语言', exact: true }).click()
      await page.getByLabel('添加编辑语言', { exact: true }).fill('en')
      await page.getByRole('button', { name: '切换语言', exact: true }).click()
      await page.getByLabel('显示名称', { exact: true }).fill('Radiance')
      await page.getByLabel('描述', { exact: true }).fill('A shared radiant mark.')
      const config = await page.evaluate(
        async id => (await window.arcadiaDesktop.author({ action: 'connection', id })).result,
        project.id,
      )
      const requireAuthor = createRequire(new URL('../../../content-dev/package.json', import.meta.url))
      const { Client } = await import(requireAuthor.resolve('@modelcontextprotocol/sdk/client/index.js'))
      const { StdioClientTransport } = await import(requireAuthor.resolve('@modelcontextprotocol/sdk/client/stdio.js'))
      client = new Client({ name: 'workbench-gui', version: '1' })
      await client.connect(new StdioClientTransport({ ...config.mcpServers.arcadia, stderr: 'pipe' }))
      const context = async () =>
        (await client.callTool({ name: 'workspace_context', arguments: {} })).structuredContent.result
      await expect.poll(async () => (await context()).state?.drafts.length).toBe(2)
      assert.equal((await context()).state.language, 'en')
      assert.equal((await context()).state.drafts.find(row => row.kind === 'skills').value.power, 77)
      await category(/^技能/).click()
      await expect(page.getByLabel('威力', { exact: true })).toHaveValue('77')
      await expect.poll(async () => (await context()).state?.focus?.id).toBe('strike')
      // An external AI writes the disk version; it cannot silently overwrite the unsaved form.
      const file = 'data/skills/strike.yaml'
      const source = (await client.callTool({ name: 'source_read', arguments: { file } })).structuredContent.result
      assert.match(source.text, /power: 40/)
      const write = await client.callTool({
        name: 'source_apply',
        arguments: {
          file,
          expectedVersion: source.version,
          text: source.text.replace('power: 40', 'power: 81'),
        },
      })
      assert.equal(write.isError, undefined)
      const skillFile = join(project.directory, file)
      await page.getByRole('button', { name: '核对外部变化', exact: true }).waitFor()
      await expect(page.getByLabel('威力', { exact: true })).toHaveValue('77')
      await expect.poll(async () => (await context()).state?.drafts.some(row => row.conflict)).toBe(true)
      await page.getByRole('button', { name: '核对外部变化', exact: true }).click()
      await page.getByLabel('这一项保留哪个值？').selectOption('draft')
      await page.getByRole('button', { name: '按选择更新草稿', exact: true }).click()
      await save(2)
      assert.match(await readFile(skillFile, 'utf8'), /power: 77/)
      assert.match(await readFile(join(project.directory, 'locales/en/mark.yaml'), 'utf8'), /A shared radiant mark/)
      // Import is an actual copy; binding stays a separate, reviewed object edit.
      const asset = join(root, 'sample.png')
      await writeFile(
        asset,
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNXYAAAAASUVORK5CYII=',
          'base64',
        ),
      )
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
      }, asset)
      await category('资源').click()
      await page.getByRole('button', { name: '导入资源', exact: true }).click()
      await page.locator('.media-preview img').waitFor()
      const imported = await page.locator('.resource-list button').filter({ hasText: 'sample.png' }).textContent()
      assert.match(imported, /sample.png/)
      await category(/^精灵/).click()
      await page.locator('.content-card').filter({ hasText: 'Frostling' }).click()
      await page.getByRole('button', { name: '技能、特性与纹章', exact: true }).click()
      await page
        .locator('.reference-group')
        .filter({ hasText: '学习技能' })
        .getByRole('button', { name: '新建并关联', exact: true })
        .click()
      await page.getByLabel('显示名称', { exact: true }).fill('Radiant Strike')
      await page.getByText('对象标识与保存位置', { exact: true }).click()
      await page.getByLabel('稳定标识', { exact: true }).fill('radiant-strike')
      await page.getByRole('button', { name: '创建草稿', exact: true }).click()
      await save(4)
      assert.match(
        await readFile(join(project.directory, 'data/skills/radiant-strike.yaml'), 'utf8'),
        /id: radiant-strike/,
      )
      await page.getByRole('button', { name: '← 返回上一项', exact: true }).click()
      await expect(page.locator('.reference-group').filter({ hasText: '学习技能' })).toContainText('Radiant Strike')
      await page.getByRole('button', { name: '形象与声音', exact: true }).click()
      await page
        .locator('.media-slot')
        .filter({ hasText: '图标' })
        .getByRole('button', { name: '选择已有资源…', exact: true })
        .click()
      await page
        .locator('.choice-picker')
        .getByRole('button', { name: /sample.png/ })
        .click()
      const speciesBefore = await readFile(join(project.directory, 'data/species/pet.yaml'), 'utf8')
      await save(1)
      assert.equal(await readFile(join(project.directory, 'data/species/pet.yaml'), 'utf8'), speciesBefore)
      assert.match(await readFile(join(project.directory, 'data/presentations/main.yaml'), 'utf8'), /sample/)
      await category('资源').click()
      await page.locator('.resource-list button').filter({ hasText: 'sample.png' }).click()
      await expect(page.locator('.asset-detail')).toContainText('Frostling')
      // Moving the bytes only changes one resource location; the binding and rules stay stable.
      const mediaBefore = await readFile(join(project.directory, 'data/presentations/main.yaml'), 'utf8')
      const oldLocation = await page.getByLabel('素材位置', { exact: true }).inputValue()
      const newLocation = oldLocation.replace('sample.png', 'relocated.png')
      await rename(join(project.directory, oldLocation), join(project.directory, newLocation))
      await page.getByLabel('素材位置', { exact: true }).fill(newLocation)
      await page.getByLabel('素材位置', { exact: true }).press('Tab')
      await save(1)
      assert.equal(await readFile(join(project.directory, 'data/presentations/main.yaml'), 'utf8'), mediaBefore)
      assert.equal(await readFile(join(project.directory, 'data/species/pet.yaml'), 'utf8'), speciesBefore)
      await expect(page.locator('.asset-detail')).toContainText('Frostling')
      await category(/^技能/).click()
      await page.screenshot({ path: '/tmp/arcadia-author-library.png', fullPage: true })
      await page.setViewportSize({ width: 390, height: 844 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
      await page.setViewportSize({ width: 1280, height: 900 })
      // A legacy base-package layout opens as a read-only reference library.
      const base = join(root, 'base')
      await mkdir(join(base, 'data'), { recursive: true })
      await mkdir(join(base, 'locales/zh-CN'), { recursive: true })
      await writeFile(join(base, 'package.json'), JSON.stringify({ name: '@arcadia-eternity/data-pack-base' }))
      await writeFile(
        join(base, 'pack.json'),
        JSON.stringify({ id: 'arcadia-eternity.base', data: { skills: ['skill.yaml'] } }),
      )
      await writeFile(
        join(base, 'data/skill.yaml'),
        '- id: base-hit\n  power: 40\n  element: Normal\n  category: Physical\n',
      )
      await writeFile(join(base, 'locales/zh-CN/skill.yaml'), 'base-hit: {name: 基础打击}\n')
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
      }, base)
      await page.locator('.project-switch').click()
      await page.getByRole('button', { name: '打开项目', exact: true }).click()
      await expect(page.locator('.app-header .badge')).toHaveText('只读')
      await expect.poll(async () => (await context()).connected).toBe(false)
      await expect(page.getByRole('button', { name: '新建内容', exact: true })).toHaveCount(0)
      await category(/^技能/).click()
      await page.locator('.content-card').filter({ hasText: '基础打击' }).click()
      await expect(page.getByLabel('威力', { exact: true })).toBeDisabled()
      await expect(page.getByLabel('显示名称', { exact: true })).toBeDisabled()
      await expect(page.getByRole('button', { name: '请 AI 帮忙', exact: true })).toHaveCount(0)
      const baseEntry = await page.evaluate(async () =>
        (await window.arcadiaDesktop.author({ action: 'list' })).result.find(row => row.name === '基础包'),
      )
      for (const action of ['save-changes', 'import-asset', 'sdk', 'start']) {
        const result = await page.evaluate(
          async ({ id, action }) => window.arcadiaDesktop.author({ action, id, changes: [], kind: 'check' }),
          { id: baseEntry.id, action },
        )
        assert.equal(result.error?.code, 'WRITE_DISABLED')
      }
      const baseConfig = await page.evaluate(
        async id => (await window.arcadiaDesktop.author({ action: 'connection', id, execute: true })).result,
        baseEntry.id,
      )
      assert.ok(baseConfig.mcpServers.arcadia.args.includes('--read-only'))
      assert.ok(!baseConfig.mcpServers.arcadia.args.includes('--execute'))
      assert.match(await readFile(join(base, 'data/skill.yaml'), 'utf8'), /power: 40/)
      await page.screenshot({ path: '/tmp/arcadia-author-base-readonly.png', fullPage: true })
    } catch (error) {
      await page?.screenshot({ path: '/tmp/arcadia-library-failure.png', fullPage: true }).catch(() => {})
      console.error(
        await page
          ?.locator('body')
          .innerText()
          .catch(() => 'No page'),
      )
      throw error
    } finally {
      await client?.close().catch(() => {})
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
