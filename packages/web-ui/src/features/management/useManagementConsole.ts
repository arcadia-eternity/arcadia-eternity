import { restoreManagementSession, managementSessionChanged } from '@/services/managementSession'
import { computed, ref, shallowRef } from 'vue'
import { ManagementError, type ManagementClient, type ManagementRequestOptions } from '@/services/managementClient'
import type {
  ManagedAccount,
  ManagedPlayer,
  ManagedBattle,
  ManagementAuditEntry,
  ManagedServiceCredential,
  ManagedBinding,
  ManagedEnvironment,
  ManagedEnvironmentVersion,
  ManagedServer,
  ManagementCapabilities,
  ManagementGrant,
  ManagementOperation,
  ManagementScope,
} from '@/types/management'
import { hasManagementPermission } from '@/types/management'

const MAX_BACKUP_BYTES = 512 * 1024 * 1024
/** Accept download metadata only for this completed operation's bounded, same-target archive. */
export function serverBackupDownload(operation: ManagementOperation) {
  const result = operation.result
  if (
    operation.kind !== 'server.backup' ||
    operation.status !== 'succeeded' ||
    !/^[a-f0-9]{64}$/.test(operation.id) ||
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result)
  )
    return undefined
  const value = result as Record<string, unknown>
  if (
    value.downloadPath !== `/api/management/v1/backups/${operation.id}` ||
    typeof value.filename !== 'string' ||
    !value.filename ||
    value.filename.length > 255 ||
    typeof value.bytes !== 'number' ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 ||
    value.bytes > MAX_BACKUP_BYTES ||
    typeof value.expiresAt !== 'number' ||
    !Number.isFinite(value.expiresAt) ||
    value.expiresAt <= 0
  )
    return undefined
  return { path: `/backups/${operation.id}`, filename: value.filename, bytes: value.bytes, expiresAt: value.expiresAt }
}

