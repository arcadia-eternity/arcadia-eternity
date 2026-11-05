import { expect, test } from 'playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let snapshot: Record<string, unknown> = { host: { status: 'idle' }, phase: 'idle', configured: false }
    const calls: unknown[] = []
    const scope = { kind: 'server', id: 'desktop-test' }
    Object.assign(window, { serverUxCalls: calls })
    const server = {
      id: 'desktop-test',
      name: '朋友联机',
      revision: 1,
      workspaceId: 'workspace',
      status: 'running',
      draining: false,
    }
    Object.defineProperty(window, 'arcadiaDesktop', {
      value: {
        getBackendConfig: async () => ({ schemaVersion: 1, backendOrigin: location.origin, autoConnect: false }),
        getLocalServerPort: async () => null,
        prepareLocalContent: async () => ({
          token: 'test-metadata',
          content: { species: [], skills: [], marks: [] },
          environment: { revision: 'test', data: { species: [], skills: [], marks: [] }, modules: [] },
        }),
        releaseLocalContent: async () => {},
        getAppVersion: async () => 'test',
        listWorkspacePacks: async () => [],
        listCachedPets: async () => [],
        getLocalBattleStatus: async () => structuredClone(snapshot.host),
        openServerWebsite: async (input: unknown) => {
          calls.push({ website: input })
        },
        openRemotePlay: async (input: unknown) => {
          calls.push(input)
        },
        localServer: async (input: { action: string; configuration?: unknown }) => {
          if (input.action === 'status') return structuredClone(snapshot)
          calls.push(input)
          if (input.action === 'start') {
            snapshot = { ...snapshot, phase: 'preparing' }
            await new Promise(resolve => setTimeout(resolve, 100))
            snapshot = {
              configured: true,
              phase: 'ready',
              host: {
                status: 'running',
                url: 'http://127.0.0.1:8102',
                serverId: 'desktop-test',
                projectName: 'official',
                network: {
                  host: '0.0.0.0',
                  port: 8102,
                  scope: 'network',
                  inviteUrls: ['http://192.168.1.23:8102'],
                  availableHosts: ['192.168.1.23'],
                },
              },
            }
          } else if (input.action === 'stop') snapshot = { configured: true, phase: 'idle', host: { status: 'idle' } }
          return structuredClone(snapshot)
        },
        managementRequest: async (input: { path: string }) => {
          const response =
            input.path === '/session'
              ? { principalId: 'owner', serverId: server.id, workspaceId: 'workspace' }
              : input.path === '/capabilities'
                ? {
                    serverId: server.id,
                    workspaceId: 'workspace',
                    supportedFeatures: ['server.bindings'],
                    effectivePermissions: [{ scope, actions: ['read', 'settings.manage'] }],
                    resourceRestrictions: [],
                  }
                : input.path === '/servers'
                  ? { servers: [server] }
                  : input.path === '/workspaces'
                    ? { workspaces: [] }
                    : input.path.endsWith('/bindings')
                      ? { bindings: [] }
                      : {}
          return { status: 200, body: response }
        },
      },
    })
  })
})

for (const width of [1280, 390]) {
  test(`home → host → manage is visible and never opens a file chooser (${width})`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    let fileChoosers = 0
    page.on('filechooser', () => fileChoosers++)
    await page.goto('/')
    await page.getByRole('heading', { name: '对战大厅', exact: true }).waitFor()
    await expect(page.getByText('初始化中', { exact: true })).not.toBeVisible()
    await expect(page.getByRole('heading', { name: '私人房间', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true })
    await page.getByRole('button', { name: '在本机开服', exact: true }).click()
    await expect(page.getByLabel('服务器名称')).toBeVisible()
    await page.getByLabel('服务器名称').fill('朋友联机')
    await page.getByRole('button', { name: '启动服务器', exact: true }).click()
    await expect(page.getByRole('button', { name: '进入本机大厅', exact: true })).toBeVisible()
    await expect(page.getByText('http://192.168.1.23:8102', { exact: true })).toBeVisible()
    await expect(page.getByText('当前游玩：离线', { exact: true })).toBeVisible()
    expect(fileChoosers).toBe(0)
    expect(await page.evaluate(() => (window as unknown as { serverUxCalls: unknown[] }).serverUxCalls)).toEqual([
      { action: 'start', configuration: { name: '朋友联机', scope: 'lan', port: 8102, content: 'official' } },
    ])
    expect(await page.locator('main.server-page').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('server-running.png'), fullPage: true })
    await page.getByRole('link', { name: '管理服务器', exact: true }).click()
    await expect(page.getByRole('heading', { name: '服务器管理', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '朋友联机', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('management.png'), fullPage: true })
    await page.getByRole('link', { name: '← 返回服务器', exact: true }).click()
    await page.getByRole('button', { name: '等待对局结束后停止', exact: true }).click()
    await expect(page.getByRole('button', { name: '使用已保存配置启动', exact: true })).toBeVisible()
  })
}
test('joining and managing a remote server use separate explicit intents', async ({ page }) => {
  await page.goto('/servers')
  await page.getByLabel('服务器地址', { exact: true }).fill('https://friends.example.com')
  await page.getByRole('button', { name: '管理登录', exact: true }).first().click()
  expect(await page.evaluate(() => (window as unknown as { serverUxCalls: unknown[] }).serverUxCalls)).toEqual([
    { url: 'https://friends.example.com', mode: 'management' },
  ])
  await page.getByRole('button', { name: '用客户端连接', exact: true }).first().click()
  await page.getByRole('button', { name: '在浏览器中打开', exact: true }).first().click()
  expect(await page.evaluate(() => (window as unknown as { serverUxCalls: unknown[] }).serverUxCalls)).toEqual([
    { url: 'https://friends.example.com', mode: 'management' },
    { url: 'https://friends.example.com', mode: 'play' },
    { website: { url: 'https://friends.example.com' } },
  ])
})
