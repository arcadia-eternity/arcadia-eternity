import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)

test(
  'desktop source workflow edits real files, preserves external conflicts and runs the actual pack tests',
  {
    timeout: 180000,
    skip: process.env.ARCADIA_AUTHOR_GUI_TEST !== '1',
  },
  async () => {
    const { _electron, expect } = require('playwright/test')
    const root = await mkdtemp(join(tmpdir(), 'arcadia-author-desktop-'))
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
    let app, page
    try {
      app = await _electron.launch({ executablePath: require('electron'), args: [entry], env })
      page = await app.firstWindow()
      page.setDefaultTimeout(15000)
      await page.goto(origin + '/creator')
      await page.getByText('打开内容包源项目', { exact: true }).waitFor({ timeout: 45000 })
      await page.getByLabel('新项目名称').fill('寒霜工作区验收')
      await page.getByRole('button', { name: '从模板创建项目', exact: true }).click()
      await page.getByRole('heading', { name: '精灵', exact: true }).waitFor()
      const projects = await page.evaluate(async () => (await window.arcadiaDesktop.author({ action: 'list' })).result)
      assert.equal(projects.length, 1)
      const project = projects[0]
      assert.ok(project.directory.startsWith(await realpath(join(root, 'data/ugc/projects'))))
      const category = name => page.getByRole('navigation', { name: '内容分类' }).getByRole('button', { name })
      const save = async count => {
        await page.getByRole('button', { name: /^查看并保存/ }).click()
        await page.getByRole('button', { name: '确认保存', exact: true }).click()
        await expect(page.getByRole('status').filter({ hasText: `已保存 ${count} 个源文件。` })).toBeVisible()
      }
      await category(/^技能/).click()
      await page.locator('.content-card').filter({ hasText: '霜击' }).click()
      await page.getByLabel('威力', { exact: true }).fill('63')
      await page.getByLabel('显示名称', { exact: true }).fill('霜击改')
      await expect(page.locator('.description-preview')).toContainText('63')
      // Both object and locale drafts survive navigation, and are reviewed together.
      await category(/^精灵/).click()
      await category(/^技能/).click()
      await page.locator('.content-card').filter({ hasText: '霜击改' }).click()
      await expect(page.getByLabel('威力', { exact: true })).toHaveValue('63')
      await save(2)
      const file = join(project.directory, 'data/skills/strike.yaml')
      assert.match(await readFile(file, 'utf8'), /power: 63/)
      assert.match(await readFile(file, 'utf8'), /# Skill behavior/)
      assert.match(await readFile(join(project.directory, 'locales/zh-CN/skill.yaml'), 'utf8'), /name: 霜击改/)
      await page.getByLabel('威力', { exact: true }).fill('70')
      await writeFile(file, (await readFile(file, 'utf8')).replace('power: 63', 'power: 80'))
      await page.getByRole('button', { name: '核对外部变化', exact: true }).waitFor()
      await expect(page.getByLabel('威力', { exact: true })).toHaveValue('70')
      await page.getByRole('button', { name: '核对外部变化', exact: true }).click()
      await page.getByLabel('这一项保留哪个值？').selectOption('draft')
      await page.getByRole('button', { name: '按选择更新草稿', exact: true }).click()
      assert.match(await readFile(file, 'utf8'), /power: 80/)
      await save(1)
      assert.match(await readFile(file, 'utf8'), /power: 70/)
      await page.getByLabel('威力', { exact: true }).fill('75')
      await page.getByRole('button', { name: '放弃修改', exact: true }).click()
      await page.getByRole('button', { name: '确认放弃修改', exact: true }).click()
      await expect(page.getByLabel('威力', { exact: true })).toHaveValue('70')
      // Existing references are searchable and navigate without losing the selected object.
      await category(/^精灵/).click()
      await page.locator('.content-card').filter({ hasText: '霜团' }).click()
      await page.getByRole('button', { name: '技能、特性与纹章', exact: true }).click()
      const learning = page.locator('.reference-group').filter({ hasText: '学习技能' })
      await learning.getByRole('button', { name: '移除关联', exact: true }).last().click()
      await learning.getByRole('button', { name: '关联已有技能…', exact: true }).click()
      await page.getByLabel('搜索选择技能', { exact: true }).fill('轻触')
      await page.locator('.choice-picker').getByRole('button', { name: /轻触/ }).click()
      await learning.getByLabel('学习等级').first().fill('2')
      await learning.getByRole('button', { name: '霜击改 ↗', exact: true }).click()
      await expect(page.getByLabel('威力', { exact: true })).toHaveValue('70')
      await page.getByRole('button', { name: '← 返回上一项', exact: true }).click()
      await expect(learning.getByLabel('学习等级').first()).toHaveValue('2')
      await save(1)
      await category(/^印记/).click()
      await page.locator('.content-card').filter({ hasText: '减速' }).click()
      await page.getByLabel('显示名称', { exact: true }).fill('霜冻减速')
      await save(1)
      await category('资源').click()
      await page.locator('.resource-list').getByRole('button', { name: /^slow/ }).click()
      await page.locator('.media-preview img').waitFor()
      assert.equal(
        await page.locator('.media-preview img').evaluate(image => image.complete && image.naturalWidth > 0),
        true,
      )
      await page.locator('.asset-detail').getByRole('button', { name: '霜冻减速 ↗', exact: true }).click()
      await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('霜冻减速')
      // The starter's own scenario asserts its original localized skill name.
      await category(/^技能/).click()
      await page.locator('.content-card').filter({ hasText: '霜击改' }).click()
      await page.locator('.author-description').getByRole('button', { name: '霜冻减速', exact: true }).click()
      await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('霜冻减速')
      await page.getByRole('button', { name: '← 返回上一项', exact: true }).click()
      await page.getByLabel('显示名称', { exact: true }).fill('霜击')
      await save(1)
      await expect(category('检查与运行')).toHaveCount(0)
      const runPanel = page.getByRole('region', { name: '输出', exact: true })
      const toggleRuns = runPanel.getByRole('button', { name: /输出/ })
      const run = async name => {
        await page.getByText('更多操作', { exact: true }).click()
        await page.getByRole('button', { name, exact: true }).click()
      }
      // Failed runs reveal their diagnostics without replacing the selected editor.
      const invalidSource = join(project.directory, 'src/__invalid.ts')
      await writeFile(invalidSource, 'export const invalid: string = 123\n')
      await run('检查内容与类型')
      await toggleRuns.click()
      await expect(toggleRuns).toHaveAttribute('aria-expanded', 'false')
      await runPanel.getByRole('heading', { name: '检查 · 未完成', exact: true }).waitFor({ timeout: 45000 })
      await expect(toggleRuns).toHaveAttribute('aria-expanded', 'true')
      await expect(page.getByLabel('威力', { exact: true })).toHaveValue('70')
      await toggleRuns.click()
      // Later polling of the same historical failure must respect the user's collapse.
      await page.waitForTimeout(1500)
      await expect(toggleRuns).toHaveAttribute('aria-expanded', 'false')
      await rm(invalidSource)
      await run('运行场景测试')
      await page.getByRole('heading', { name: '场景测试 · 已完成', exact: true }).waitFor({ timeout: 45000 })
      await run('无界面演示对战')
      await page.getByRole('heading', { name: '演示对战 · 已完成', exact: true }).waitFor({ timeout: 45000 })
      // Each task replaces the visible result; historical outputs and launch links stay out of the UI.
      await expect(runPanel.locator('article')).toHaveCount(1)
      await expect(runPanel.getByRole('heading', { name: '场景测试 · 已完成', exact: true })).toHaveCount(0)
      await expect(runPanel.getByRole('heading', { name: '检查 · 未完成', exact: true })).toHaveCount(0)
      await expect(runPanel.locator('pre')).toContainText('Winner:')
      await expect(runPanel.locator('pre')).not.toContainText('ARCADIA_RESULT=')
      await expect(runPanel.getByText('运行输出与来源', { exact: true })).toHaveCount(0)
      const jobs = await page.evaluate(
        async id => (await window.arcadiaDesktop.author({ action: 'jobs', id })).result,
        project.id,
      )
      assert.ok(jobs.some(job => job.kind === 'demo' && job.output.includes('Winner:')))
      assert.equal((await page.evaluate(() => window.arcadiaDesktop.getLocalBattleStatus())).status, 'idle')
      assert.equal(await page.locator('.monaco-editor').count(), 0)
      // The main play action prepares and opens in one click, without leaving the selected object.
      await category(/^技能/).click()
      await page.locator('.content-card').filter({ hasText: '霜击' }).click()
      await toggleRuns.click()
      await expect(
        page.getByRole('region', { name: '试玩控制' }).getByRole('button', { name: '调试试玩', exact: true }),
      ).toHaveCount(1)
      const personalStorageBefore = await page.evaluate(() => localStorage.getItem('petStorage'))
      const openedPreview = app.waitForEvent('window', { timeout: 45000 })
      await page.getByRole('button', { name: '调试试玩', exact: true }).click()
      let preview = await openedPreview
      await preview.getByRole('heading', { name: '测试队伍', exact: true }).waitFor()
      await expect(preview.getByRole('button', { name: '移入仓库', exact: true })).toHaveCount(0)
      await preview.getByLabel('精灵名称', { exact: true }).fill('测试首发')
      await preview.getByLabel('等级', { exact: true }).fill('95')
      await preview.getByRole('button', { name: '添加精灵', exact: true }).click()
      await preview.getByLabel('精灵名称', { exact: true }).fill('测试替补')
      // Scratch configuration survives returning before a match has even started.
      const scratchReturn = preview.waitForEvent('close')
      await preview.getByRole('button', { name: '返回编辑器', exact: true }).click()
      await scratchReturn
      await expect(page.getByRole('button', { name: /^(打开试玩|打开之前的试玩|结束试玩)$/ })).toHaveCount(0)
      await expect(page.getByLabel('威力', { exact: true })).toHaveValue('70')
      const scratchReopen = app.waitForEvent('window')
      await page.getByRole('button', { name: '调试试玩', exact: true }).click()
      preview = await scratchReopen
      await preview.getByRole('heading', { name: '测试队伍', exact: true }).waitFor()
      await expect(preview.getByRole('button', { name: '我方 · 2 只', exact: true })).toBeVisible()
      await expect(preview.getByLabel('精灵名称', { exact: true })).toHaveValue('测试首发')
      await expect(preview.getByLabel('等级', { exact: true })).toHaveValue('95')
      assert.equal(await preview.evaluate(() => window.__APP_DEBUG__.pinia._s.has('petStorage')), false)
      await preview.getByRole('button', { name: '开始对战', exact: true }).click()
      await preview.waitForURL(/\/battle\?authorPreview=/, { timeout: 45000 })
      const errors = []
      preview.on('pageerror', error => errors.push(error.message))
      await preview.waitForFunction(() => {
        const store = window.__APP_DEBUG__?.pinia._s.get('battle')
        return store?.battleState?.players?.[0]?.pets?.length > 0 || store?.availableActions?.length > 0
      })
      assert.equal(await preview.evaluate(() => typeof window.arcadiaDesktop), 'undefined')
      const configured = await preview.evaluate(
        () => window.__APP_DEBUG__.pinia._s.get('battle').battleState.players[0],
      )
      assert.equal(configured.team.length, 2)
      assert.equal(configured.team[0].name, '测试首发')
      assert.equal(configured.team[0].level, 95)
      await expect(preview.locator('body')).toContainText('霜击')
      await page.getByRole('link', { name: '内容包', exact: true }).click()
      await page.waitForURL(/\/content$/)
      const beforeReload = await preview.evaluate(() =>
        window.__APP_DEBUG__.pinia._s.get('battle').battleInterface.getState(undefined, true),
      )
      await preview.reload()
      await preview.waitForURL(/\/battle\?authorPreview=/)
      await preview.getByTestId('skill-button').filter({ hasText: '霜击' }).waitFor()
      assert.deepEqual(
        await preview.evaluate(() =>
          window.__APP_DEBUG__.pinia._s.get('battle').battleInterface.getState(undefined, true),
        ),
        beforeReload,
      )
      // Returning during a battle preserves both the editor and this candidate's state.
      const editorUrl = page.url()
      await expect(preview.getByRole('button', { name: '队伍编辑', exact: true })).toHaveCount(0)
      const closedPreview = preview.waitForEvent('close')
      await preview.getByRole('button', { name: '返回编辑器', exact: true }).click()
      await closedPreview
      assert.equal(page.url(), editorUrl)
      await page.goBack()
      await page.getByRole('heading', { name: '精灵', exact: true }).waitFor()
      const reopened = app.waitForEvent('window')
      await page.getByRole('button', { name: '调试试玩', exact: true }).click()
      preview = await reopened
      await preview.getByRole('button', { name: '继续当前对局', exact: true }).click()
      await preview.waitForURL(/\/battle\?authorPreview=/, { timeout: 45000 })
      await preview.getByTestId('skill-button').filter({ hasText: '霜击' }).waitFor()
      assert.deepEqual(
        await preview.evaluate(() =>
          window.__APP_DEBUG__.pinia._s.get('battle').battleInterface.getState(undefined, true),
        ),
        beforeReload,
      )
      preview.on('pageerror', error => errors.push(error.message))
      let turns = 0
      while (turns++ < 40) {
        await preview.waitForFunction(() => {
          const store = window.__APP_DEBUG__.pinia._s.get('battle')
          return store.isBattleEnd || (store.availableActions.length > 0 && !store.waitingForResponse)
        })
        const ended = await preview.evaluate(() => {
          const store = window.__APP_DEBUG__.pinia._s.get('battle')
          return store.isBattleEnd
        })
        if (ended) break
        await preview.getByTestId('skill-button').filter({ hasText: '霜击' }).click()
      }
      assert.ok(turns < 40, 'graphical preview must finish with a real winner')
      assert.deepEqual(errors, [])
      if (process.env.ARCADIA_PREVIEW_SCREENSHOT)
        await preview.screenshot({ path: process.env.ARCADIA_PREVIEW_SCREENSHOT, fullPage: true })
      await expect(preview.getByRole('button', { name: '返回人机对战', exact: true })).toHaveCount(0)
      const returned = preview.waitForEvent('close')
      await preview.locator('.battle-result').getByRole('button', { name: '返回编辑器', exact: true }).click()
      await returned
      await expect(page.getByRole('button', { name: '调试试玩', exact: true })).toBeVisible()
      // A completed match also restores its outcome rather than an inert battle screen.
      const endedPreview = app.waitForEvent('window')
      await page.getByRole('button', { name: '调试试玩', exact: true }).click()
      preview = await endedPreview
      await preview.getByRole('button', { name: '继续当前对局', exact: true }).click()
      await expect(preview.locator('.battle-result')).toContainText('胜利！')
      await preview.locator('.preview-header').getByRole('button', { name: '调整队伍', exact: true }).click()
      await preview.getByRole('button', { name: '对方（AI） · 1 只', exact: true }).click()
      await preview.getByLabel('精灵名称', { exact: true }).fill('测试对手')
      await preview.getByLabel('等级', { exact: true }).fill('60')
      await preview.getByRole('button', { name: '开始对战', exact: true }).click()
      await preview.getByTestId('skill-button').filter({ hasText: '霜击' }).waitFor()
      const opponent = await preview.evaluate(() => window.__APP_DEBUG__.pinia._s.get('battle').battleState.players[1])
      assert.equal(opponent.team[0].name, '测试对手')
      assert.equal(opponent.team[0].level, 60)
      await preview.getByRole('button', { name: '结束并调整队伍', exact: true }).click()
      await preview.getByRole('button', { name: '确定', exact: true }).click()
      await preview.getByRole('heading', { name: '测试队伍', exact: true }).waitFor()
      const finishedReturn = preview.waitForEvent('close')
      await preview.locator('.preview-header').getByRole('button', { name: '返回编辑器', exact: true }).click()
      await finishedReturn
      assert.equal(await page.evaluate(() => localStorage.getItem('petStorage')), personalStorageBefore)
      const previewsBefore = await page.evaluate(
        async id =>
          (await window.arcadiaDesktop.author({ action: 'jobs', id })).result.filter(job => job.kind === 'preview'),
        project.id,
      )
      assert.equal(previewsBefore.length, 1, 'reopening unchanged content must reuse its candidate')
      await category(/^技能/).click()
      await page.locator('.content-card').filter({ hasText: '霜击' }).click()
      await page.getByLabel('威力', { exact: true }).fill('71')
      await save(1)
      // A candidate selected before an external save is rechecked at the actual open boundary.
      const staleOpen = await page.evaluate(
        async ({ id, jobId }) =>
          (await window.arcadiaDesktop.author({ action: 'preview-open', id, jobId, requireCurrent: true })).result,
        { id: project.id, jobId: previewsBefore[0].jobId },
      )
      assert.deepEqual(staleOpen, { opened: false })
      // Preparing a replacement closes even an open old window before starting the new host.
      const oldWindow = app.waitForEvent('window')
      await page.evaluate(
        async ({ id, jobId }) => window.arcadiaDesktop.author({ action: 'preview-open', id, jobId }),
        { id: project.id, jobId: previewsBefore[0].jobId },
      )
      const previousWindow = await oldWindow
      await previousWindow.getByRole('heading', { name: '测试队伍', exact: true }).waitFor()
      await writeFile(invalidSource, 'export const invalid: string = 123\n')
      const previousClosed = previousWindow.waitForEvent('close')
      await page.getByRole('button', { name: '调试试玩', exact: true }).click()
      await previousClosed
      await runPanel.getByRole('heading', { name: '画面试玩 · 未完成', exact: true }).waitFor({ timeout: 45000 })
      await assert.rejects(fetch(previewsBefore[0].result.preview.endpoint + '/content'))
      assert.equal(app.windows().length, 1)
      await rm(invalidSource)
      const updatedWindow = app.waitForEvent('window', { timeout: 45000 })
      await page.getByRole('button', { name: '调试试玩', exact: true }).click()
      preview = await updatedWindow
      await preview.getByRole('button', { name: '开始对战', exact: true }).click()
      await expect(preview.getByTestId('skill-button').filter({ hasText: '霜击' })).toContainText('71')
      const previewsAfter = await page.evaluate(
        async id =>
          (await window.arcadiaDesktop.author({ action: 'jobs', id })).result.filter(job => job.kind === 'preview'),
        project.id,
      )
      assert.equal(previewsAfter.filter(job => job.state === 'succeeded').length, 1)
      assert.equal(previewsAfter.find(job => job.jobId === previewsBefore[0].jobId).stale, true)
      assert.equal(previewsAfter.find(job => job.jobId === previewsBefore[0].jobId).state, 'cancelled')
      await assert.rejects(fetch(previewsBefore[0].result.preview.endpoint + '/content'))
      const updatedReturn = preview.waitForEvent('close')
      await preview.getByRole('button', { name: '返回编辑器', exact: true }).click()
      await updatedReturn
      // More than four successive source revisions must never exhaust old-preview slots.
      let priorEndpoint = previewsAfter.find(job => job.state === 'succeeded').result.preview.endpoint
      for (const power of [72, 73, 74, 75]) {
        await page.getByLabel('威力', { exact: true }).fill(String(power))
        await save(1)
        const nextWindow = app.waitForEvent('window', { timeout: 45000 })
        await page.getByRole('button', { name: '调试试玩', exact: true }).click()
        preview = await nextWindow
        await preview.getByRole('heading', { name: '测试队伍', exact: true }).waitFor()
        await assert.rejects(fetch(priorEndpoint + '/content'))
        const live = await page.evaluate(
          async id =>
            (await window.arcadiaDesktop.author({ action: 'jobs', id })).result.filter(
              job => job.kind === 'preview' && job.state === 'succeeded',
            ),
          project.id,
        )
        assert.equal(live.length, 1)
        assert.equal(app.windows().length, 2)
        priorEndpoint = live[0].result.preview.endpoint
        const closed = preview.waitForEvent('close')
        await preview.getByRole('button', { name: '返回编辑器', exact: true }).click()
        await closed
      }
      // The singleton also spans projects, rather than allowing one host per project.
      const secondProject = await page.evaluate(
        async () => (await window.arcadiaDesktop.author({ action: 'create', name: '单试玩跨项目验收' })).result,
      )
      await page.goto(origin + '/content/edit/' + secondProject.id)
      await page.getByRole('heading', { name: '精灵', exact: true }).waitFor()
      const otherWindow = app.waitForEvent('window', { timeout: 45000 })
      await page.getByRole('button', { name: '调试试玩', exact: true }).click()
      preview = await otherWindow
      await preview.getByRole('heading', { name: '测试队伍', exact: true }).waitFor()
      await assert.rejects(fetch(priorEndpoint + '/content'))
      assert.equal(app.windows().length, 2)
      const otherClosed = preview.waitForEvent('close')
      await preview.getByRole('button', { name: '返回编辑器', exact: true }).click()
      await otherClosed
      await category(/^精灵/).click()
      await page.locator('.content-card').filter({ hasText: '霜团' }).click()
      if (process.env.ARCADIA_AUTHOR_SCREENSHOT)
        await page.screenshot({ path: process.env.ARCADIA_AUTHOR_SCREENSHOT, fullPage: true })
      await page.setViewportSize({ width: 390, height: 844 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
      // The same editor still exposes personal collection capabilities on the ordinary page.
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto(origin + '/team-builder')
      await expect(page.getByRole('button', { name: '清理所有数据', exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: '仓库管理', exact: true })).toBeVisible()
      await page.getByRole('button', { name: '添加精灵', exact: true }).click()
      await page.getByLabel('精灵名称', { exact: true }).fill('个人编队回归')
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await page.reload()
      await expect(page.getByRole('button', { name: '移入仓库', exact: true }).last()).toBeVisible()
      await expect(page.locator('body')).toContainText('个人编队回归')
    } catch (error) {
      if (app)
        for (const surface of app.windows()) {
          console.error(
            'Surface',
            surface.url(),
            await surface
              .locator('body')
              .innerText()
              .catch(() => 'unavailable'),
          )
        }
      console.error(
        await page
          ?.locator('.job pre')
          .allTextContents()
          .catch(() => []),
      )
      await page?.screenshot({ path: '/tmp/arcadia-author-failure.png', fullPage: true }).catch(() => {})
      console.error(
        await page
          ?.locator('body')
          .innerText()
          .catch(() => 'No page'),
      )
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
