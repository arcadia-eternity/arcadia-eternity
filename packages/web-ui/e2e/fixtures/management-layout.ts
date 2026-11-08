// Real management components with deterministic, in-memory management responses.
import { createApp, h } from 'vue'
import { loadDeploymentConfig } from '../../src/bootstrap/deployment'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
// Include the application's actual global styles without mounting its networked game shell.
import '../../src/App.vue'
import ManagementConsole from '../../src/features/management/ManagementConsole.vue'
import './management-layout.css'

const settings = {
  host: '127.0.0.1',
  port: 8102,
  corsOrigins: [],
  battleCapacity: { maxConcurrentBattles: 32, maxIdleWorkers: 4, maxQueuedBattles: 64, battleQueueTimeoutMs: 5000 },
}
const document = {
  schemaVersion: 2,
  id: 'friends',
  name: '好友环境',
  packages: { '@test/base': '1.0.0' },
  sources: [],
  rules: { schemaVersion: 1 },
  requires: {},
}
const data = (path: string): unknown => {
  if (path === '/capabilities')
    return {
      serverId: 'server',
      workspaceId: 'workspace',
      supportedFeatures: [
        'workspace.environments',
        'server.bindings',
        'server.drain',
        'operations',
        'audit',
        'grants',
        'accounts',
        'server.players',
        'server.battles',
      ],
      effectivePermissions: [
        { scope: { kind: 'server', id: 'server' }, actions: ['*'] },
        { scope: { kind: 'workspace', id: 'workspace' }, actions: ['*'] },
      ],
      resourceRestrictions: [],
    }
  if (path === '/servers')
    return {
      servers: [
        {
          id: 'server',
          name: 'Arcadia 测试服务器',
          workspaceId: 'workspace',
          revision: 1,
          status: 'running',
          draining: false,
          activeBattles: 3,
          queued: 0,
          settings,
          runtimeSettings: settings,
        },
      ],
    }
  if (path.endsWith('/environments')) return { environments: [{ document, revision: 'draft-1' }], versions: [] }
  if (path.endsWith('/bindings')) return { bindings: [] }
  if (path.startsWith('/servers/server/accounts')) return { accounts: [] }
  if (path.startsWith('/servers/server/players')) return { players: [] }
  if (path.startsWith('/servers/server/battles')) return { battles: [] }
  if (path === '/grants') return { grants: [] }
  if (path === '/operations')
    return {
      operations: Array.from({ length: 40 }, (_, i) => ({
        id: `operation-${i}`,
        kind: 'environment.prepare',
        status: i === 0 ? 'running' : 'succeeded',
        progress: i === 0 ? { stage: 'preparing', message: '正在准备固定版本' } : undefined,
      })),
    }
  if (path === '/audit')
    return {
      entries: Array.from({ length: 80 }, (_, i) => ({
        id: `audit-${i}`,
        action: 'account.session',
        actor: `admin-${i}`,
        target: 'target-' + 'x'.repeat(100),
        createdAt: 1794120000000 - i * 60000,
      })),
    }
  return {}
}
Object.assign(window, {
  arcadiaDesktop: {
    getBackendConfig: async () => ({ schemaVersion: 1, backendOrigin: window.location.origin }),
    managementRequest: async (input: { path: string; method: string }) => ({ status: 200, body: data(input.path) }),
  },
})
await loadDeploymentConfig()
const app = createApp({
  render: () =>
    h('div', { class: 'fixture-app' }, [
      h('header', { class: 'fixture-navigation' }, 'Arcadia Eternity'),
      h('main', { class: 'fixture-route' }, [h(ManagementConsole, { initialTarget: 'local', initialTab: 'tasks' })]),
    ]),
})
app.use(createPinia())
app.use(
  createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
  }),
)
app.mount('#app')
