import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import LocalServicePage from '../LocalServicePage.vue'
import ServerSettingsForm from '@/features/management/ServerSettingsForm.vue'
import type { ManagementIpcRequest } from '@/services/managementClient'

const pages: ReturnType<typeof mount>[] = []
afterEach(() => {
  pages.splice(0).forEach(page => page.unmount())
  vi.unstubAllGlobals()
})
function setup() {
  const server = {
    id: 'desktop-test',
    revision: 4,
    name: '本机',
    workspaceId: 'local',
    status: 'running',
    draining: false,
    activeBattles: 1,
    settings: {
      host: '0.0.0.0',
      port: 8123,
      corsOrigins: ['arcadia-client://app'],
      battleCapacity: { maxConcurrentBattles: 2, maxIdleWorkers: 1, maxQueuedBattles: 4, battleQueueTimeoutMs: 5000 },
    },
    pendingRestart: ['port'],
  }
  const status = {
    status: 'running',
    url: 'http://127.0.0.1:8123',
    serverId: server.id,
    projectName: 'client',
    network: {
      host: '0.0.0.0',
      port: 8123,
      scope: 'network',
      availableHosts: ['192.168.8.4'],
      inviteUrls: ['http://192.168.8.4:8123'],
    },
  }
  const request = vi.fn(async (input: ManagementIpcRequest) => ({
    status: 200,
    body: input.method === 'GET' ? { servers: [structuredClone(server)] } : structuredClone(server),
  }))
  const stop = vi.fn(async (input?: { force?: boolean }) => {
    server.draining = true
    if (!input?.force) throw new Error('已停止接纳新局，仍有 1 场对战进行中')
    return { status: 'idle' }
  })
  vi.stubGlobal('arcadiaDesktop', {
    managementRequest: request,
    getLocalBattleStatus: async () => structuredClone(status),
    listContentPackages: async () => ({ packages: [], activeIds: [], hasSelection: true }),
    listContentProjects: async () => [],
    stopLocalBattle: stop,
  })
  const page = mount(LocalServicePage, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
  pages.push(page)
  return { page, server, request, stop }
}
const button = (page: ReturnType<typeof mount>, label: string) =>
  page.findAll('button').find(item => item.text() === label)!
it('shows usable LAN invitations and the shared pending-restart settings panel', async () => {
  const { page } = setup()
  await flushPromises()
  expect(page.find('code').text()).toBe('http://192.168.8.4:8123')
  expect(page.find('code').text()).not.toContain('0.0.0.0')
  expect(page.text()).toContain('重启服务器后应用')
  expect(page.findComponent(ServerSettingsForm).props('canEdit')).toBe(true)
})
it('saves desired listener settings through owner IPC with the edited revision', async () => {
  const { page, server, request } = setup()
  await flushPromises()
  page
    .findComponent(ServerSettingsForm)
    .vm.$emit('save', { ...server.settings, host: '192.168.8.4', publicOrigin: null }, 4)
  await flushPromises()
  const saved = request.mock.calls.find(([input]) => input.method === 'PATCH')?.[0]
  expect(saved?.path).toBe('/servers/desktop-test')
  expect(saved?.headers?.['If-Match']).toBe('"4"')
  expect(saved?.body).toMatchObject({ settings: { host: '192.168.8.4' } })
  expect(page.text()).toContain('网络与容量设置已保存')
})
it('preserves active games until the owner explicitly checks the interruption choice', async () => {
  const { page, stop } = setup()
  await flushPromises()
  await button(page, '排空后停止托管').trigger('click')
  await flushPromises()
  expect(stop).toHaveBeenLastCalledWith({ force: false })
  expect(page.find('[role="alert"]').text()).toContain('仍有 1 场对战')
  const choice = page.findAll('label').find(label => label.text().includes('立即中断正在进行'))!
  await choice.find('input').setValue(true)
  await button(page, '立即中断并停止').trigger('click')
  await flushPromises()
  expect(stop).toHaveBeenLastCalledWith({ force: true })
})
