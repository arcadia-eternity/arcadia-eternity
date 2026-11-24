import { expect, test } from 'playwright/test'
import type { ManagedEnvironmentInstallation, ManagedEnvironment } from '../src/types/management'
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
      contentIds: { species: ['custom:fox'], skills: [], marks: [] },
      counts: { species: 1, skills: 0, marks: 0 },
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
    const environment: ManagedEnvironment = {
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
    const snapshot = {
      workspaceId: 'local',
      environments: [environment],
      installations: [] as ManagedEnvironmentInstallation[],
      operations: [] as { id: string; kind: string; status: string }[],
    }
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
            snapshot.operations = [{ id: 'job', kind: 'environment.apply', status: 'succeeded' }]
            environment.document = input.document
            environment.revision = 'r2'
            snapshot.installations = [
              {
                installationId: 'friends',
                environmentId: 'friends',
                workspaceId: 'local',
                document: input.document,
                draftRevision: 'r2',
                contentRevision: 'content-2',
                packages: [],
                status: 'ready',
                createdAt: 1,
                contentCatalog: {
                  species: [
                    { id: 'custom:fox', name: '火狐' },
                    { id: 'custom:wolf', name: '冰狼' },
                  ],
                  skills: [],
                  marks: [],
                  stages: [],
                },
              },
            ]
          }
          return { result: input.action === 'snapshot' ? structuredClone(snapshot) : { operationId: 'job' } }
        },
      },
    })
  })
  await page.goto('/')
  await page.getByRole('navigation', { name: '游戏工具' }).getByRole('link', { name: '内容包与创作' }).click()
  await expect(page).toHaveURL(/\/creation$/)
  await expect(page.getByRole('heading', { name: '内容包与创作' })).toBeVisible()
  const rows = page.locator('.package-list .package-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: '森林项目' })).toContainText('创作包')
  await expect(rows.filter({ hasText: '发行材料' })).toContainText('本地包')
  const search = page.getByRole('searchbox', { name: '搜索内容包' })
  await search.fill('发行')
  await expect(rows).toHaveCount(1)
  await expect(page.getByRole('button', { name: '浏览内容（只读）' })).toBeVisible()
  await search.fill('')
  const filter = page.getByRole('combobox', { name: '内容包类型' })
  await filter.selectOption('projects')
  await expect(rows).toHaveCount(1)
  await expect(page.getByRole('button', { name: '编辑项目' })).toBeVisible()
  await filter.selectOption('installed')
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText('发行材料')
  await filter.selectOption('all')
  await expect(rows).toHaveCount(2)
  await page.screenshot({ path: testInfo.outputPath('ugc-projects.png'), fullPage: true })
  await page.goBack()
  await expect(page.getByRole('heading', { name: '对战大厅' })).toBeVisible()
  await page.getByRole('banner').getByRole('button', { name: '环境', exact: true }).click()
  await expect(page.getByRole('banner').getByRole('button', { name: '创作', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '内容包与创作', exact: true }).click()
  await expect(page).toHaveURL(/\/creation$/)
  await page.goBack()
  await expect(page.getByRole('heading', { name: '本机环境库' })).toBeVisible()
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page
    .locator('.el-select')
    .filter({ has: page.getByRole('combobox', { name: '选择已有包版本' }) })
    .click()
  await page.getByRole('option', { name: '@example/content 1.0.0', exact: true }).click()
  await expect(page.getByLabel('版本范围', { exact: true })).toHaveValue('1.0.0')
  const editor = page.getByRole('form', { name: '编辑环境' })
  const save = editor.getByRole('button', { name: '保存并应用' })
  await editor.getByRole('button', { name: '添加内容包', exact: true }).click()
  const addedPackage = editor.getByLabel('包名', { exact: true }).last()
  await expect(addedPackage).toBeFocused()
  await editor.getByRole('tab', { name: '基础规则' }).click()
  const faintSwitch = editor.getByRole('radiogroup', { name: '击破奖励换宠' })
  await faintSwitch.getByText('关闭', { exact: true }).click()
  await save.click()
  await expect(editor.getByRole('tab', { name: '内容包依赖' })).toHaveAttribute('aria-selected', 'true')
  await expect(addedPackage).toBeFocused()
  await expect(editor.getByText('请填写包名')).toBeVisible()
  await editor.locator('.package-row').last().getByRole('button', { name: '移出环境' }).click()
  await editor.getByRole('tab', { name: '基础规则' }).click()
  await expect(faintSwitch.getByRole('radio', { name: '关闭' })).toBeChecked()
  await editor.getByRole('tab', { name: '对战机制' }).click()
  const enhancement = editor.getByRole('radiogroup', { name: '神魔化规则' })
  const activeMode = enhancement.getByText('启用', { exact: true })
  await activeMode.click()
  await expect(enhancement.getByRole('radio', { name: '启用', exact: true })).toBeChecked()
  await editor.getByRole('tab', { name: '内容限制' }).click()
  const allowed = editor.getByRole('combobox', { name: '精灵允许名单', exact: true })
  await allowed.fill('custom:f')
  await expect(page.getByRole('option', { name: 'custom:fox', exact: true })).toBeVisible()
  await allowed.press('Enter')
  await allowed.fill('other:wolf，other:cub')
  await expect(page.getByRole('option', { name: /使用 other:wolf，other:cub/ })).toBeVisible()
  await allowed.press('Tab')
  await expect(editor.locator('.el-tag').filter({ hasText: 'other:cub' })).toBeVisible()
  await expect(editor.locator('.el-tag').filter({ hasText: 'custom:fox' })).toBeVisible()
  await page.getByRole('button', { name: '保存并应用', exact: true }).click()
  await expect(editor).not.toBeVisible()
  await expect(page.locator('.environment-workspace')).not.toContainText('已移出的内容包')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await editor.getByRole('tab', { name: '基础规则' }).click()
  await expect(faintSwitch.getByRole('radio', { name: '关闭' })).toBeChecked()
  const workspace = page.locator('.environment-workspace')
  expect(await workspace.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await editor.getByRole('tab', { name: '对战机制' }).click()
  await expect(enhancement.getByRole('radio', { name: '启用', exact: true })).toBeChecked()
  for (const label of ['继承（禁用）', '启用', '禁用']) {
    const text = enhancement.getByText(label, { exact: true })
    await expect(text).toBeVisible()
    expect(
      await text.evaluate(el => {
        const range = document.createRange()
        range.selectNodeContents(el)
        const bounds = el.closest('[role="radiogroup"]')!.getBoundingClientRect()
        return Array.from(range.getClientRects()).every(
          rect => rect.width > 0 && rect.left >= bounds.left && rect.right <= Math.min(bounds.right + 1, innerWidth),
        )
      }),
    ).toBe(true)
  }
  await editor
    .getByRole('region', { name: '神魔化', exact: true })
    .screenshot({ path: testInfo.outputPath('enhancement-mobile.png') })
  await editor.getByRole('tab', { name: '内容限制' }).click()
  await expect(editor.locator('.el-tag').filter({ hasText: 'other:cub' })).toBeVisible()
  await allowed.fill('冰')
  await page.getByRole('option', { name: '冰狼 · custom:wolf' }).click()
  await expect(editor.locator('.el-tag').filter({ hasText: 'custom:wolf' })).toBeVisible()
  await save.click()
  await expect(editor).not.toBeVisible()
  await page.getByRole('button', { name: '打开导航', exact: true }).click()
  await expect(page.getByRole('link', { name: '创作', exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: '环境', exact: true }).click()
  await page.getByRole('button', { name: '内容包与创作', exact: true }).click()
  await expect(page).toHaveURL(/\/creation$/)
  await expect(page.getByRole('heading', { name: '内容包与创作' })).toBeVisible()
  await page.getByRole('button', { name: '打开导航', exact: true }).click()
  await page.getByRole('link', { name: '环境', exact: true }).click()
  await expect(page).toHaveURL(/\/environments$/)
  await page.goto('/environments?target=local&panel=packages')
  await expect(page).toHaveURL(/\/creation$/)
  await expect(rows).toHaveCount(2)
  await page.reload()
  await expect(page.getByRole('heading', { name: '内容包与创作' })).toBeVisible()
  await expect(rows).toHaveCount(2)
})

test('browser content is read-only and desktop authoring and host routes stay closed', async ({ page }, testInfo) => {
  await page.route('**/arcadia-client.json', route =>
    route.fulfill({ json: { schemaVersion: 1, backendOrigin: '/', autoConnect: false } }),
  )
  await page.route('**/api/management/v1/**', route =>
    route.fulfill({ status: 401, json: { error: { code: 'MANAGEMENT_UNAUTHENTICATED' } } }),
  )
  await page.route('**/api/v1/environments', route =>
    route.fulfill({
      json: {
        protocolVersion: 1,
        environments: [
          { environmentId: 'league', environmentName: '联赛规则', id: 'a'.repeat(64) },
          { environmentId: 'training-120', environmentName: '联机 120', id: 'c'.repeat(64) },
        ].map(environment => ({
          ...environment,
          protocolVersion: 1,
          resourceRevision: 'b'.repeat(64),
          runtime: { kind: 'native-v4', coreBuildId: 'core', registryBuildId: 'registry', contentRevision: 'remote' },
          resources: [],
          packages: [
            { name: '@arcadia-eternity/data-pack-base', projectId: 'base', namespace: 'base', version: '1.0.0' },
          ],
        })),
      },
    }),
  )
  await page.goto('/')
  const tools = page.getByRole('navigation', { name: '游戏工具' })
  await expect(tools).toBeVisible()
  await expect(tools.getByRole('link', { name: '内容包与创作' })).toHaveCount(0)
  await page.getByRole('banner').getByRole('button', { name: '环境', exact: true }).click()
  await expect(page.getByRole('heading', { name: '环境', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '创作', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '添加内容包', exact: true })).toHaveCount(0)
  await expect(page.locator('.environment-hub input[type=checkbox]')).toHaveCount(0)
  const directory = page.getByRole('navigation', { name: '选择环境' })
  await expect(directory.getByRole('button', { name: /默认环境/ })).toHaveCount(1)
  await expect(page.getByRole('group', { name: '环境来源' })).toHaveCount(0)
  await expect(page.getByRole('article', { name: '网页内置环境详情' })).toContainText('默认环境')
  await expect(directory.getByRole('button', { name: /120/ })).toHaveCount(2)
  const training = directory.getByRole('button', { name: /120.*网页内置/ })
  await expect(training).toHaveCount(1)
  await training.click()
  await expect(page.getByRole('article', { name: '网页内置环境详情' })).toContainText('120')
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0)
  await expect(directory.getByRole('button', { name: /联机 120.*服务器/ })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '环境位置' })).toHaveCount(0)
  const remoteDetail = page.getByRole('article', { name: '公开环境详情' })
  const league = directory.getByRole('button', { name: /联赛规则/ })
  await league.click()
  await expect(league).toHaveAttribute('aria-current', 'true')
  await expect(remoteDetail.getByRole('heading', { name: '联赛规则' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await directory.evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(
    await remoteDetail.evaluate(el => el.getBoundingClientRect().top),
  )
  expect(await page.locator('.hub-body').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await expect(page.getByRole('button', { name: '管理员登录' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: '管理员登录' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('environment-public-mobile.png') })
  for (const route of ['/creation', '/creation/edit', '/creation/development', '/settings/local-service']) {
    await page.goto(route)
    await expect(page.getByRole('heading', { name: '本地内容工具', exact: true })).toBeVisible()
    await expect(page.locator('main button')).toHaveCount(0)
  }
})

test('environment import and export use the environment entry and stay scoped to the selected location', async ({
  page,
}, testInfo) => {
  await page.route('**/api/v1/environments', route =>
    route.fulfill({
      json: {
        protocolVersion: 1,
        environments: [
          {
            environmentId: 'league',
            environmentName: '联赛规则',
            protocolVersion: 1,
            id: 'a'.repeat(64),
            resourceRevision: 'b'.repeat(64),
            runtime: { kind: 'native-v4', contentRevision: 'remote', coreBuildId: 'core', registryBuildId: 'registry' },
            resources: [],
            packages: [],
          },
        ],
      },
    }),
  )
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
      members: [
        {
          name: '@friends/pet',
          version: '1.0.0',
          direct: true,
          requiredBy: [],
          dependencies: [],
          archiveIntegrity: 'sha512-test',
          projectId: 'pet',
          namespace: 'pet',
        },
      ],
    }
    const saves: { id: string; kind: string; status: string; error?: { code: string; message: string } }[] = []
    const created: { document: typeof document; revision: string }[] = []
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

        contentPackageAction: async () => null,
        localEnvironment: async (input: Record<string, unknown>) => {
          calls.push(input)
          if (input.action === 'snapshot')
            return {
              result: {
                workspaceId: 'local',
                selectedEnvironmentId,
                environments: [
                  { document, revision: 'draft-1' },
                  { document: { ...document, id: 'practice', name: '练习场' }, revision: 'draft-2' },
                  ...created,
                ],
                installations: [installation],
                operations: saves,
              },
            }
          if (input.action === 'apply' && input.expectedRevision === null) {
            const saved = input.document as typeof document
            const id = 'apply-' + saves.length
            const hasBase = (saved.sources as string[]).includes('@arcadia-eternity/data-pack-base')
            if (!saves.length || !hasBase) {
              saves.push({
                id,
                kind: 'environment.apply',
                status: 'failed',
                error: { code: hasBase ? 'NPM_INSTALL_FAILED' : 'NPM_CONTENT_MISSING', message: 'prepare failed' },
              })
            } else {
              created.push({ document: saved, revision: 'created' })
              saves.push({ id, kind: 'environment.apply', status: 'succeeded' })
            }
            return { result: { operationId: id } }
          }
          if (input.action === 'select') selectedEnvironmentId = String(input.environmentId)
          if (input.action === 'export-preview')
            return {
              result: {
                revision: 'preview',
                dependencies: calls.some(call => call.action === 'export')
                  ? []
                  : [
                      { name: 'pet', location: 'node_modules/pet', version: '1.0.0', manual: false, bytes: 1024 },
                      {
                        name: 'private-pet',
                        location: 'node_modules/private-pet',
                        version: '2.0.0',
                        manual: true,
                        bytes: 1024,
                      },
                    ],
              },
            }
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
  const downloadPolicy = hub.getByText('允许下载缺失的第三方包', { exact: true })
  await downloadPolicy.click()
  await expect(hub.getByRole('checkbox', { name: '允许下载缺失的第三方包' })).toBeChecked()
  await downloadPolicy.click()
  await expect(hub.getByText(/^(查看使用情况|查看引用|导入内容包位置清单|导入来源配置)$/)).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('environment-selected-desktop.png'), fullPage: true })
  await hub.getByRole('button', { name: '编辑', exact: true }).click()
  await hub.locator('form.environment-editor input').first().fill('未保存名称')
  await hub.getByRole('button', { name: '任务', exact: true }).click()
  await page
    .getByRole('dialog', { name: '环境任务', exact: true })
    .getByRole('button', { name: 'Close this dialog' })
    .click()
  await expect(hub.locator('form.environment-editor input').first()).toHaveValue('未保存名称')
  await hub
    .getByRole('navigation', { name: '选择环境' })
    .getByRole('button', { name: /联赛规则/ })
    .click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(hub.getByRole('navigation').getByRole('button', { name: /好友环境/ })).toHaveAttribute(
    'aria-current',
    'true',
  )
  await expect(hub.locator('form.environment-editor input').first()).toHaveValue('未保存名称')
  await hub.getByRole('button', { name: '关闭编辑', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(hub.getByRole('button', { name: '导出环境', exact: true })).toBeVisible()
  await hub.getByRole('button', { name: '用于其他环境', exact: true }).click()
  const targetDialog = page.getByRole('dialog', { name: '用于其他环境' })
  await targetDialog.getByRole('combobox').click()
  await page.getByRole('option', { name: '练习场' }).click()
  await targetDialog.getByRole('button', { name: '加入环境' }).click()
  const tasks = page.getByRole('dialog', { name: '环境任务', exact: true })
  await tasks.getByRole('button', { name: 'Close this dialog' }).click()
  await hub.getByRole('button', { name: '保存到本机包库', exact: true }).click()
  await tasks.getByRole('button', { name: 'Close this dialog' }).click()
  await expect(hub.getByRole('button', { name: '离线导出' })).toHaveCount(0)
  await hub.getByRole('button', { name: '导出环境', exact: true }).click()
  const exportDialog = page.getByRole('dialog', { name: '导出环境', exact: true })
  await expect(exportDialog.getByRole('checkbox', { name: /private-pet/ })).not.toBeChecked()
  const includePublic = exportDialog.getByRole('checkbox', { name: /公共依赖/ })
  await expect(includePublic).not.toBeChecked()
  await exportDialog.getByText(/随文件附上公共依赖/).click()
  await expect(includePublic).toBeChecked()
  const withPublic = page.waitForEvent('download')
  await exportDialog.getByRole('button', { name: '导出', exact: true }).click()
  await withPublic
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
  expect(calls.filter(input => input.action === 'export').map(input => input.mode)).toEqual([
    { revision: 'preview', locations: ['node_modules/pet'] },
    { revision: 'preview', locations: [] },
  ])
  expect(calls.find(input => input.action === 'use-member')).toMatchObject({
    environmentId: 'friends',
    targetId: 'practice',
    name: '@friends/pet',
    integrity: 'sha512-test',
    expectedRevision: 'draft-2',
  })
  expect(calls.find(input => input.action === 'save-member')).toMatchObject({
    environmentId: 'friends',
    name: '@friends/pet',
    integrity: 'sha512-test',
  })
  await page
    .getByRole('dialog', { name: '环境任务', exact: true })
    .getByRole('button', { name: 'Close this dialog' })
    .click()
  await hub
    .getByRole('navigation', { name: '选择环境' })
    .getByRole('button', { name: /联赛规则/ })
    .click()
  await expect(hub.getByRole('button', { name: '管理员登录', exact: true })).toHaveCount(0)
  await expect(hub.getByRole('button', { name: '导入环境', exact: true })).toHaveCount(0)
  await expect(hub.getByRole('heading', { name: '公开环境', exact: true })).toBeVisible()
  await hub
    .getByRole('navigation', { name: '选择环境' })
    .getByRole('button', { name: /好友环境/ })
    .click()
  await expect(hub.getByRole('heading', { name: '好友环境', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '确认导入新环境' })).toHaveCount(0)
  await hub.getByRole('button', { name: '新建环境', exact: true }).click()
  const create = hub.getByRole('form', { name: '编辑环境' })
  await create.getByLabel('名称', { exact: true }).fill('周末联赛')
  await create.getByLabel('标识', { exact: true }).fill('weekend')
  await create.getByRole('button', { name: '保存并应用' }).click()
  await expect(hub.getByRole('alert')).toContainText('下载或安装失败')
  await expect(create.getByLabel('名称', { exact: true })).toHaveValue('周末联赛')
  await create.getByRole('button', { name: '保存并应用' }).click()
  await expect(hub.getByRole('heading', { name: '周末联赛', exact: true })).toBeVisible()
  await expect(hub.getByRole('navigation').getByRole('button', { name: /周末联赛/ })).toContainText('本机')
  const rows = hub.getByRole('navigation', { name: '选择环境' }).getByRole('button')
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    const leftEdges = await rows.evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().left))
    expect(new Set(leftEdges).size).toBe(1)
  }
  await expect(page).toHaveURL(/\/environments\?target=local$/)
})
