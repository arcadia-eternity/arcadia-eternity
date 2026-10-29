import { expect, test } from 'playwright/test'
import type {
  ContentLibrarySnapshot,
  InstalledContentPackage,
  ContentPackageAction,
} from '../src/types/contentPackages'

test('real content page uses package plans and keeps a running host unchanged until manual restart', async ({
  page,
}, testInfo) => {
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
      hasSelection: true,
      serviceStatus: { status: 'running', url: 'http://127.0.0.1:12345', projectName: 'local', serverId: 'test' },
      serviceNeedsRestart: false,
    }
    let draft: string[] = []
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
        selectContentPackageFile: async () => ({
          id: 'install',
          kind: 'install',
          package: { ...pkg, id: 'second', title: '另一个包', name: '@example/second' },
          requiresApproval: true,
        }),
        inspectNpmContentPackage: async () => {
          throw new Error('Exact versions only')
        },
        contentPackageAction: async (input: ContentPackageAction) => {
          if (input.action === 'plan-selection') {
            draft = [...input.ids]
            return {
              id: 'selection',
              kind: 'selection',
              ids: draft,
              graph: pkg.graph,
              contentIds: pkg.contentIds,
              newDependencies: [],
              requiresApproval: false,
            }
          }
          if (input.action === 'apply-selection') {
            snapshot.activeIds = draft
            snapshot.revision++
            snapshot.serviceNeedsRestart = true
          }
          if (input.action === 'confirm-install') {
            snapshot.packages.push({ ...pkg, id: 'second', title: '另一个包', name: '@example/second' })
            return 'second'
          }
          if (input.action === 'start') {
            snapshot.serviceStatus = {
              status: 'running',
              url: 'http://127.0.0.1:12345',
              projectName: 'local',
              serverId: 'test',
            }
            snapshot.serviceNeedsRestart = false
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
  await page.getByRole('button', { name: '检查并应用更改', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('当前服务和对局继续使用原内容')
  await page.getByRole('button', { name: '确认应用', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('停止并重新启动')
  await page.getByRole('button', { name: '添加内容包', exact: true }).click()
  await page.getByRole('button', { name: '选择本地 .tgz 文件', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('允许此包及其依赖在本机进程中运行')
  await page.getByRole('button', { name: '安装并允许运行', exact: true }).click()
  await expect(main.getByRole('heading', { name: '另一个包', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('content-packages-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '返回内容包列表', exact: true }).click()
  await page.getByRole('button', { name: /创作测试内容/ }).click()
  await expect(main.getByRole('heading', { name: '创作测试内容', exact: true })).toBeVisible()
  expect(await main.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('content-packages-mobile.png'), fullPage: true })
  await page.goto('/settings/local-service')
  await expect(page.getByRole('heading', { name: '本机服务', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '停止本机服务', exact: true }).click()
  await expect(page.getByRole('button', { name: '启动本机服务', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '启动本机服务', exact: true }).click()
  await expect(page.locator('main.local-service')).toContainText('运行中：http://127.0.0.1:12345')
})

test('browser content is read-only and desktop authoring and host routes stay closed', async ({ page }) => {
  await page.goto('/content')
  await expect(page.locator('main.content-page')).toContainText('网页端只读')
  await expect(page.getByRole('button', { name: '添加内容包', exact: true })).toHaveCount(0)
  await expect(page.locator('main.content-page input[type=checkbox]')).toHaveCount(0)
  await expect(page.locator('main.content-page')).toContainText('尚未进入房间')
  for (const route of ['/creator', '/creator/development', '/settings/local-service']) {
    await page.goto(route)
    await expect(page.getByRole('heading', { name: '本地内容工具', exact: true })).toBeVisible()
    await expect(page.locator('main button')).toHaveCount(0)
  }
})