/** Each async operation captures a client; results cannot cross a management target switch. */
export function useManagementConsole() {
  const client = shallowRef<ManagementClient>()
  const capabilities = ref<ManagementCapabilities>()
  const servers = ref<ManagedServer[]>([])
  const environments = ref<ManagedEnvironment[]>([])
  const versions = ref<ManagedEnvironmentVersion[]>([])
  const bindings = ref<ManagedBinding[]>([])
  const operations = ref<ManagementOperation[]>([])
  const grants = ref<ManagementGrant[]>([])
  const credentials = ref<ManagedServiceCredential[]>([])
  const accounts = ref<ManagedAccount[]>([])
  const players = ref<ManagedPlayer[]>([])
  const battles = ref<ManagedBattle[]>([])
  const audit = ref<ManagementAuditEntry[]>([])
  const accountCursor = ref<string>()
  const loading = ref(false),
    busy = ref(false),
    loginRequired = ref(false),
    error = ref(''),
    notice = ref('')
  const managementPrincipalId = ref('')
  let accountProof: string | undefined
  let generation = 0
  let refreshSequence = 0
  let accountPages = 1
  let observedIdentity: { serverId: string; workspaceId: string } | undefined
  const pendingKeys = new Map<string, string>()
  const server = computed(() => servers.value.find(item => item.id === capabilities.value?.serverId))
  const workspaceId = computed(() => capabilities.value?.workspaceId)
  const scope = (kind: ManagementScope['kind']): ManagementScope => ({
    kind,
    id: kind === 'server' ? (capabilities.value?.serverId ?? '') : (workspaceId.value ?? ''),
  })
  const can = (kind: ManagementScope['kind'], action: string) =>
    hasManagementPermission(capabilities.value, scope(kind), action)
  const canBackup = computed(
    () =>
      !!capabilities.value?.supportedFeatures.includes('server.backup') &&
      can('server', 'backup') &&
      can('workspace', 'export'),
  )
  function clear() {
    capabilities.value = undefined
    managementPrincipalId.value = ''
    servers.value = []
    environments.value = []
    versions.value = []
    bindings.value = []
    operations.value = []
    grants.value = []
    credentials.value = []
    accounts.value = []
    players.value = []
    battles.value = []
    audit.value = []
    accountCursor.value = undefined
    accountPages = 1
  }
  function setClient(next: ManagementClient | undefined) {
    generation++
    refreshSequence++
    client.value = next
    clear()
    busy.value = false
    loading.value = false
    loginRequired.value = false
    error.value = ''
    notice.value = ''
    pendingKeys.clear()
    observedIdentity = undefined
    accountProof = undefined
  }
  function failure(cause: unknown) {
    const initialLogin =
      !capabilities.value && cause instanceof ManagementError && cause.code === 'MANAGEMENT_UNAUTHENTICATED'
    if (cause instanceof ManagementError && cause.status === 401) {
      loginRequired.value = true
      clear()
    }
    error.value = initialLogin ? '' : cause instanceof Error ? cause.message : '无法完成管理操作'
  }
  async function restoreSession(proof = accountProof) {
    const current = client.value,
      epoch = generation
    if (!current || current.context.transport === 'ipc') return
    accountProof = proof
    try {
      const session = await restoreManagementSession(current, proof)
      if (epoch !== generation) return
      current.setCsrfToken(session.csrfToken)
      managementPrincipalId.value = session.principalId
      loginRequired.value = false
    } catch (cause) {
      if (epoch === generation) {
        failure(cause)
        loginRequired.value = true
      }
    }
  }
  const refresh = () => refreshCurrent(true)
  async function refreshCurrent(recoverSession: boolean) {
    const current = client.value,
      epoch = generation,
      sequence = ++refreshSequence
    if (!current || loginRequired.value) return
    loading.value = true
    const valid = () => epoch === generation && sequence === refreshSequence
    try {
      const cap = await current.request<ManagementCapabilities>('GET', '/capabilities')
      if (!valid()) return
      if (current.context.serverId && cap.serverId !== current.context.serverId)
        throw new Error('管理目标身份已变化，请重新连接')
      if (
        observedIdentity &&
        (cap.serverId !== observedIdentity.serverId || cap.workspaceId !== observedIdentity.workspaceId)
      ) {
        clear()
        throw new Error('管理目标身份已变化，请重新连接')
      }
      observedIdentity = { serverId: cap.serverId, workspaceId: cap.workspaceId }
      const allowed = (kind: ManagementScope['kind'], action: string) =>
        hasManagementPermission(cap, { kind, id: kind === 'server' ? cap.serverId : cap.workspaceId }, action)
      const supports = (feature: string) => cap.supportedFeatures.includes(feature)
      async function liveWindow<T>(resource: 'players' | 'battles', key: (item: T) => string) {
        const result = new Map<string, T>()
        let cursor: string | undefined
        do {
          const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
          const next = await current!.request<{ nextCursor?: string } & Record<string, unknown>>(
            'GET',
            `/servers/${encodeURIComponent(cap.serverId)}/${resource}${query}`,
          )
          for (const item of next[resource] as T[]) result.set(key(item), item)
          if (next.nextCursor && cursor && next.nextCursor <= cursor) throw new Error('服务器返回了无效的分页游标')
          cursor = next.nextCursor
        } while (valid() && cursor)
        return [...result.values()]
      }
      async function accountWindow() {
        const result: { accounts: ManagedAccount[]; nextCursor?: string } = { accounts: [] }
        const seen = new Set<string>()
        const pages = accountPages
        for (let page = 0; page < pages; page++) {
          const query = result.nextCursor ? `&cursor=${encodeURIComponent(result.nextCursor)}` : ''
          const next = await current!.request<{ accounts: ManagedAccount[]; nextCursor?: string }>(
            'GET',
            `/servers/${encodeURIComponent(cap.serverId)}/accounts?limit=50${query}`,
          )
          for (const account of next.accounts) {
            if (!seen.has(account.accountId)) result.accounts.push(account)
            seen.add(account.accountId)
          }
          result.nextCursor = next.nextCursor
          if (!valid() || !next.nextCursor) break
        }
        return result
      }
      const [
        serverRows,
        envRows,
        bindingRows,
        operationRows,
        grantRows,
        accountRows,
        credentialRows,
        playerRows,
        battleRows,
        auditRows,
      ] = await Promise.all([
        allowed('server', 'read')
          ? current.request<{ servers: ManagedServer[] }>('GET', '/servers')
          : Promise.resolve({ servers: [] }),
        supports('workspace.environments') && allowed('workspace', 'read')
          ? current.request<{ environments: ManagedEnvironment[]; versions: ManagedEnvironmentVersion[] }>(
              'GET',
              `/workspaces/${encodeURIComponent(cap.workspaceId)}/environments`,
            )
          : Promise.resolve({ environments: [], versions: [] }),
        supports('server.bindings') && allowed('server', 'read')
          ? current.request<{ bindings: ManagedBinding[] }>(
              'GET',
              `/servers/${encodeURIComponent(cap.serverId)}/bindings`,
            )
          : Promise.resolve({ bindings: [] }),
        supports('operations')
          ? current.request<{ operations: ManagementOperation[] }>('GET', '/operations')
          : Promise.resolve({ operations: [] }),
        supports('grants') && (allowed('server', 'grants.manage') || allowed('workspace', 'grants.manage'))
          ? current.request<{ grants: ManagementGrant[] }>('GET', '/grants')
          : Promise.resolve({ grants: [] }),
        supports('accounts') && allowed('server', 'accounts.manage')
          ? accountWindow()
          : Promise.resolve({ accounts: [], nextCursor: undefined }),
        supports('credentials')
          ? current.request<{ credentials: ManagedServiceCredential[] }>('GET', '/credentials')
          : Promise.resolve({ credentials: [] }),
        supports('server.players') && allowed('server', 'players.read')
          ? liveWindow<ManagedPlayer>('players', player => player.seatId)
          : Promise.resolve([]),
        supports('server.battles') && allowed('server', 'battles.read')
          ? liveWindow<ManagedBattle>('battles', battle => battle.id)
          : Promise.resolve([]),
        supports('audit') && allowed('server', 'read')
          ? current.request<{ entries: ManagementAuditEntry[] }>('GET', '/audit')
          : Promise.resolve({ entries: [] }),
      ])
      if (!valid()) return
      capabilities.value = cap
      servers.value = serverRows.servers
      environments.value = envRows.environments
      versions.value = envRows.versions
      bindings.value = bindingRows.bindings
      operations.value = operationRows.operations
      grants.value = grantRows.grants
      credentials.value = credentialRows.credentials
      accounts.value = accountRows.accounts
      players.value = playerRows
      battles.value = battleRows
      audit.value = auditRows.entries
      accountCursor.value = accountRows.nextCursor
      loginRequired.value = false
      error.value = ''
    } catch (cause) {
      if (valid()) {
        failure(cause)
        if (
          recoverSession &&
          cause instanceof ManagementError &&
          cause.status === 401 &&
          current.context.transport === 'http'
        ) {
          await restoreSession()
          if (valid() && !loginRequired.value) await refreshCurrent(false)
        }
      }
    } finally {
      if (valid()) loading.value = false
    }
  }
  async function loginRequest(path: string, options: ManagementRequestOptions) {
    const current = client.value
    if (!current || busy.value) return
    const epoch = ++generation
    refreshSequence++
    busy.value = true
    error.value = ''
    try {
      const session = await current.request<{ csrfToken: string; principalId: string }>('POST', path, options)
      if (epoch !== generation) return
      current.setCsrfToken(session.csrfToken)
      loginRequired.value = false
      managementPrincipalId.value = session.principalId
      await refresh()
      managementSessionChanged()
    } catch (cause) {
      if (epoch === generation) failure(cause)
    } finally {
      if (epoch === generation) busy.value = false
    }
  }
  const login = (code: string, remember = false) => loginRequest('/session/bootstrap', { body: { code, remember } })
  const loginPasskey = (body: unknown) => loginRequest('/session/passkey', { body })
  const loginAccount = (accountProof: string) => loginRequest('/session/account', { accountProof })
  async function loadMoreAccounts() {
    const current = client.value,
      epoch = generation,
      cursor = accountCursor.value,
      id = capabilities.value?.serverId
    if (!current || !cursor || !id || busy.value) return
    refreshSequence++
    loading.value = false
    busy.value = true
    try {
      const result = await current.request<{ accounts: ManagedAccount[]; nextCursor?: string }>(
        'GET',
        `/servers/${encodeURIComponent(id)}/accounts?limit=50&cursor=${encodeURIComponent(cursor)}`,
      )
      if (epoch !== generation || cursor !== accountCursor.value) return
      const existing = new Set(accounts.value.map(account => account.accountId))
      accounts.value.push(...result.accounts.filter(account => !existing.has(account.accountId)))
      accountCursor.value = result.nextCursor
      accountPages++
    } catch (cause) {
      if (epoch === generation) failure(cause)
    } finally {
      if (epoch === generation) busy.value = false
    }
  }
  async function logout() {
    const current = client.value,
      epoch = ++generation
    if (!current) return
    refreshSequence++
    busy.value = false
    loading.value = false
    try {
      await current.request('POST', '/session/logout')
      if (epoch !== generation) return
      current.setCsrfToken(undefined)
      clear()
      loginRequired.value = true
      notice.value = ''
      managementSessionChanged()
    } catch (cause) {
      if (epoch === generation) failure(cause)
    }
  }
  async function read<T>(path: string): Promise<T | undefined> {
    const current = client.value,
      epoch = generation
    if (!current) return
    try {
      const result = await current.request<T>('GET', path)
      return epoch === generation ? result : undefined
    } catch (cause) {
      if (epoch === generation) failure(cause)
      return undefined
    }
  }
  async function mutate<T = unknown>(
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    revision?: number | string,
    receive?: (result: T) => void,
  ) {
    const current = client.value,
      epoch = generation
    if (!current || busy.value) return false
    busy.value = true
    error.value = ''
    notice.value = ''
    const signature = JSON.stringify([method, path, body, revision])
    const key = pendingKeys.get(signature) ?? crypto.randomUUID()
    pendingKeys.set(signature, key)
    try {
      const result = await current.request<T>(method, path, { body, revision, idempotencyKey: key })
      if (epoch !== generation) return false
      pendingKeys.delete(signature)
      receive?.(result)
      notice.value = '操作已提交，可在任务与资源状态中查看结果。'
      await refresh()
      return true
    } catch (cause) {
      if (epoch === generation) failure(cause)
      return false
    } finally {
      if (epoch === generation) busy.value = false
    }
  }
  async function createServerBackup() {
    if (!canBackup.value || !server.value) return false
    const epoch = generation
    const submitted = await mutate('POST', `/servers/${encodeURIComponent(server.value.id)}/backup`, {})
    return submitted && epoch === generation
  }
  async function readServerBackup(operation: ManagementOperation) {
    const info = serverBackupDownload(operation),
      epoch = generation
    if (
      !canBackup.value ||
      busy.value ||
      !info ||
      info.expiresAt <= Date.now() ||
      !operations.value.some(current => current.id === operation.id && current.kind === 'server.backup')
    )
      return undefined
    const archive = await read<unknown>(info.path)
    if (archive === undefined || epoch !== generation || !canBackup.value) return undefined
    return { archive, filename: info.filename }
  }
  return {
    client,
    capabilities,
    managementPrincipalId,
    servers,
    server,
    workspaceId,
    environments,
    versions,
    bindings,
    operations,
    grants,
    credentials,
    accounts,
    players,
    battles,
    audit,
    accountCursor,
    loadMoreAccounts,
    loading,
    busy,
    loginRequired,
    error,
    notice,
    can,
    canBackup,
    setClient,
    restoreSession,
    refresh,
    login,
    loginAccount,
    loginPasskey,
    logout,
    mutate,
    read,
    createServerBackup,
    readServerBackup,
  }
}
