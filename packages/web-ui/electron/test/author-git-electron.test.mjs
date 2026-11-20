import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)

test(
  'desktop Git workbench edits package declarations, commits, verifies the archive and tags the matching version',
  {
    timeout: 180000,
    skip: process.env.ARCADIA_AUTHOR_GUI_TEST !== '1',
  },
  async () => {
    const { _electron, expect } = require('playwright/test')
    const root = await mkdtemp(join(tmpdir(), 'arcadia-git-desktop-'))
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
    let app
    try {
      app = await _electron.launch({ executablePath: require('electron'), args: [entry], env })
      const page = await app.firstWindow()
      page.setDefaultTimeout(15000)
      await page.goto(origin + '/creation/edit')
      await page.getByText('打开内容包源项目', { exact: true }).waitFor({ timeout: 45000 })
      await page.getByLabel('新项目名称').fill('寒霜工作区验收')
      await page.getByRole('button', { name: '从模板创建项目', exact: true }).click()
      await page.getByRole('heading', { name: '精灵', exact: true }).waitFor()
      const projects = await page.evaluate(async () => (await window.arcadiaDesktop.author({ action: 'list' })).result)
      assert.equal(projects.length, 1)
      const project = projects[0]
      assert.ok(project.directory.startsWith(await realpath(join(root, 'data/ugc/projects'))))
      const git = (...args) => promisify(execFile)('git', args, { cwd: project.directory })
      await page.waitForURL(origin + '/creation/edit/' + project.id)
      await page.locator('.project-switch').click()
      const enter = async (title, value) => {
        const dialog = page.getByRole('dialog', { name: title, exact: true })
        await dialog.getByRole('textbox').fill(value)
        await dialog.getByRole('button', { name: '保存', exact: true }).click()
        await expect(dialog).toHaveCount(0)
      }
      await page.getByRole('button', { name: '更改包版本' }).click()
      await enter('更改包版本', '0.2.0')
      await page.getByRole('button', { name: '添加依赖' }).click()
      await enter('添加运行依赖', '@example/shared')
      await enter('@example/shared', '^1.0.0')
      await expect(page.getByText('@example/shared ^1.0.0')).toBeVisible()
      await page.getByRole('button', { name: '调整版本' }).click()
      await enter('@example/shared', '^2.0.0')
      await expect(page.getByText('@example/shared ^2.0.0')).toBeVisible()
      await page.getByRole('button', { name: '移除依赖' }).click()
      await page
        .getByRole('dialog', { name: '移除运行依赖？' })
        .getByRole('button', { name: '移除', exact: true })
        .click()
      await expect(page.getByText('@example/shared ^2.0.0')).toHaveCount(0)
      await page.locator('.project-switch').click()
      const openGit = () => page.getByRole('link', { name: 'Git 版本管理', exact: true }).click()
      const openRelease = () => page.getByRole('link', { name: '发布新版本', exact: true }).click()
      const releasePanel = page.getByRole('region', { name: '发布新版本', exact: true })
      const panel = page.getByRole('region', { name: 'Git 版本管理' })
      await openGit()
      await panel.getByRole('button', { name: '初始化 Git 仓库' }).click()
      await panel.getByRole('button', { name: '全部暂存' }).waitFor()
      await panel.getByRole('button', { name: 'GitHub 同步' }).click()
      await expect(panel.getByRole('button', { name: '连接 GitHub' })).toBeVisible()
      await expect(panel.getByRole('button', { name: '启动发行工作流' })).toHaveCount(0)
      await openRelease()
      await releasePanel.getByRole('button', { name: '更新 npm 锁文件' }).click()
      await expect(releasePanel.getByText('已更新 npm 锁文件')).toBeVisible({ timeout: 45000 })
      const lock = JSON.parse(await readFile(join(project.directory, 'package-lock.json'), 'utf8'))
      assert.equal(lock.packages[''].version, '0.2.0')
      await openGit()
      await git('config', 'user.name', 'Arcadia Test')
      await git('config', 'user.email', 'creator@example.invalid')
      await panel.getByRole('button', { name: '全部暂存' }).click()
      await panel.getByLabel('提交说明').fill('初始内容')
      await panel.getByRole('button', { name: '提交暂存修改' }).click()
      await expect(panel.getByText('工作区干净')).toBeVisible()
      await openRelease()
      await releasePanel.getByRole('button', { name: '检查并生成发行包' }).click()
      await expect
        .poll(
          async () =>
            page.evaluate(
              async id =>
                (await window.arcadiaDesktop.author({ action: 'jobs', id })).result.find(job => job.kind === 'release')
                  ?.state,
              project.id,
            ),
          { timeout: 90000 },
        )
        .toBe('succeeded')
      await expect(releasePanel.getByRole('complementary', { name: '发行归档' })).toContainText('.tgz')
      await releasePanel.getByRole('button', { name: '创建版本标签 v0.2.0' }).click()
      await expect(releasePanel.getByText('已创建本地标签 v0.2.0')).toBeVisible()
      assert.equal((await git('tag', '--points-at', 'HEAD')).stdout.trim(), 'v0.2.0')
      await expect(releasePanel.getByRole('button', { name: '前往 GitHub 同步' })).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      const file = join(project.directory, 'data/skills/strike.yaml')
      const original = await readFile(file, 'utf8')
      await writeFile(file, original + '\n# 版本差异验收\n')
      await openGit()
      await panel.getByRole('button', { name: 'data/skills/strike.yaml', exact: true }).click()
      await expect(panel.locator('.diff')).toContainText('版本差异验收')
      await page.goBack()
      await expect(releasePanel).toBeVisible()
      await page.goForward()
      await page.reload()
      await expect(panel.locator('.diff')).toContainText('版本差异验收')
      await expect(panel.getByRole('button', { name: 'data/skills/strike.yaml' })).toBeVisible()
      assert.equal((await git('tag', '--points-at', 'HEAD')).stdout.trim(), 'v0.2.0')
    } finally {
      await app?.close()
      await rm(root, { recursive: true, force: true })
    }
  },
)
