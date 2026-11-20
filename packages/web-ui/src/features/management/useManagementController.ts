import type {
  EnvironmentExportPreview,
  EnvironmentExportSelection,
  EnvironmentImportProbe,
} from '@arcadia-eternity/content-sdk/management-workspace'
import { waitForEnvironmentApply } from '@/features/content/waitForEnvironmentApply'
import { contentTaskError } from '@/utils/contentTaskMessages'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { getBackendOrigin } from '@/bootstrap/deployment'
import { useAuthStore } from '@/stores/auth'
import { createHttpManagementClient, createIpcManagementClient } from '@/services/managementClient'
import type {
  ManagedBinding,
  ManagedEnvironment,
  ManagedEnvironmentDocument,
  ManagedEnvironmentInstallation,
  ManagedServerSettings,
  ManagementOperation,
} from '@/types/management'
import { useManagementConsole } from './useManagementConsole'
import { suppressManagementAccount } from '@/services/managementSession'
import { startAuthentication } from '@simplewebauthn/browser'

export type ManagementTab =
  'environments' | 'server' | 'network' | 'battles' | 'accounts' | 'tasks' | 'security' | 'permissions'
export interface ManagementConsoleProps {
  initialTarget?: 'local' | 'server'
  initialTab?: ManagementTab
  scope?: 'server' | 'content'
}
export function useManagementController(
  props: ManagementConsoleProps,
  emit: (event: 'navigate', value: { target: 'local' | 'server'; tab: ManagementTab }) => void,
  connected: () => boolean = () => true,
) {
  const state = useManagementConsole(props.scope)
  const auth = useAuthStore()
  const {
    client,
    capabilities,
    managementPrincipalId,
    server,
    workspaceId,
    environments,
    installations,
    bindings,
    operations,
    administrators,
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
    isAdministrator,
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
  const deletingBinding = ref('')
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
  const tab = ref<
    'environments' | 'server' | 'network' | 'tasks' | 'security' | 'permissions' | 'accounts' | 'battles'
  >(props.initialTab ?? (props.scope === 'content' ? 'environments' : 'server'))
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
    'environment.apply': '保存并应用',
    'binding.reload': '重新加载环境',
    'environment.import': '导入环境',
    'environment.export': '导出环境',
    'server.backup': '服务器备份',
    'battle.terminate': '终止对战',
  }
  const auditLabels: Record<string, string> = {
    'account.session': '账户登录',
    'binding.reload': '重新加载环境',
    running: '任务开始',
    committed: '变更已提交',
    succeeded: '任务完成',
    failed: '任务失败',
    'battle.terminate': '终止对战',
    'account.deactivate': '停用账户',
    'administrator.add': '添加管理员',
    'administrator.remove': '移除管理员',
    'administrator.invite': '创建管理员登录码',
    'administrators.migrate': '升级管理员名单',
    'grant.replace': '更新旧授权',
    'grant.revoke': '撤销授权',
    'principal.create': '创建管理身份',
  }
  const taskStages: Record<string, string> = {
    resolving: '解析依赖',
    acquiring: '获取来源',
    installing: '下载并安装',
    verifying: '校验材料',
    preparing: '准备环境',
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
  const encode = encodeURIComponent
  const supported = (feature: string) => capabilities.value?.supportedFeatures.includes(feature) ?? false
  const manageAdministrators = computed(() => supported('administrators') && !!capabilities.value?.isAdministrator)
  const canActivateBinding = computed(() => isAdministrator.value)
  const accessibleTabs = computed(() => {
    if (props.scope === 'content') return isAdministrator.value ? (['environments', 'tasks'] as ManagementTab[]) : []
    const allowed: NonNullable<typeof props.initialTab>[] = []
    if (isAdministrator.value) allowed.push('server', 'network')
    if (supported('server.battles') && isAdministrator.value) allowed.push('battles')
    if ((supported('server.players') && isAdministrator.value) || (supported('accounts') && isAdministrator.value))
      allowed.push('accounts')
    if (supported('operations')) allowed.push('tasks')
    if (manageAdministrators.value) allowed.push('permissions')
    if (target.value === 'server') allowed.push('security')
    return allowed
  })
  watch([accessibleTabs, tab], () => {
    if (capabilities.value && !accessibleTabs.value.includes(tab.value) && accessibleTabs.value[0])
      tab.value = accessibleTabs.value[0]
  })

  watch(manageAdministrators, allowed => {
    if (!allowed) issuedCredential.value = undefined
  })
  const accountLoginAvailable = computed(
    () => target.value === 'server' && auth.isAccount && auth.serverUrl === client.value?.context.endpoint,
  )

  const initialized = ref(false)
  async function changeTarget(next: 'local' | 'server') {
    initialized.value = false
    const generation = ++targetGeneration
    clearTimeout(timer)
    target.value = next
    loginCode.value = ''
    accountLoginSupported.value = false
    serverName.value = ''
    nameRevision.value = undefined
    deletingBinding.value = ''
    clearDownloads()
    issuedCredential.value = undefined
    tab.value = props.initialTab ?? (props.scope === 'content' ? 'environments' : 'server')
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
    } finally {
      if (generation === targetGeneration && !disposed) initialized.value = true
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
  async function saveEnvironment(
    document: ManagedEnvironmentDocument,
    expectedRevision: string | null,
    copyFrom?: string,
  ) {
    const current = client.value
    if (!current) return false
    const generation = targetGeneration
    const submitted = await state.mutate<ManagementOperation>(
      'POST',
      `${workspacePath.value}/environments/apply`,
      {
        document,
        expectedRevision,
        ...(copyFrom && { copyFrom }),
      },
      undefined,
      async operation => {
        await waitForEnvironmentApply(
          () => current.request<ManagementOperation>('GET', `/operations/${encodeURIComponent(operation.id)}`),
          () => !disposed && generation === targetGeneration,
        )
      },
    )
    if (submitted) {
      notice.value = '环境已保存并应用。'
      environmentSaveSequence.value++
    }
    return submitted
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
  async function useEnvironment(
    version: ManagedEnvironmentInstallation,
    executionPolicy: 'server' | 'peer' = 'server',
  ) {
    if (
      version.status !== 'ready' ||
      busy.value ||
      bindings.value.some(binding => binding.environmentId === version.environmentId)
    )
      return
    if (!server.value || !isAdministrator.value) {
      error.value = '需要本服管理员身份。'
      return
    }
    const succeeded = await state.mutate('POST', `${serverPath.value}/bindings`, {
      environmentId: version.environmentId,
      enabled: true,
      visibility: 'private',
      matchmakingEnabled: true,
      executionPolicy,
    })
    if (succeeded) tab.value = 'environments'
  }
  function previewExport(id: string) {
    if (!client.value) throw new Error('管理连接已断开')
    return client.value.request<EnvironmentExportPreview>(
      'GET',
      `${workspacePath.value}/installations/${encode(id)}/export-preview`,
    )
  }
  function checkArchives(probe: EnvironmentImportProbe) {
    if (!client.value) throw new Error('管理连接已断开')
    return client.value.request<string[]>('POST', `${workspacePath.value}/import-preview`, { body: { probe } })
  }
  async function exportEnvironment(version: ManagedEnvironmentInstallation, mode?: EnvironmentExportSelection) {
    await state.mutate('POST', `${workspacePath.value}/installations/${encode(version.installationId)}/export`, {
      mode,
    })
  }
  async function importEnvironment(input: {
    bundle: unknown
    environmentId?: string
    expectedRevision?: string | null
  }) {
    const succeeded = await state.mutate('POST', `${workspacePath.value}/import`, input)
    if (succeeded) tab.value = 'tasks'
    return succeeded
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
  async function reloadEnvironment(binding: ManagedBinding) {
    await state.mutate('POST', `${serverPath.value}/bindings/${encode(binding.id)}/reload`, {}, binding.revision)
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
  async function deactivateAccount(accountId: string) {
    await state.mutate('POST', `${serverPath.value}/accounts/${encode(accountId)}/deactivate`)
  }
  async function issueCredential(input: { expiresAt: number }) {
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
  async function addAdministrator(accountId: string) {
    await state.mutate('POST', '/administrators', { accountId }, administrators.value.revision)
  }
  async function inviteAdministrator(displayName: string) {
    let invitation: { code: string; expiresAt: number } | undefined
    await state.mutate<{ code: string; expiresAt: number }>(
      'POST',
      '/administrators',
      { displayName },
      administrators.value.revision,
      result => {
        invitation = result
      },
    )
    return invitation
  }
  async function removeAdministrator(principalId: string) {
    await state.mutate('DELETE', `/administrators/${encode(principalId)}`, undefined, administrators.value.revision)
  }

  const operationError = contentTaskError

  onMounted(() => {
    watch(
      connected,
      active => {
        if (active) void changeTarget(target.value)
        else {
          targetGeneration++
          clearTimeout(timer)
          clearDownloads()
          state.setClient(undefined)
          initialized.value = false
        }
      },
      { immediate: true },
    )
  })
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
    installations,
    bindings,
    operations,
    administrators,
    credentials,
    accounts,
    players,
    battles,
    audit,
    accountCursor,
    initialized,
    loading,
    busy,
    loginRequired,
    error,
    notice,
    isAdministrator,
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
    deletingBinding,
    downloading,
    issuedCredential,
    deleteBinding,
    tab,
    serverPath,
    workspacePath,
    activeOperations,
    taskLabels,
    taskKinds,
    auditLabels,
    taskStages,
    conditionLabels,
    encode,
    supported,
    manageAdministrators,
    canActivateBinding,
    accessibleTabs,
    accountLoginAvailable,
    changeTarget,
    login,
    logout,
    loginPasskey,
    saveEnvironment,
    deleteEnvironment,
    terminateBattle,
    useEnvironment,
    previewExport,
    checkArchives,
    exportEnvironment,
    importEnvironment,
    downloadEnvironment,
    createBackup,
    downloadBackup,
    patchBinding,
    reloadEnvironment,
    setDefault,
    saveServerName,
    saveServerSettings,
    drain,
    deactivateAccount,
    issueCredential,
    revokeCredential,
    addAdministrator,
    inviteAdministrator,
    removeAdministrator,
    operationError,
  }
}
export type ManagementController = ReturnType<typeof useManagementController>
