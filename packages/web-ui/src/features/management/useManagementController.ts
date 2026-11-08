import { contentTaskError } from '@/utils/contentTaskMessages'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { getBackendOrigin } from '@/bootstrap/deployment'
import { useAuthStore } from '@/stores/auth'
import { createHttpManagementClient, createIpcManagementClient } from '@/services/managementClient'
import type {
  ManagedBinding,
  ManagedEnvironment,
  ManagedEnvironmentDocument,
  ManagedEnvironmentVersion,
  ManagedServerSettings,
  ManagementOperation,
  ManagementScope,
} from '@/types/management'
import { useManagementConsole } from './useManagementConsole'
import { suppressManagementAccount } from '@/services/managementSession'
import { startAuthentication } from '@simplewebauthn/browser'

export type ManagementTab =
  | 'environments'
  | 'server'
  | 'network'
  | 'battles'
  | 'accounts'
  | 'tasks'
  | 'security'
  | 'permissions'
export interface ManagementConsoleProps {
  initialTarget?: 'local' | 'server'
  initialTab?: ManagementTab
}
export function useManagementController(
  props: ManagementConsoleProps,
  emit: (event: 'navigate', value: { target: 'local' | 'server'; tab: ManagementTab }) => void,
) {
  const state = useManagementConsole()
  const auth = useAuthStore()
  const {
    client,
    capabilities,
    managementPrincipalId,
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
    loading,
    busy,
    loginRequired,
    error,
    notice,
    can,
    canBackup,
  } = state
  const localBridge = window.arcadiaDesktop?.managementRequest
  const target = ref<'local' | 'server'>(props.initialTarget ?? (localBridge ? 'local' : 'server'))
  const loginCode = ref('')
  const remember = ref(false)
  const accountLoginSupported = ref(false)
  const signingIn = ref(false)
  const sidebarOpen = ref(false)
  const passkeyAvailable = window.isSecureContext && !!window.PublicKeyCredential
  const environmentSaveSequence = ref(0)
  const serverName = ref('')
  const nameRevision = ref<number>()
  const settingsSaveSequence = ref(0)
  const bindingVersion = ref<Record<string, string>>({})
  const principalId = ref('')
  const newPrincipalName = ref('')
  const newPrincipalAccount = ref('')
  const deletingBinding = ref('')
  const referenceVersion = ref('')
  const versionReferences = ref<Record<string, string>[]>([])
  let referenceRequest = 0
  const downloading = ref('')
  const downloadUrls = new Map<string, ReturnType<typeof setTimeout>>()
  function clearDownloads() {
    downloading.value = ''
    for (const [url, timeout] of downloadUrls) {
      clearTimeout(timeout)
      URL.revokeObjectURL(url)
    }
    downloadUrls.clear()
  }
  function saveArchive(archive: unknown, filename: string) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(archive)], { type: 'application/json' }))
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = filename.replace(/[^a-zA-Z0-9_.-]/g, '_')
      link.click()
    } finally {
      downloadUrls.set(
        url,
        setTimeout(() => {
          URL.revokeObjectURL(url)
          downloadUrls.delete(url)
        }, 1000),
      )
    }
  }
  const issuedCredential = shallowRef<{ token: string; credentialId: string; expiresAt: number }>()
  async function deleteBinding(binding: ManagedBinding) {
    deletingBinding.value = ''
    await state.mutate('DELETE', `${serverPath.value}/bindings/${encode(binding.id)}`, undefined, binding.revision)
  }
  const grantRole = ref<'viewer' | 'server-admin' | 'workspace-admin'>('viewer')
  const tab = ref<
    'environments' | 'server' | 'network' | 'tasks' | 'security' | 'permissions' | 'accounts' | 'battles'
  >(props.initialTab ?? 'environments')
  let disposed = false
  let targetGeneration = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const serverPath = computed(() => (server.value ? `/servers/${encodeURIComponent(server.value.id)}` : ''))
  const workspacePath = computed(() =>
    workspaceId.value ? `/workspaces/${encodeURIComponent(workspaceId.value)}` : '',
  )
  const activeOperations = computed(
    () => operations.value.filter(operation => operation.status === 'queued' || operation.status === 'running').length,
  )
  const taskLabels: Record<string, string> = {
    queued: '等待中',
    running: '处理中',
    succeeded: '已完成',
    failed: '失败',
    cancelled: '已取消',
    interrupted: '执行中断',
  }
  const taskKinds: Record<string, string> = {
    'environment.prepare': '准备环境',
    'binding.publish': '发布环境',
    'environment.import': '导入环境',
    'environment.export': '导出环境',
    'server.backup': '服务器备份',
    'battle.terminate': '终止对战',
  }
  const auditLabels: Record<string, string> = {
    'account.session': '账户登录',
    'binding.publish': '发布环境',
    running: '任务开始',
    committed: '变更已提交',
    succeeded: '任务完成',
    failed: '任务失败',
    'battle.terminate': '终止对战',
    'account.deactivate': '停用账户',
    'grant.replace': '更新授权',
    'grant.revoke': '撤销授权',
    'principal.create': '创建管理身份',
  }
  const taskStages: Record<string, string> = {
    resolving: '解析依赖',
    acquiring: '获取来源',
    installing: '下载并安装',
    verifying: '校验材料',
    preparing: '准备固定版本',
    exporting: '正在导出环境',
    importing: '正在导入环境',
    capturing: '正在保存材料与状态',
    writing: '正在生成备份文件',
  }
  const conditionLabels: Record<string, string> = {
    available: '可用',
    applying: '正在应用',
    degraded: '需要处理',
    unavailable: '不可用',
    ready: '可用',
    running: '运行中',
    stopped: '已停止',
    disabled: '已停用',
  }
  const reason = (kind: 'workspace' | 'server', action: string) => (can(kind, action) ? undefined : '没有此操作的权限')
  const encode = encodeURIComponent
  const supported = (feature: string) => capabilities.value?.supportedFeatures.includes(feature) ?? false
  const manageGrants = computed(
    () => supported('grants') && (can('server', 'grants.manage') || can('workspace', 'grants.manage')),
  )
  const canActivateBinding = computed(() => can('server', 'publish') && can('workspace', 'environment.use'))
  const accessibleTabs = computed(() => {
    const allowed: NonNullable<typeof props.initialTab>[] = []
    if (can('server', 'read')) allowed.push('server', 'network')
    if (can('server', 'read') || can('workspace', 'read')) allowed.push('environments')
    if (supported('server.battles') && can('server', 'battles.read')) allowed.push('battles')
    if (
      (supported('server.players') && can('server', 'players.read')) ||
      (supported('accounts') && can('server', 'accounts.manage'))
    )
      allowed.push('accounts')
    if (supported('operations')) allowed.push('tasks')
    if (manageGrants.value) allowed.push('permissions')
    if (target.value === 'server') allowed.push('security')
    return allowed
  })
  watch([accessibleTabs, tab], () => {
    if (capabilities.value && !accessibleTabs.value.includes(tab.value) && accessibleTabs.value[0])
      tab.value = accessibleTabs.value[0]
  })

  watch(manageGrants, allowed => {
    if (!allowed) issuedCredential.value = undefined
  })
  const accountLoginAvailable = computed(
    () => target.value === 'server' && auth.isAccount && auth.serverUrl === client.value?.context.endpoint,
  )

  async function changeTarget(next: 'local' | 'server') {
    const generation = ++targetGeneration
    clearTimeout(timer)
    target.value = next
    loginCode.value = ''
    accountLoginSupported.value = false
    serverName.value = ''
    nameRevision.value = undefined
    bindingVersion.value = {}
    principalId.value = ''
    newPrincipalName.value = ''
    newPrincipalAccount.value = ''
    deletingBinding.value = ''
    referenceVersion.value = ''
    versionReferences.value = []
    referenceRequest++
    clearDownloads()
    issuedCredential.value = undefined
    tab.value = props.initialTab ?? 'environments'
    try {
      if (next === 'local') {
        if (!localBridge) throw new Error('此窗口不支持本机管理，请在客户端本机内容页面打开。')
        state.setClient(
          createIpcManagementClient(
            { transport: 'ipc', endpoint: 'local-workspace', label: '本机服务器' },
            localBridge,
          ),
        )
      } else {
        const endpoint = getBackendOrigin()
        state.setClient(
          createHttpManagementClient({
            transport: 'http',
            endpoint,
            label: `当前部署服务器 · ${new URL(endpoint).host}`,
          }),
        )
      }
      await state.restoreSession(accountLoginAvailable.value ? auth.session?.token : undefined)
      if (generation !== targetGeneration || disposed) return
      if (loginRequired.value && client.value) {
        try {
          const available = await client.value.request<{ supportedFeatures: string[] }>('GET', '/capabilities')
          if (generation !== targetGeneration || disposed) return
          accountLoginSupported.value = available.supportedFeatures.includes('accounts')
        } catch {
          accountLoginSupported.value = accountLoginAvailable.value
        }
      }
      await state.refresh()
      if (generation !== targetGeneration || disposed) return
      serverName.value = server.value?.name ?? ''
      schedule(generation)
    } catch (cause) {
      if (generation === targetGeneration) error.value = cause instanceof Error ? cause.message : '无法读取管理目标'
    }
  }
  function schedule(generation: number) {
    if (disposed || generation !== targetGeneration) return
    timer = setTimeout(
      async () => {
        if (!busy.value && !loginRequired.value) await state.refresh()
        schedule(generation)
      },
      document.hidden ? 10000 : activeOperations.value ? 1000 : 4000,
    )
  }
  async function login() {
    const code = loginCode.value.trim()
    loginCode.value = ''
    await state.login(code, remember.value)
    if (server.value) serverName.value = server.value.name
  }
  async function logout() {
    if (client.value) suppressManagementAccount(client.value.context.endpoint)
    await state.logout()
  }
  async function loginPasskey() {
    const current = client.value
    if (!current || signingIn.value || busy.value) return
    signingIn.value = true
    error.value = ''
    const generation = targetGeneration
    try {
      const request = await current.request<{
        options: Parameters<typeof startAuthentication>[0]['optionsJSON']
        challengeId: string
      }>('POST', '/session/passkey/options', { body: {} })
      const response = await startAuthentication({ optionsJSON: request.options })
      if (generation !== targetGeneration || disposed) return
      await state.loginPasskey({ challengeId: request.challengeId, response, remember: remember.value })
      if (server.value) serverName.value = server.value.name
    } catch (cause) {
      if (generation === targetGeneration) error.value = cause instanceof Error ? cause.message : '无法使用通行密钥登录'
    } finally {
      signingIn.value = false
    }
  }
  watch(
    () => auth.session?.token,
    async token => {
      if (!token || !loginRequired.value || !accountLoginAvailable.value) return
      await state.restoreSession(token)
      if (!disposed) await state.refresh()
    },
  )
  watch(
    () => props.initialTab,
    value => {
      if (value) tab.value = value
    },
  )
  watch(tab, () => {
    sidebarOpen.value = false
    emit('navigate', { target: target.value, tab: tab.value })
  })
  watch(target, () => emit('navigate', { target: target.value, tab: tab.value }))
  async function saveEnvironment(document: ManagedEnvironmentDocument, expectedRevision: string | null) {
    const path = `${workspacePath.value}/environments${expectedRevision === null ? '' : `/${encode(document.id)}`}`
    const saved = await state.mutate(
      expectedRevision === null ? 'POST' : 'PATCH',
      path,
      { document, expectedRevision },
      expectedRevision ?? undefined,
    )
    if (saved) environmentSaveSequence.value++
  }
  async function prepareEnvironment(environment: ManagedEnvironment) {
    const submitted = await state.mutate(
      'POST',
      `${workspacePath.value}/environments/${encode(environment.document.id)}/prepare`,
      { expectedRevision: environment.revision },
      environment.revision,
    )
    if (submitted) tab.value = 'tasks'
  }
  async function deleteEnvironment(environment: ManagedEnvironment) {
    await state.mutate(
      'DELETE',
      `${workspacePath.value}/environments/${encode(environment.document.id)}`,
      undefined,
      environment.revision,
    )
  }
  async function terminateBattle(id: string) {
    await state.mutate('POST', `${serverPath.value}/battles/${encode(id)}/terminate`)
  }
  async function useVersion(version: ManagedEnvironmentVersion, executionPolicy: 'server' | 'peer' = 'server') {
    if (version.status !== 'ready') return
    if (!server.value || !can('server', 'bindings.manage') || !can('workspace', 'environment.use')) {
      error.value = '使用环境需要该工作区的使用权限，以及目标服务器的绑定管理权限。'
      return
    }
    const succeeded = await state.mutate('POST', `${serverPath.value}/bindings`, {
      environmentId: version.environmentId,
      versionId: version.versionId,
      selection: 'pinned',
      enabled: true,
      visibility: 'private',
      matchmakingEnabled: false,
      executionPolicy,
    })
    if (succeeded) tab.value = 'environments'
  }
  async function inspectReferences(version: ManagedEnvironmentVersion) {
    const sequence = ++referenceRequest
    referenceVersion.value = ''
    versionReferences.value = []
    const result = await state.read<{ references: Record<string, string>[] }>(
      `${workspacePath.value}/versions/${encode(version.versionId)}/references`,
    )
    if (result && sequence === referenceRequest) {
      referenceVersion.value = version.versionId
      versionReferences.value = result.references
    }
  }
  async function exportEnvironment(version: ManagedEnvironmentVersion) {
    await state.mutate('POST', `${workspacePath.value}/versions/${encode(version.versionId)}/export`, {})
  }
  async function importEnvironment(input: {
    bundle: unknown
    environmentId?: string
    expectedRevision?: string | null
  }) {
    if (await state.mutate('POST', `${workspacePath.value}/import`, input)) tab.value = 'tasks'
  }
  async function downloadEnvironment(operation: ManagementOperation) {
    const result = operation.result as { downloadPath?: unknown; filename?: unknown; expiresAt?: unknown } | undefined
    if (
      operation.kind !== 'environment.export' ||
      operation.status !== 'succeeded' ||
      !result ||
      result.downloadPath !== `/api/management/v1/transfers/${operation.id}` ||
      typeof result.expiresAt !== 'number' ||
      result.expiresAt <= Date.now() ||
      downloading.value
    )
      return
    const generation = targetGeneration
    downloading.value = operation.id
    try {
      const bundle = await state.read<unknown>(`/transfers/${encode(operation.id)}`)
      if (bundle === undefined || generation !== targetGeneration) return
      saveArchive(bundle, typeof result.filename === 'string' ? result.filename : 'environment.json')
    } catch (cause) {
      if (generation === targetGeneration) error.value = cause instanceof Error ? cause.message : '无法下载环境'
    } finally {
      if (generation === targetGeneration) downloading.value = ''
    }
  }
  async function createBackup() {
    if (!downloading.value && (await state.createServerBackup())) tab.value = 'tasks'
  }
  async function downloadBackup(operation: ManagementOperation) {
    if (downloading.value) return
    const generation = targetGeneration
    downloading.value = operation.id
    try {
      const result = await state.readServerBackup(operation)
      if (!result || generation !== targetGeneration || disposed) return
      saveArchive(result.archive, result.filename)
    } catch (cause) {
      if (generation === targetGeneration) error.value = cause instanceof Error ? cause.message : '无法下载服务器备份'
    } finally {
      if (generation === targetGeneration) downloading.value = ''
    }
  }
  async function patchBinding(binding: ManagedBinding, patch: Partial<ManagedBinding>) {
    await state.mutate('PATCH', `${serverPath.value}/bindings/${encode(binding.id)}`, patch, binding.revision)
  }
  async function publish(binding: ManagedBinding) {
    const versionId = bindingVersion.value[binding.id] ?? binding.desiredVersionId ?? binding.effectiveVersionId
    if (!versionId) {
      error.value = '请先选择已准备的固定版本。'
      return
    }
    await state.mutate(
      'POST',
      `${serverPath.value}/bindings/${encode(binding.id)}/publish`,
      { versionId },
      binding.revision,
    )
  }
  async function setDefault(binding: ManagedBinding) {
    if (server.value)
      await state.mutate('PATCH', serverPath.value, { defaultBindingId: binding.id }, server.value.revision)
  }
  async function saveServerName() {
    if (
      server.value &&
      (await state.mutate(
        'PATCH',
        serverPath.value,
        { name: serverName.value },
        nameRevision.value ?? server.value.revision,
      ))
    )
      nameRevision.value = undefined
  }
  async function saveServerSettings(
    settings: Omit<ManagedServerSettings, 'publicOrigin'> & { publicOrigin: string | null },
    revision: number,
  ) {
    if (await state.mutate('PATCH', serverPath.value, { settings }, revision)) settingsSaveSequence.value++
  }
  async function drain() {
    await state.mutate('POST', `${serverPath.value}/drain`, { draining: !server.value?.draining })
  }
  async function createPrincipal() {
    const id = crypto.randomUUID()
    const kind = can('server', 'grants.manage') ? 'server' : 'workspace'
    if (
      await state.mutate('POST', '/principals', {
        id,
        displayName: newPrincipalName.value.trim(),
        scope: { kind, id: kind === 'server' ? capabilities.value?.serverId : workspaceId.value },
        ...(newPrincipalAccount.value.trim() ? { accountId: newPrincipalAccount.value.trim() } : {}),
      })
    ) {
      principalId.value = id
      newPrincipalName.value = ''
      newPrincipalAccount.value = ''
    }
  }
  async function deactivateAccount(accountId: string) {
    await state.mutate('POST', `${serverPath.value}/accounts/${encode(accountId)}/deactivate`)
  }
  async function issueCredential(input: {
    principalId?: string
    permissions: { scope: ManagementScope; actions: string[] }[]
    expiresAt: number
  }) {
    issuedCredential.value = undefined
    await state.mutate<{ token: string; credentialId: string; expiresAt: number }>(
      'POST',
      '/credentials',
      input,
      undefined,
      result => {
        issuedCredential.value = result
      },
    )
  }
  async function revokeCredential(id: string) {
    if (await state.mutate('POST', `/credentials/${encode(id)}/revoke`)) {
      if (issuedCredential.value?.credentialId === id) issuedCredential.value = undefined
    }
  }
  async function addGrant() {
    const workspace = grantRole.value === 'workspace-admin'
    const actions = workspace
      ? ['read', 'environment.use', 'edit', 'prepare', 'delete', 'export', 'grants.manage']
      : grantRole.value === 'server-admin'
        ? [
            'read',
            'bindings.manage',
            'publish',
            'settings.manage',
            'drain',
            'accounts.manage',
            'grants.manage',
            'players.read',
            'battles.read',
            'battles.terminate',
            'backup',
          ]
        : ['read']
    if (
      await state.mutate('POST', '/grants', {
        principalId: principalId.value.trim(),
        scope: {
          kind: workspace ? 'workspace' : 'server',
          id: workspace ? workspaceId.value : capabilities.value?.serverId,
        },
        actions,
      })
    )
      principalId.value = ''
  }
  const operationError = contentTaskError

  onMounted(() => void changeTarget(target.value))
  onBeforeUnmount(() => {
    disposed = true
    targetGeneration++
    clearTimeout(timer)
    clearDownloads()
    state.setClient(undefined)
  })

  return {
    state,
    client,
    capabilities,
    managementPrincipalId,
    server,
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
    loading,
    busy,
    loginRequired,
    error,
    notice,
    can,
    canBackup,
    localBridge,
    target,
    loginCode,
    remember,
    accountLoginSupported,
    signingIn,
    sidebarOpen,
    passkeyAvailable,
    environmentSaveSequence,
    serverName,
    nameRevision,
    settingsSaveSequence,
    bindingVersion,
    principalId,
    newPrincipalName,
    newPrincipalAccount,
    deletingBinding,
    referenceVersion,
    versionReferences,
    downloading,
    issuedCredential,
    deleteBinding,
    grantRole,
    tab,
    serverPath,
    workspacePath,
    activeOperations,
    taskLabels,
    taskKinds,
    auditLabels,
    taskStages,
    conditionLabels,
    reason,
    encode,
    supported,
    manageGrants,
    canActivateBinding,
    accessibleTabs,
    accountLoginAvailable,
    changeTarget,
    login,
    logout,
    loginPasskey,
    saveEnvironment,
    prepareEnvironment,
    deleteEnvironment,
    terminateBattle,
    useVersion,
    inspectReferences,
    exportEnvironment,
    importEnvironment,
    downloadEnvironment,
    createBackup,
    downloadBackup,
    patchBinding,
    publish,
    setDefault,
    saveServerName,
    saveServerSettings,
    drain,
    createPrincipal,
    deactivateAccount,
    issueCredential,
    revokeCredential,
    addGrant,
    operationError,
  }
}
export type ManagementController = ReturnType<typeof useManagementController>
