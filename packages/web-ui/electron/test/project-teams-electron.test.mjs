import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
const require = createRequire(import.meta.url)

test(
  'project libraries survive candidate replacement and app restart, conflict safely, and run the same team on both sides',
  {
    timeout: 120000,
    skip: process.env.ARCADIA_AUTHOR_GUI_TEST !== '1',
  },
  async () => {
    const { _electron, expect } = require('playwright/test')
    const root = await mkdtemp(join(tmpdir(), 'arcadia-project-library-gui-'))
    const origin = process.env.ARCADIA_AUTHOR_TEST_ORIGIN || 'http://127.0.0.1:5183'
    const entry = join(root, 'entry.mjs')
    await writeFile(
      entry,
      `import { app } from 'electron';app.setPath('userData',${JSON.stringify(join(root, 'data'))});await import(${JSON.stringify(new URL('../main.mjs', import.meta.url).href)});`,
    )
    const env = { ...process.env, ARCADIA_ELECTRON_DEV_SERVER_URL: origin }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.NODE_TEST_CONTEXT
    let app, mcp
    const sdkRequire = createRequire(new URL('../../../content-dev/package.json', import.meta.url))
    const { Client } = await import(sdkRequire.resolve('@modelcontextprotocol/sdk/client/index.js'))
    const { StdioClientTransport } = await import(sdkRequire.resolve('@modelcontextprotocol/sdk/client/stdio.js'))
    const call = async (name, args = {}) => {
      const response = await mcp.callTool({ name, arguments: args })
      assert.notEqual(response.isError, true, JSON.stringify(response))
      return response.structuredContent.result
    }
    const saveTeam = async (id, change) => {
      const { version, ...document } = (await call('team_list')).items.find(team => team.id === id)
      return call('team_save', { document: { ...document, ...change }, expectedVersion: version })
    }
    const launch = async () => {
      app = await _electron.launch({ executablePath: require('electron'), args: [entry], env })
      const page = await app.firstWindow()
      page.setDefaultTimeout(15000)
      await page.waitForURL(url => url.origin === origin)
      await page.waitForFunction(() => !!window.__APP_DEBUG__ && !!window.arcadiaDesktop)
      return page
    }
    const stop = async () => {
      await app.evaluate(({ app }) => app.exit(0))
      await app.close()
    }
    try {
      let page = await launch()
      const project = await page.evaluate(
        async () => (await window.arcadiaDesktop.author({ action: 'create', name: '项目队伍验收' })).result,
      )
      mcp = new Client({ name: 'live-preview-test', version: '1' })
      await mcp.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [fileURLToPath(new URL('../../../content-dev/src/mcp.ts', import.meta.url)), project.directory],
          stderr: 'pipe',
        }),
      )
      await page.goto(`${origin}/content/edit/${project.id}`)
      await page.getByRole('heading', { name: '精灵', exact: true }).waitFor()
      const open = async () => {
        const opened = app.waitForEvent('window', { timeout: 45000 })
        await page.getByRole('button', { name: '调试试玩', exact: true }).click()
        const preview = await opened
        await preview.getByRole('heading', { name: '测试队伍', exact: true }).waitFor()
        return preview
      }
      let preview = await open()
      // Keep the common path compact; make the edited side and persistence state explicit.
      await expect(preview.getByRole('button', { name: '管理环境', exact: true })).toHaveCount(0)
      await expect(preview.getByRole('button', { name: '删除队伍', exact: true })).toHaveCount(0)
      await expect(preview.getByRole('button', { name: '保存队伍', exact: true })).toBeDisabled()
      const editorBox = await preview.getByLabel('精灵名称', { exact: true }).boundingBox()
      assert.ok(editorBox.y < 550, 'pet editing should be visible on the initial desktop viewport')
      await preview.getByRole('button', { name: '编辑对方队伍', exact: true }).click()
      await expect(preview.getByRole('region', { name: '当前队伍操作' })).toContainText('Orange')
      await preview.getByRole('button', { name: '编辑我方队伍', exact: true }).click()
      await expect(preview.getByRole('region', { name: '当前队伍操作' })).toContainText('Blue')
      // A real stdio MCP save must reach the already focused page through its project watcher.
      await preview.bringToFront()
      await preview.evaluate(() => {
        window.__previewFocusCount = 0
        window.addEventListener('focus', () => window.__previewFocusCount++)
      })
      await saveTeam('orange', { name: 'MCP即刻队伍' })
      await expect(preview.getByLabel('对方队伍', { exact: true }).locator('option:checked')).toContainText(
        'MCP即刻队伍',
      )
      assert.equal(await preview.evaluate(() => window.__previewFocusCount), 0)
      const errors = []
      preview.on('pageerror', error => errors.push(error.message))
      await preview.getByLabel('精灵名称', { exact: true }).fill('已保存项目精灵')
      await expect(preview.getByRole('status').filter({ hasText: '有修改未保存到项目' })).toBeVisible()
      await preview.getByRole('button', { name: '保存队伍', exact: true }).click()
      const file = join(project.directory, 'debug/teams/blue.yaml')
      await expect.poll(async () => YAML.parse(await readFile(file, 'utf8')).team[0].name).toBe('已保存项目精灵')
      assert.equal(YAML.parse(await readFile(file, 'utf8')).team[0].id, undefined)
      await expect(preview.getByRole('status').filter({ hasText: '已保存到项目' })).toBeVisible()
      await preview.getByLabel('精灵名称', { exact: true }).fill('重启保留的草稿')
      // Close immediately: persistence cannot depend on the editor's save debounce.
      await preview.close()
      await stop()
      page = await launch()
      await page.goto(`${origin}/content/edit/${project.id}`)
      await page.getByRole('heading', { name: '精灵', exact: true }).waitFor()
      preview = await open()
      await expect(preview.getByLabel('精灵名称', { exact: true })).toHaveValue('重启保留的草稿')
      assert.equal(YAML.parse(await readFile(file, 'utf8')).team[0].name, '已保存项目精灵')
      await saveTeam('blue', { name: 'Git外部队伍' })
      // The conflict is visible before Save, without reopening or refocusing the page.
      await expect(preview.locator('.save-status')).toContainText('项目文件已在外部修改')
      await expect(preview.getByLabel('精灵名称', { exact: true })).toHaveValue('重启保留的草稿')
      await preview.getByRole('button', { name: '保存队伍', exact: true }).click()
      await expect(preview.getByRole('alert').filter({ hasText: '文件已在外部修改' })).toBeVisible()
      await expect(preview.getByLabel('精灵名称', { exact: true })).toHaveValue('重启保留的草稿')
      await preview.getByRole('button', { name: '复制当前队伍', exact: true }).click()
      await preview.getByLabel('队伍名称', { exact: true }).fill('客户端重命名副本')
      await preview.getByRole('button', { name: '确认名称', exact: true }).click()
      await expect(preview.getByLabel('我方队伍', { exact: true }).locator('option:checked')).toContainText(
        '客户端重命名副本',
      )
      await preview.getByRole('button', { name: '保存队伍', exact: true }).click()
      await expect.poll(async () => (await readdir(join(project.directory, 'debug/teams'))).length).toBe(3)
      const selected = await preview.getByLabel('我方队伍', { exact: true }).inputValue()
      await preview.getByLabel('对方队伍', { exact: true }).selectOption(selected)
      await expect(preview.getByText('双方使用同一套队伍，编辑会同步应用到双方。')).toBeVisible()
      // A real extra-source environment is prepared through the same singleton owner.
      const other = await page.evaluate(
        async () => (await window.arcadiaDesktop.author({ action: 'create', name: '协作源码包' })).result,
      )
      await app.evaluate(({ dialog }, directory) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
      }, other.directory)
      await preview.getByRole('button', { name: /当前包与正式依赖/ }).click()
      await preview.getByRole('button', { name: '新建环境', exact: true }).click()
      await preview.getByLabel('环境名称', { exact: true }).fill('真实双包环境')
      await preview.getByRole('button', { name: '添加本机源码包', exact: true }).click()
      await preview.getByRole('button', { name: '保存环境配置', exact: true }).click()
      const replacement = app.waitForEvent('window', { timeout: 45000 })
      await preview.getByRole('button', { name: '准备所选环境', exact: true }).click()
      preview = await replacement
      await preview.getByRole('heading', { name: '测试队伍', exact: true }).waitFor()
      await expect(preview.getByLabel('精灵名称', { exact: true })).toHaveValue('重启保留的草稿')
      await expect(preview.getByLabel('对方队伍', { exact: true })).toHaveValue(selected)
      assert.equal(app.windows().length, 2)
      await preview.getByRole('button', { name: /真实双包环境.*已准备/ }).click()
      await preview.getByRole('button', { name: '管理环境', exact: true }).click()
      await preview.getByLabel('环境名称', { exact: true }).fill('真实双包环境改名')
      const { version: environmentVersion, ...environmentDocument } = (await call('environment_list')).items.find(
        environment => environment.name === '真实双包环境',
      )
      await call('environment_save', {
        document: { ...environmentDocument, name: 'MCP环境变更' },
        expectedVersion: environmentVersion,
      })
      await expect(preview.getByRole('status').filter({ hasText: '环境文件已在外部修改' })).toBeVisible()
      await expect(preview.getByLabel('环境名称', { exact: true })).toHaveValue('真实双包环境改名')
      await expect(preview.getByRole('button', { name: '开始对战', exact: true })).toBeDisabled()
      await preview.getByRole('button', { name: '取消', exact: true }).click()
      await preview.getByRole('button', { name: '管理环境', exact: true }).click()
      await expect(preview.getByLabel('环境名称', { exact: true })).toHaveValue('MCP环境变更')
      await preview.getByLabel('环境名称', { exact: true }).fill('真实双包环境改名')
      await preview.getByRole('button', { name: '保存环境配置', exact: true }).click()
      await expect(preview.getByRole('button', { name: '开始对战', exact: true })).toBeDisabled()
      const updatedEnvironment = app.waitForEvent('window', { timeout: 45000 })
      await preview.getByRole('button', { name: '准备所选环境', exact: true }).click()
      preview = await updatedEnvironment
      await preview.getByRole('heading', { name: '测试队伍', exact: true }).waitFor()
      await preview.getByRole('button', { name: '开始对战', exact: true }).click()
      await preview.waitForURL(/\/battle\?authorPreview=/)
      const players = await preview.evaluate(
        async () =>
          (await window.__APP_DEBUG__.pinia._s.get('battle').battleInterface.getState(undefined, true)).players,
      )
      assert.equal(players[0].team[0].name, '重启保留的草稿')
      assert.equal(players[1].team[0].name, '重启保留的草稿')
      await saveTeam(selected, { name: 'MCP战斗中修改' })
      assert.deepEqual(
        await preview.evaluate(
          async () =>
            (await window.__APP_DEBUG__.pinia._s.get('battle').battleInterface.getState(undefined, true)).players,
        ),
        players,
        'MCP saved-team changes must not replace active battle players',
      )
      const ids = players.flatMap(player => [player.id, ...player.team.map(pet => pet.id)])
      assert.equal(new Set(ids).size, ids.length)
      assert.equal(await preview.evaluate(() => window.__APP_DEBUG__.pinia._s.has('petStorage')), false)
      assert.deepEqual(errors, [])
      const lockFiles = (await readdir(join(project.directory, 'debug/environments'))).filter(file =>
        file.endsWith('.package-lock.json'),
      )
      assert.equal(lockFiles.length, 1)
      assert.ok(
        !(await readFile(join(project.directory, 'debug/environments', lockFiles[0]), 'utf8')).includes(
          project.directory,
        ),
      )
      await stop()
      page = await launch()
      await page.goto(`${origin}/content/edit/${project.id}`)
      await page.getByRole('heading', { name: '精灵', exact: true }).waitFor()
      preview = await open()
      await expect(preview.getByRole('button', { name: /真实双包环境改名.*已准备/ })).toBeVisible()
      await preview.getByRole('button', { name: /真实双包环境改名.*已准备/ }).click()
      await expect(preview.getByLabel('我方队伍', { exact: true })).toHaveValue(selected)
      const orangeFile = join(project.directory, 'debug/teams/orange.yaml')
      await rm(orangeFile)
      const afterDeletion = app.waitForEvent('window', { timeout: 45000 })
      await preview.getByRole('button', { name: '准备所选环境', exact: true }).click()
      preview = await afterDeletion
      await preview.getByRole('heading', { name: '测试队伍', exact: true }).waitFor()
      await expect(preview.getByRole('status').filter({ hasText: 'orange' })).toBeVisible()
      await expect(preview.getByRole('button', { name: '复制当前队伍', exact: true })).toBeEnabled()
    } finally {
      await mcp?.close().catch(() => {})
      if (app) {
        await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
        await app.close().catch(() => {})
      }
      await rm(root, { recursive: true, force: true })
    }
  },
)
