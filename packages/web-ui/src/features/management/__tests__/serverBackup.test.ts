import { describe, expect, it, vi } from 'vitest'
import { serverBackupDownload, useManagementConsole } from '../useManagementConsole'
import type { ManagementClient, ManagementMethod, ManagementRequestOptions } from '@/services/managementClient'
import { ManagementError } from '@/services/managementClient'
import type { ManagementCapabilities, ManagementOperation } from '@/types/management'

const task = (overrides: Record<string, unknown> = {}): ManagementOperation => ({
  id: 'a'.repeat(64),
  kind: 'server.backup',
  status: 'succeeded',
  result: {
    downloadPath: `/api/management/v1/backups/${'a'.repeat(64)}`,
    filename: 'server-backup.json',
    bytes: 1234,
    expiresAt: Date.now() + 60000,
    ...overrides,
  },
})
const capabilities = (): ManagementCapabilities => ({
  serverId: 'server-a',
  workspaceId: 'workspace-a',
  supportedFeatures: ['server.backup', 'operations'],
  effectivePermissions: [
    { scope: { kind: 'server', id: 'server-a' }, actions: ['read', 'backup'] },
    { scope: { kind: 'workspace', id: 'workspace-a' }, actions: ['export'] },
  ],
  resourceRestrictions: [],
})
function deferred<T = unknown>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
async function open(
  input: {
    cap?: ManagementCapabilities
    operation?: ManagementOperation
    handler?: (method: ManagementMethod, path: string) => Promise<unknown>
  } = {},
) {
  let cap = input.cap ?? capabilities()
  const operation = input.operation ?? task()
  const request = vi.fn(async (method: ManagementMethod, path: string, _options?: ManagementRequestOptions) => {
    if (path === '/capabilities') return cap
    if (path === '/servers')
      return {
        servers: [
          {
            id: 'server-a',
            revision: 1,
            name: '服务器',
            workspaceId: 'workspace-a',
            draining: false,
            status: 'available',
          },
        ],
      }
    if (path === '/operations') return { operations: [operation] }
    return input.handler?.(method, path)
  })
  const client: ManagementClient = {
    context: { transport: 'ipc', endpoint: 'local', label: '本机' },
    request: request as ManagementClient['request'],
    setCsrfToken() {},
  }
  const state = useManagementConsole()
  state.setClient(client)
  await state.refresh()
  return {
    state,
    request,
    operation,
    updateCapabilities(next: ManagementCapabilities) {
      cap = next
    },
  }
}

describe('whole-server backup management', () => {
  it.each(['capability', 'server-permission', 'workspace-permission'])(
    'requires both scoped permissions and advertised capability: %s',
    async missing => {
      const cap = capabilities()
      if (missing === 'capability') cap.supportedFeatures = ['operations']
      else cap.effectivePermissions[missing === 'server-permission' ? 0 : 1]!.actions = ['read']
      const { state, request, operation } = await open({ cap })
      expect(state.canBackup.value).toBe(false)
      expect(await state.createServerBackup()).toBe(false)
      expect(await state.readServerBackup(operation)).toBeUndefined()
      expect(request.mock.calls.some(([method, path]) => method === 'POST' || path.startsWith('/backups/'))).toBe(false)
    },
  )

  it('captures the server, prevents duplicate busy requests, and preserves the idempotency key after failure', async () => {
    const pending = deferred()
    let attempt = 0
    const { state, request } = await open({
      handler: async () => (++attempt === 1 ? pending.promise : { id: 'job', status: 'queued' }),
    })
    const starting = state.createServerBackup()
    expect(state.busy.value).toBe(true)
    expect(await state.createServerBackup()).toBe(false)
    pending.reject(new ManagementError('CONNECTION_FAILED', '备份提交连接中断'))
    expect(await starting).toBe(false)
    expect(state.error.value).toBe('备份提交连接中断')
    expect(state.busy.value).toBe(false)
    expect(await state.createServerBackup()).toBe(true)
    const writes = request.mock.calls.filter(([method]) => method === 'POST')
    expect(writes).toHaveLength(2)
    expect(writes[0]?.[1]).toBe('/servers/server-a/backup')
    expect(writes[0]?.[2]?.body).toEqual({})
    expect(writes[0]?.[2]?.idempotencyKey).toBeTruthy()
    expect(writes[1]?.[2]?.idempotencyKey).toBe(writes[0]?.[2]?.idempotencyKey)
  })

  it('validates matching metadata, byte limits and expiry before reading the explicit backup', async () => {
    const { state, request, operation } = await open({ handler: async () => ({ format: 'arcadia.server-backup/1' }) })
    expect(await state.readServerBackup(task({ expiresAt: Date.now() - 1 }))).toBeUndefined()
    for (const invalid of [
      { downloadPath: 'https://other.example/archive' },
      { downloadPath: `/api/management/v1/backups/${'b'.repeat(64)}` },
      { bytes: 512 * 1024 * 1024 + 1 },
      { bytes: -1 },
      { bytes: 0.5 },
      { expiresAt: Infinity },
      { filename: '' },
    ])
      expect(serverBackupDownload(task(invalid))).toBeUndefined()
    expect(serverBackupDownload({ ...operation, status: 'running' })).toBeUndefined()
    expect(serverBackupDownload({ ...operation, kind: 'environment.export' })).toBeUndefined()
    expect(await state.readServerBackup(operation)).toEqual({
      archive: { format: 'arcadia.server-backup/1' },
      filename: 'server-backup.json',
    })
    expect(request.mock.calls.filter(([, path]) => path.startsWith('/backups/'))).toHaveLength(1)
  })

  it.each(['target', 'permission'] as const)('discards downloads after a %s change', async change => {
    const pending = deferred()
    const { state, operation, updateCapabilities } = await open({ handler: async () => pending.promise })
    const downloading = state.readServerBackup(operation)
    if (change === 'target')
      state.setClient({
        context: { transport: 'ipc', endpoint: 'other', label: '另一个目标' },
        request: vi.fn(),
        setCsrfToken() {},
      })
    else {
      const cap = capabilities()
      cap.effectivePermissions[1]!.actions = []
      updateCapabilities(cap)
      await state.refresh()
    }
    pending.resolve({ private: 'old-server-data' })
    expect(await downloading).toBeUndefined()
  })
})
