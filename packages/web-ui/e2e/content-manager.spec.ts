import { expect, test } from 'playwright/test'
import type { ContentLibrarySnapshot, InstalledContentPackage } from '../src/types/contentPackages'

test('UGC projects and environment dependencies are managed separately', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const pkg: InstalledContentPackage = {
      id: 'package',
      name: '@example/content',
      title: '发行材料',
      version: '1.0.0',
      namespace: 'custom',
      projectId: 'custom',
      author: '',
      description: '',
      source: { kind: 'file', label: 'content.tgz' },
      contentIds: { species: [], skills: [], marks: [] },
      counts: { species: 0, skills: 0, marks: 0 },
      containsCode: true,
      graph: [],
      installedAt: '2026-11-17T00:00:00Z',
    }
    const library: ContentLibrarySnapshot = {
      revision: 1,
      packages: [pkg],
      serviceStatus: { status: 'idle' },
      serviceNeedsRestart: false,
    }
    const environment = {
      revision: 'r1',
      document: {
        schemaVersion: 2,
        id: 'friends',
        name: '好友环境',
        packages: {},
        sources: [],
        rules: { schemaVersion: 1 },
        requires: {},
      },
    }
    const snapshot = { workspaceId: 'local', environments: [environment], installations: [], operations: [] }
    Object.defineProperty(window, 'arcadiaDesktop', {
      value: {
        getLocalServerPort: async () => null,
        prepareLocalContent: async () => ({
          token: 'test',
          content: { species: [], skills: [], marks: [] },
          environment: { revision: 'test', data: { species: [], skills: [], marks: [] }, modules: [] },
        }),
        releaseLocalContent: async () => {},
        listCachedPets: async () => [],
        getAppVersion: async () => 'test',
        listContentProjects: async () => [],
        listContentPackages: async () => structuredClone(library),
        contentPackageAction: async () => null,
        author: async (input: { action: string }) => ({
          result:
            input.action === 'list'
              ? [
                  { id: 'project', name: '森林项目', directory: '/source', readOnly: false },
                  { id: 'material', name: '发行材料', directory: '/material', readOnly: true },
                ]
              : null,
        }),
        localEnvironment: async (input: { action: string; document: typeof environment.document }) => {
          if (input.action === 'apply') {
            environment.document = input.document
            environment.revision = 'r2'
          }
          return { result: input.action === 'snapshot' ? structuredClone(snapshot) : { operationId: 'job' } }
        },
      },
    })
  })
  await page.goto('/creation')
  await expect(page).toHaveURL(/\/creation$/)
  await expect(page.getByRole('heading', { name: '创作', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '环境位置' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'UGC 项目' })).toContainText('森林项目')
  await expect(page.getByRole('region', { name: 'UGC 项目' })).not.toContainText('发行材料')
  await expect(page.getByRole('button', { name: '添加内容包', exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('ugc-projects.png'), fullPage: true })
  await page.getByRole('button', { name: '环境', exact: true }).click()
  await expect(page).toHaveURL(/\/environments$/)
  await expect(page.getByRole('region', { name: 'UGC 项目' })).toHaveCount(0)
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page
    .locator('.el-select')
    .filter({ has: page.getByRole('combobox', { name: '选择已有包版本' }) })
    .click()
  await page.getByRole('option', { name: '@example/content 1.0.0', exact: true }).click()
  await expect(page.getByLabel('版本范围', { exact: true })).toHaveValue('1.0.0')
  await expect(page.locator('.environment-editor')).toContainText('配置')
  await page.getByRole('button', { name: '保存并应用', exact: true }).click()
  await expect(page.locator('.environment-workspace')).toContainText('@example/content')
  await expect(page.locator('.environment-workspace')).not.toContainText('已移出的内容包')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  const workspace = page.locator('.environment-workspace')
  expect(await workspace.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('environment-dependencies-mobile.png'), fullPage: true })
  await page.getByRole('button', { name: '打开导航', exact: true }).click()
  await page.getByRole('link', { name: '创作', exact: true }).click()
  await expect(page).toHaveURL(/\/creation$/)
  await expect(page.getByRole('heading', { name: '创作', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '打开导航', exact: true }).click()
  await page.getByRole('link', { name: '环境', exact: true }).click()
  await expect(page).toHaveURL(/\/environments$/)
})

