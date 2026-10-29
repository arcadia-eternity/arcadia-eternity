import { expect, test } from 'playwright/test'
import type {
  ContentLibrarySnapshot,
  InstalledContentPackage,
  ContentPackageAction,
} from '../src/types/contentPackages'

test('content choices converge without apply controls or restarting the running host', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const pkg: InstalledContentPackage = {
      id: 'package',
      name: '@example/content',
      title: '创作测试内容',
      version: '1.0.0',
      namespace: 'custom',
      projectId: 'custom',
      author: '测试作者',
      description: '精灵与技能扩展',
      source: { kind: 'file', label: 'content-1.0.0.tgz' },
      contentIds: { species: [], skills: [], marks: [] },
      counts: { species: 0, skills: 0, marks: 0 },
      containsCode: true,
      graph: [
        { name: '@example/content', version: '1.0.0', dependencies: { library: '2.0.0' } },
        { name: 'library', version: '2.0.0', dependencies: {} },
      ],
      installedAt: '2026-10-29T00:00:00Z',
    }
    const snapshot: ContentLibrarySnapshot = {
      revision: 1,
      packages: [pkg],
      activeIds: [],
      desiredIds: [],
      selection: { status: 'ready' },
      hasSelection: true,
      serviceStatus: { status: 'running', url: 'http://127.0.0.1:12345', projectName: 'local', serverId: 'test' },
      serviceNeedsRestart: false,
    }
    let revision = 0
    Object.defineProperty(window, 'arcadiaDesktop', {
      value: {
        getLocalServerPort: async () => null,
        listWorkspacePacks: async () => [],
        listCachedPets: async () => [],
        getAppVersion: async () => 'test',
        listContentPackages: async () => structuredClone(snapshot),
        listContentProjects: async () => [],
        getLocalBattleStatus: async () => structuredClone(snapshot.serviceStatus),
        stopLocalBattle: async () => {
          snapshot.serviceStatus = { status: 'idle' }
          return snapshot.serviceStatus
        },
        installContentPackageFile: async () => {
          snapshot.packages.push({ ...pkg, id: 'second', title: '另一个包', name: '@example/second' })
          snapshot.desiredIds.push('second')
          snapshot.activeIds = [...snapshot.desiredIds]
          snapshot.selection = { status: 'ready' }
          return 'second'
        },
        installNpmContentPackage: async () => {
          throw new Error('Exact versions only')
        },
        contentPackageAction: async (input: ContentPackageAction) => {
          if (input.action === 'set-selection') {
            snapshot.desiredIds = [...input.ids]
            snapshot.selection = { status: 'preparing' }
            const current = ++revision
            setTimeout(() => {
              if (revision !== current) return
              snapshot.activeIds = [...input.ids]
              snapshot.selection = { status: 'ready' }
            }, 200)
          }
          return null
        },
      },
    })
  })
  await page.goto('/content')
  const main = page.locator('main.content-page')
  await expect(page.getByRole('heading', { name: '内容包', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /创作测试内容/ }).click()
  await page.getByRole('tab', { name: '依赖', exact: true }).click()
  await expect(main).toContainText('library')
  await page.getByLabel('启用 创作测试内容', { exact: true }).check()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '检查并应用更改', exact: true })).toHaveCount(0)
  await expect(main.locator('.package-detail > .detail-subtitle')).toContainText('本机已启用')
  await page.getByRole('button', { name: '添加内容包', exact: true }).click()
  await page.getByRole('button', { name: '安装本地 .tgz 文件', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(main.getByRole('heading', { name: '另一个包', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('content-packages-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '返回内容包列表', exact: true }).click()
  await page.getByRole('button', { name: /创作测试内容/ }).click()
  await expect(main.getByRole('heading', { name: '创作测试内容', exact: true })).toBeVisible()
  expect(await main.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('content-packages-mobile.png'), fullPage: true })
  await page.goto('/settings/local-service')
  await expect(page.getByRole('heading', { name: '高级本机工具', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '启动本机服务', exact: true })).not.toBeVisible()
})

test('browser content is read-only and desktop authoring and host routes stay closed', async ({ page }) => {
  await page.goto('/content')
  await expect(page.locator('main.content-page .scope')).toHaveText('只读')
  await expect(page.getByRole('button', { name: '添加内容包', exact: true })).toHaveCount(0)
  await expect(page.locator('main.content-page input[type=checkbox]')).toHaveCount(0)
  await expect(page.locator('main.content-page')).toContainText('尚未进入房间')
  for (const route of ['/creator', '/creator/development', '/settings/local-service']) {
    await page.goto(route)
    await expect(page.getByRole('heading', { name: '本地内容工具', exact: true })).toBeVisible()
    await expect(page.locator('main button')).toHaveCount(0)
  }
})