test('browser content is read-only and desktop authoring and host routes stay closed', async ({ page }) => {
  await page.route('**/arcadia-client.json', route =>
    route.fulfill({ json: { schemaVersion: 1, backendOrigin: '/', autoConnect: false } }),
  )
  await page.route('**/api/v1/environments', route => route.fulfill({ json: { protocolVersion: 1, environments: [] } }))
  await page.goto('/environments')
  await expect(page.getByRole('heading', { name: '环境', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '创作', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '添加内容包', exact: true })).toHaveCount(0)
  await expect(page.locator('.environment-hub input[type=checkbox]')).toHaveCount(0)
  await expect(page.locator('.environment-hub')).toContainText('服务器暂无公开环境')
  for (const route of ['/creation', '/creation/edit', '/creation/development', '/settings/local-service']) {
    await page.goto(route)
    await expect(page.getByRole('heading', { name: '本地内容工具', exact: true })).toBeVisible()
    await expect(page.locator('main button')).toHaveCount(0)
  }
})

test('environment import and export use the environment entry and stay scoped to the selected location', async ({
  page,
}, testInfo) => {
  await page.route('**/api/v1/environments', route => route.fulfill({ json: { protocolVersion: 1, environments: [] } }))
  await page.route('**/api/management/v1/**', route =>
    route.fulfill({ status: 401, json: { error: { code: 'MANAGEMENT_UNAUTHENTICATED', message: '需要登录' } } }),
  )
  await page.addInitScript(() => {
    const document = {
      schemaVersion: 2,
      id: 'friends',
      name: '好友环境',
      packages: {},
      sources: [],
      rules: { schemaVersion: 1 },
      requires: {},
    }
    const installation = {
      installationId: 'local-version',
      environmentId: 'friends',
      draftRevision: 'draft-1',
      status: 'ready',
      document,
      createdAt: 1,
      contentRevision: 'revision',
      members: [],
    }
    let selectedEnvironmentId: string | undefined
    const calls: Record<string, unknown>[] = []
    Object.assign(window, {
      environmentCalls: calls,
      arcadiaDesktop: {
        getLocalServerPort: async () => null,
        prepareLocalContent: async () => ({
          token: 'test',
          content: { species: [], skills: [], marks: [] },
          environment: { revision: 'test', data: { species: [], skills: [], marks: [] }, modules: [] },
        }),
        releaseLocalContent: async () => {},
        listCachedPets: async () => [],
        getAppVersion: async () => 'test',
        listContentProjects: async () => [],
        prepareLocalContent: async () => ({
          token: 'test-metadata',
          content: { species: [], skills: [], marks: [] },
          environment: { revision: 'test', data: { species: [], skills: [], marks: [] }, modules: [] },
        }),
        releaseLocalContent: async () => {},
        listCachedPets: async () => [],
        getAppVersion: async () => 'test',

        localEnvironment: async (input: Record<string, unknown>) => {
          calls.push(input)
          if (input.action === 'snapshot')
            return {
              result: {
                workspaceId: 'local',
                selectedEnvironmentId,
                environments: [{ document, revision: 'draft-1' }],
                installations: [installation],
                operations: [],
              },
            }
          if (input.action === 'select') selectedEnvironmentId = String(input.environmentId)
          if (input.action === 'export')
            return {
              result: { format: 'arcadia.environment-export/2', document, files: [], contentRevision: 'revision' },
            }
          return { result: { id: 'import-task' } }
        },
      },
    })
  })
  await page.goto('/environments?target=local')
  const hub = page.locator('.environment-hub')
  await expect(hub.getByRole('heading', { name: '好友环境', exact: true })).toBeVisible()
  await hub.getByRole('button', { name: '本地使用', exact: true }).click()
  await expect(hub.getByRole('button', { name: '本地使用中', exact: true })).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('environment-selected-desktop.png'), fullPage: true })
  await hub.getByRole('button', { name: '编辑', exact: true }).click()
  await hub.locator('form.environment-editor input').first().fill('未保存名称')
  await hub.getByRole('button', { name: '任务', exact: true }).click()
  await page
    .getByRole('dialog', { name: '环境任务', exact: true })
    .getByRole('button', { name: 'Close this dialog' })
    .click()
  await expect(hub.locator('form.environment-editor input').first()).toHaveValue('未保存名称')
  await hub.locator('.target-select').click()
  await page.getByRole('option', { name: /服务器 ·/ }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(hub.locator('.target-select')).toContainText('本机')
  await expect(hub.locator('form.environment-editor input').first()).toHaveValue('未保存名称')
  await hub.getByRole('button', { name: '关闭编辑', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(hub.getByRole('button', { name: '导出环境', exact: true })).toBeVisible()
  const download = page.waitForEvent('download')
  await hub.getByRole('button', { name: '导出环境', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('environment-local-version.json')
  await hub.getByRole('button', { name: '导入环境', exact: true }).click()
  await page
    .getByRole('dialog', { name: '导入环境', exact: true })
    .locator('input[type=file]')
    .setInputFiles({
      name: 'environment.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'arcadia.environment-export/2',
          document: { schemaVersion: 2, id: 'imported', name: '导入环境', packages: {} },
          files: [],
          contentRevision: 'revision',
        }),
      ),
    })
  await expect(page.getByRole('button', { name: '确认导入新环境' })).toBeVisible()
  await expect(page.locator('.dialog-fade-enter-active')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('environment-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await expect(page.getByRole('button', { name: '确认导入新环境' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const confirmBox = await page.getByRole('button', { name: '确认导入新环境' }).boundingBox()
  expect(confirmBox!.y + confirmBox!.height).toBeLessThan(844)
  await expect(page.getByRole('button', { name: '更换文件' })).toBeVisible()
  expect(
    await page.locator('.el-dialog input[type=file]').evaluate((input: HTMLInputElement) => input.files?.length),
  ).toBe(1)
  await page.screenshot({ path: testInfo.outputPath('environment-mobile-dark.png'), fullPage: true })
  await page.getByRole('button', { name: '确认导入新环境' }).click()
  await expect(page.getByRole('heading', { name: '下载与准备任务' })).toBeVisible()
  const calls = await page.evaluate(
    () => (window as unknown as { environmentCalls: Record<string, unknown>[] }).environmentCalls,
  )
  expect(calls.filter(input => input.action === 'import')).toHaveLength(1)
  expect(calls.find(input => input.action === 'export')).toMatchObject({ installationId: 'local-version' })
  await page
    .getByRole('dialog', { name: '环境任务', exact: true })
    .getByRole('button', { name: 'Close this dialog' })
    .click()
  await hub.locator('.target-select').click()
  await page.getByRole('option', { name: /服务器 ·/ }).click()
  await expect(hub.getByRole('button', { name: '管理员登录', exact: true })).toBeVisible()
  await expect(hub.getByRole('button', { name: '导入环境', exact: true })).toHaveCount(0)
  await expect(hub.getByRole('heading', { name: '公开环境', exact: true })).toBeVisible()
  await hub.locator('.target-select').click()
  await page.getByRole('option', { name: '本机', exact: true }).click()
  await expect(hub.getByRole('heading', { name: '好友环境', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '确认导入新环境' })).toHaveCount(0)
  await expect(page).toHaveURL(/\/environments\?target=local$/)
})
