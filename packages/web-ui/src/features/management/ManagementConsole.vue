<script setup lang="ts">
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
import { serverBackupDownload, useManagementConsole } from './useManagementConsole'
import EnvironmentWorkspace from './EnvironmentWorkspace.vue'
import ServerSettingsForm from './ServerSettingsForm.vue'
import EnvironmentTransfers from './EnvironmentTransfers.vue'
import ManagementCredentials from './ManagementCredentials.vue'
import { suppressManagementAccount, allowManagementAccount } from '@/services/managementSession'
import { startAuthentication } from '@simplewebauthn/browser'
import ManagementSecurity from './ManagementSecurity.vue'
import LiveManagement from './LiveManagement.vue'

const props = defineProps<{
  initialTarget?: 'local' | 'server'
  initialTab?: 'environments' | 'server' | 'network' | 'battles' | 'accounts' | 'tasks' | 'security' | 'permissions'
}>()
const emit = defineEmits<{
  navigate: [value: { target: 'local' | 'server'; tab: NonNullable<typeof props.initialTab> }]
}>()
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
const tab = ref<'environments' | 'server' | 'network' | 'tasks' | 'security' | 'permissions' | 'accounts' | 'battles'>(
  props.initialTab ?? 'environments',
)
let disposed = false
let targetGeneration = 0
let timer: ReturnType<typeof setTimeout> | undefined
const serverPath = computed(() => (server.value ? `/servers/${encodeURIComponent(server.value.id)}` : ''))
const workspacePath = computed(() => (workspaceId.value ? `/workspaces/${encodeURIComponent(workspaceId.value)}` : ''))
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
        createIpcManagementClient({ transport: 'ipc', endpoint: 'local-workspace', label: '本机服务器' }, localBridge),
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
async function importEnvironment(input: { bundle: unknown; environmentId?: string; expectedRevision?: string | null }) {
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
</script>

<template>
  <main class="management-console" :class="{ authenticated: !!capabilities }">
    <header class="management-heading">
      <div class="management-context">
        <p>
          正在管理：<strong>{{ client?.context.label ?? '尚未连接' }}</strong>
        </p>
        <p v-if="capabilities" class="identity">
          {{ target === 'local' ? '本机服主' : `管理身份：${managementPrincipalId || '已验证'}` }}
        </p>
      </div>
      <div class="actions">
        <button
          v-if="capabilities"
          class="sidebar-toggle"
          :aria-expanded="sidebarOpen"
          aria-controls="management-navigation"
          @click="sidebarOpen = !sidebarOpen"
        >
          管理菜单
        </button>
        <RouterLink to="/servers">服务器列表</RouterLink><RouterLink to="/">返回游戏</RouterLink>
        <template v-if="localBridge"
          ><button :aria-pressed="target === 'local'" @click="changeTarget('local')">本机服务器</button
          ><button :aria-pressed="target === 'server'" @click="changeTarget('server')">当前部署服务器</button></template
        ><button v-if="capabilities" :disabled="loading || busy" @click="state.refresh">
          {{ loading ? '刷新中…' : '刷新' }}</button
        ><button v-if="target === 'server' && capabilities && !loginRequired" @click="logout">退出管理</button>
      </div>
    </header>

    <p v-if="error" role="alert" class="message error">{{ error }}</p>
    <p v-if="notice" role="status" class="message success">{{ notice }}</p>
    <section v-if="loginRequired && target === 'server'" class="login-card" aria-label="管理员登录">
      <span class="login-eyebrow">ARCADIA ETERNITY</span>
      <h2>登录管理后台</h2>
      <p>使用管理员身份管理此服务器。</p>
      <button class="primary login-primary" :disabled="busy || signingIn || !passkeyAvailable" @click="loginPasskey">
        {{ signingIn ? '请在设备上完成验证…' : '使用通行密钥登录' }}
      </button>
      <p v-if="!passkeyAvailable" class="hint">通行密钥需要 HTTPS 或 localhost，以及支持此功能的浏览器。</p>
      <RouterLink
        v-if="accountLoginSupported || accountLoginAvailable"
        class="account-login"
        to="/account?returnTo=management"
        @click="client && allowManagementAccount(client.context.endpoint)"
        >使用已授权账户登录</RouterLink
      >
      <label class="remember-device"
        ><input v-model="remember" type="checkbox" />记住此设备 30 天（仅限私人设备）</label
      >
      <details class="bootstrap-help">
        <summary>首次设置或恢复管理员访问</summary>
        <p>在服务器主机上运行，使用实际数据目录：</p>
        <pre><code>node dist/cli.js server admin login-code --data-dir /path/to/server-data</code></pre>
        <p>
          自定义工作区时追加相同的 <code>--workspace-root</code>。登录码有效期 10
          分钟，仅能使用一次。进入后可在“登录与安全”添加通行密钥。
        </p>
        <form @submit.prevent="login">
          <label
            >一次性登录码<input
              v-model="loginCode"
              type="password"
              required
              autocomplete="off"
              :disabled="busy || signingIn"
          /></label>
          <button class="primary" :disabled="busy || signingIn || !loginCode.trim()">
            {{ busy ? '正在验证…' : '使用登录码进入' }}
          </button>
        </form>
      </details>
    </section>
    <template v-if="capabilities">
      <div v-if="capabilities.resourceRestrictions.length" class="message">
        <p v-for="(restriction, index) in capabilities.resourceRestrictions" :key="index">{{ restriction.reason }}</p>
      </div>
      <div class="console-layout">
        <nav id="management-navigation" class="tabs" :class="{ open: sidebarOpen }" aria-label="管理功能">
          <div class="sidebar-brand">ARCADIA <span>管理控制台</span></div>
          <button
            :disabled="!can('server', 'read')"
            :aria-current="tab === 'server' ? 'page' : undefined"
            @click="tab = 'server'"
          >
            概览
          </button>
          <button
            :disabled="!accessibleTabs.includes('environments')"
            :aria-current="tab === 'environments' ? 'page' : undefined"
            @click="tab = 'environments'"
          >
            运行环境
          </button>
          <button
            v-if="supported('server.battles') && can('server', 'battles.read')"
            :aria-current="tab === 'battles' ? 'page' : undefined"
            @click="tab = 'battles'"
          >
            活跃对战
          </button>
          <button
            v-if="
              (supported('server.players') && can('server', 'players.read')) ||
              (supported('accounts') && can('server', 'accounts.manage'))
            "
            :aria-current="tab === 'accounts' ? 'page' : undefined"
            @click="tab = 'accounts'"
          >
            用户管理
          </button>
          <button
            :disabled="!can('server', 'read')"
            :aria-current="tab === 'network' ? 'page' : undefined"
            @click="tab = 'network'"
          >
            网络与容量
          </button>
          <button
            :disabled="!supported('operations')"
            :aria-current="tab === 'tasks' ? 'page' : undefined"
            @click="tab = 'tasks'"
          >
            操作记录与备份 <span v-if="activeOperations">{{ activeOperations }}</span>
          </button>
          <button
            v-if="manageGrants"
            :aria-current="tab === 'permissions' ? 'page' : undefined"
            @click="tab = 'permissions'"
          >
            访问权限
          </button>
          <button
            v-if="target === 'server'"
            :aria-current="tab === 'security' ? 'page' : undefined"
            @click="tab = 'security'"
          >
            登录与安全
          </button>
        </nav>
        <div class="console-content">
          <ManagementSecurity
            v-if="tab === 'security' && target === 'server' && client"
            :key="client.context.endpoint"
            :client="client"
          />
          <LiveManagement
            v-if="tab === 'battles' || tab === 'accounts'"
            :key="client?.context.endpoint + ':' + tab"
            :mode="tab"
            :players="players"
            :battles="battles"
            :accounts="accounts"
            :can-read-players="can('server', 'players.read')"
            :can-read-battles="can('server', 'battles.read')"
            :can-manage-accounts="supported('accounts') && can('server', 'accounts.manage')"
            :can-terminate="can('server', 'battles.terminate')"
            :more-accounts="!!accountCursor"
            :busy="busy"
            @terminate="terminateBattle"
            @deactivate="deactivateAccount"
            @more-accounts="state.loadMoreAccounts"
          />
          <section v-if="tab === 'environments' && server" aria-label="服务器玩法">
            <h2>运行环境</h2>
            <p class="hint">
              一台服务器可以同时开放多个环境。默认环境用于未指定环境的新房间；其他环境仍可独立运行。发布新版本不会改变已有房间。
            </p>
            <article v-for="binding in bindings" :key="binding.id" class="binding-card">
              <header>
                <h3>
                  {{
                    environments.find(env => env.document.id === binding.environmentId)?.document.name ??
                    binding.environmentId
                  }}
                  <span v-if="server.defaultBindingId === binding.id" class="badge">默认</span>
                </h3>
                <span>{{ conditionLabels[binding.condition] ?? binding.condition }}</span>
              </header>
              <dl>
                <dt>对局执行</dt>
                <dd>{{ binding.executionPolicy === 'peer' ? '由玩家托管' : '服务器执行' }}</dd>
                <dt>期望版本</dt>
                <dd>{{ binding.desiredVersionId ?? '未选择' }}</dd>
                <dt>实际版本</dt>
                <dd>{{ binding.effectiveVersionId ?? '尚未生效' }}</dd>
              </dl>
              <p v-if="binding.reason" class="message error">{{ contentTaskError(binding.reason) }}</p>
              <div class="binding-options">
                <label
                  ><input
                    type="checkbox"
                    :checked="binding.enabled"
                    :disabled="
                      busy ||
                      !can('server', 'bindings.manage') ||
                      (!binding.enabled && !canActivateBinding) ||
                      server.defaultBindingId === binding.id
                    "
                    :title="server.defaultBindingId === binding.id ? '先选择其他默认环境，再停用此环境' : undefined"
                    @change="patchBinding(binding, { enabled: ($event.target as HTMLInputElement).checked })"
                  />接纳新房间</label
                ><label
                  ><input
                    type="checkbox"
                    :checked="binding.visibility === 'public'"
                    :disabled="
                      busy ||
                      !can('server', 'bindings.manage') ||
                      (binding.visibility !== 'public' && !canActivateBinding)
                    "
                    @change="
                      patchBinding(binding, {
                        visibility: ($event.target as HTMLInputElement).checked ? 'public' : 'private',
                      })
                    "
                  />公开展示</label
                ><label
                  ><input
                    type="checkbox"
                    :checked="binding.matchmakingEnabled"
                    :disabled="
                      busy || !can('server', 'bindings.manage') || (!binding.matchmakingEnabled && !canActivateBinding)
                    "
                    @change="patchBinding(binding, { matchmakingEnabled: ($event.target as HTMLInputElement).checked })"
                  />开放匹配</label
                ><label
                  ><input
                    type="checkbox"
                    :checked="binding.selection === 'follow-ready'"
                    :disabled="
                      busy ||
                      !can('server', 'bindings.manage') ||
                      (binding.selection !== 'follow-ready' && !canActivateBinding)
                    "
                    @change="
                      patchBinding(binding, {
                        selection: ($event.target as HTMLInputElement).checked ? 'follow-ready' : 'pinned',
                      })
                    "
                  />跟随此环境的就绪版本</label
                >
              </div>
              <p v-if="binding.selection === 'follow-ready'" class="hint">
                后续准备出的就绪版本会按这项授权策略发布，退出管理后仍有效。此设置不会自动更新包；撤销相应授权或关闭跟随后停止。
              </p>
              <div class="actions">
                <label
                  >准备发布的版本<select
                    :value="bindingVersion[binding.id] ?? binding.desiredVersionId ?? binding.effectiveVersionId ?? ''"
                    @change="bindingVersion[binding.id] = ($event.target as HTMLSelectElement).value"
                  >
                    <option value="" disabled>选择版本</option>
                    <option
                      v-for="version in versions.filter(
                        item => item.environmentId === binding.environmentId && item.status === 'ready',
                      )"
                      :key="version.versionId"
                      :value="version.versionId"
                    >
                      {{ version.versionId.slice(0, 16) }} ·
                      {{ version.status === 'ready' ? new Date(version.createdAt).toLocaleString() : '材料不可用' }}
                    </option>
                  </select></label
                ><button
                  class="primary"
                  :disabled="busy || !canActivateBinding"
                  :title="canActivateBinding ? undefined : '需要服务器发布和工作区使用权限'"
                  @click="publish(binding)"
                >
                  发布所选版本</button
                ><button
                  :disabled="busy || !can('server', 'settings.manage') || binding.condition !== 'available'"
                  @click="setDefault(binding)"
                >
                  设为默认
                </button>
                <button
                  :disabled="busy || !can('server', 'bindings.manage') || server.defaultBindingId === binding.id"
                  :title="server.defaultBindingId === binding.id ? '先选择其他默认环境' : undefined"
                  @click="deletingBinding = binding.id"
                >
                  移除绑定
                </button>
                <span v-if="deletingBinding === binding.id"
                  ><button :disabled="busy" @click="deleteBinding(binding)">确认移除</button
                  ><button @click="deletingBinding = ''">取消</button></span
                >
              </div>
            </article>
            <p v-if="!bindings.length" class="hint">还没有环境绑定。在下方准备或导入版本后，选择“用于服务器”。</p>
          </section>
          <p v-if="tab === 'environments'" class="context-note">
            服务器环境库 · 下面的草稿和固定版本保存在当前管理的服务器。本机离线环境请到“内容包 → 环境”管理。
          </p>
          <EnvironmentWorkspace
            v-if="tab === 'environments' && supported('workspace.environments')"
            :key="client?.context.endpoint"
            :environments="environments"
            :versions="versions"
            :can-edit="can('workspace', 'edit')"
            :can-prepare="can('workspace', 'prepare')"
            :can-use="can('workspace', 'environment.use') && can('server', 'bindings.manage')"
            :can-delete="can('workspace', 'delete')"
            :save-sequence="environmentSaveSequence"
            :busy="busy"
            @save="saveEnvironment"
            @prepare="prepareEnvironment"
            @package-state="
              (environment, name, enabled, cascade) =>
                state.mutate('POST', `${workspacePath}/environments/${encode(environment.document.id)}/package-state`, {
                  expectedRevision: environment.revision,
                  name,
                  enabled,
                  cascade,
                })
            "
            @delete-draft="deleteEnvironment"
            @use="useVersion"
            @references="inspectReferences"
            @delete="version => state.mutate('DELETE', `${workspacePath}/versions/${encode(version.versionId)}`)"
          />
          <section v-if="tab === 'environments' && referenceVersion" aria-label="版本引用" class="message">
            <h3>版本引用</h3>
            <p>
              <code>{{ referenceVersion }}</code>
            </p>
            <p v-if="!versionReferences.length">当前没有引用，可以删除此版本。删除时仍会重新检查。</p>
            <template v-else>
              <p>以下使用方仍保留此版本。解除绑定或等待正在使用的对局结束后，才可以删除。</p>
              <p v-for="(reference, index) in versionReferences" :key="index">
                {{ reference.kind === 'runtime' ? '正在使用' : '持久引用' }} ·
                {{ reference.serverId ?? reference.owner ?? reference.id ?? reference.retentionId
                }}<span v-if="reference.bindingId"> · 绑定 {{ reference.bindingId }}</span>
              </p>
            </template>
            <button @click="referenceVersion = ''">关闭引用</button>
          </section>
          <EnvironmentTransfers
            v-if="tab === 'environments' && supported('workspace.transfers')"
            :key="client?.context.endpoint"
            :versions="versions"
            :operations="operations"
            :busy="busy || !!downloading"
            :can-import="can('workspace', 'edit') && can('workspace', 'prepare')"
            :can-export="can('workspace', 'export')"
            @import="importEnvironment"
            @export="exportEnvironment"
            @download="downloadEnvironment"
          />
          <p v-if="tab === 'environments' && !supported('workspace.environments')" class="hint">
            此管理目标尚不支持环境工作区。
          </p>
          <ServerSettingsForm
            v-if="tab === 'network' && server?.settings"
            :settings="server.settings"
            :revision="server.revision"
            :save-sequence="settingsSaveSequence"
            :runtime-settings="server.runtimeSettings"
            :listen-address="server.listenAddress"
            :pending-restart="server.pendingRestart"
            :busy="busy"
            :can-edit="can('server', 'settings.manage')"
            @save="saveServerSettings"
          />
          <section v-if="tab === 'server' && server" aria-label="服务器管理">
            <div class="overview-stats">
              <button @click="tab = 'environments'">
                <strong>{{ bindings.filter(item => item.enabled && item.condition === 'available').length }}</strong
                >运行环境
              </button>
              <button :disabled="!can('server', 'battles.read')" @click="tab = 'battles'">
                <strong>{{ server.activeBattles ?? '—' }}</strong
                >活跃对战
              </button>
              <button :disabled="!can('server', 'players.read')" @click="tab = 'accounts'">
                <strong>{{
                  can('server', 'players.read') ? players.filter(item => item.connected).length : '—'
                }}</strong
                >在线玩家
              </button>
              <div>
                <strong>{{ server.queued ?? '—' }}</strong
                >等待中的任务 / 匹配
              </div>
            </div>
            <div class="server-summary">
              <h2>{{ server.name }}</h2>
              <p>
                {{ server.draining ? '正在排空：不接纳新局' : '正在接纳对局' }} ·
                {{ conditionLabels[server.status] ?? server.status }}
              </p>
              <form class="actions" @submit.prevent="saveServerName">
                <label
                  >服务器名称<input
                    v-model="serverName"
                    required
                    maxlength="80"
                    @input="nameRevision ??= server.revision" /></label
                ><button
                  :disabled="busy || !can('server', 'settings.manage')"
                  :title="reason('server', 'settings.manage')"
                >
                  保存名称</button
                ><button
                  type="button"
                  :disabled="busy || !supported('server.drain') || !can('server', 'drain')"
                  :title="reason('server', 'drain')"
                  @click="drain"
                >
                  {{ server.draining ? '恢复接纳新局' : '停止接纳并排空' }}
                </button>
              </form>
              <p class="hint">排空允许已有对局结束。独立服务的进程启停由部署环境控制。</p>
            </div>
          </section>
          <section v-if="tab === 'tasks'" aria-label="管理任务">
            <div v-if="canBackup" class="server-backup">
              <button :disabled="busy || !!downloading" @click="createBackup">创建服务器备份</button>
              <p class="hint">
                备份包含持久数据和工作区材料。完成后在下方操作记录中下载；恢复需在停止服务后通过宿主执行。
              </p>
            </div>
            <h2>操作记录</h2>
            <p class="hint">任务属于当前管理目标，离开页面后仍可回来查看。</p>
            <article v-for="operation in operations" :key="operation.id" class="operation">
              <header>
                <strong>{{ taskKinds[operation.kind] ?? operation.kind }}</strong
                ><span>{{ taskLabels[operation.status] ?? operation.status }}</span>
              </header>
              <p v-if="operation.status === 'running' && typeof operation.progress === 'object'">
                {{
                  operation.progress.message ??
                  (operation.progress.stage ? taskStages[operation.progress.stage] : undefined) ??
                  '正在处理'
                }}
                <span v-if="operation.progress.total"
                  >{{ operation.progress.completed ?? 0 }} / {{ operation.progress.total }}</span
                >
              </p>
              <progress v-if="typeof operation.progress === 'number'" :value="operation.progress" max="100" />
              <p v-if="operation.error" class="error">{{ operationError(operation.error) }}</p>
              <p v-if="operation.committed && operation.status !== 'succeeded'" class="hint">
                资源变更已提交，请先查看实际状态，再发起新的操作。
              </p>
              <small>{{ operation.id }}</small
              ><button
                v-if="
                  (operation.status === 'queued' || operation.status === 'running') &&
                  (operation.kind !== 'server.backup' || canBackup)
                "
                :disabled="busy || operation.cancelRequested"
                @click="state.mutate('POST', `/operations/${encode(operation.id)}/cancel`)"
              >
                {{ operation.cancelRequested ? '已请求取消' : '取消任务' }}
              </button>
              <button
                v-if="
                  !operation.committed &&
                  (operation.status === 'failed' ||
                    operation.status === 'interrupted' ||
                    operation.status === 'cancelled') &&
                  (operation.kind !== 'server.backup' || canBackup)
                "
                :disabled="busy"
                @click="state.mutate('POST', `/operations/${encode(operation.id)}/retry`)"
              >
                重试任务
              </button>
              <template v-if="operation.kind === 'server.backup' && operation.status === 'succeeded' && canBackup">
                <template v-if="serverBackupDownload(operation)">
                  <p class="hint">
                    {{ serverBackupDownload(operation)!.filename }} ·
                    {{ (serverBackupDownload(operation)!.bytes / 1024 / 1024).toFixed(2) }} MiB · 有效至
                    {{ new Date(serverBackupDownload(operation)!.expiresAt).toLocaleString() }}
                  </p>
                  <button
                    :disabled="busy || !!downloading || serverBackupDownload(operation)!.expiresAt <= Date.now()"
                    @click="downloadBackup(operation)"
                  >
                    {{
                      serverBackupDownload(operation)!.expiresAt <= Date.now()
                        ? '备份文件已过期'
                        : downloading === operation.id
                          ? '正在下载备份…'
                          : '下载服务器备份'
                    }}
                  </button>
                </template>
                <p v-else class="hint">此任务没有可用的备份下载信息，请重新创建备份。</p>
              </template>
            </article>
            <p v-if="!operations.length">没有可查看的任务。</p>
            <h3 v-if="supported('audit')">最近管理操作</h3>
            <article v-for="entry in audit" :key="entry.id" class="operation">
              <header>
                <strong>{{ auditLabels[entry.action] ?? entry.action }}</strong
                ><time>{{ new Date(entry.createdAt).toLocaleString() }}</time>
              </header>
              <p>{{ entry.actor }} · {{ entry.target }}</p>
              <p v-if="entry.reason">原因：{{ entry.reason }}</p>
            </article>
          </section>
          <section v-if="tab === 'permissions' && manageGrants" aria-label="管理员授权">
            <h2>管理员与授权</h2>
            <p class="hint">权限只作用于指定服务器或工作区。服务器管理员不会自动获得工作区删除权限。</p>
            <details>
              <summary>新建管理主体</summary>
              <form class="grant-form" @submit.prevent="createPrincipal">
                <label>显示名称<input v-model="newPrincipalName" required maxlength="80" /></label
                ><label v-if="can('server', 'grants.manage')"
                  >关联本服账户标识（可选）<input v-model="newPrincipalAccount" /></label
                ><button :disabled="busy || !newPrincipalName.trim()">创建主体</button>
              </form>
              <p class="hint">关联账户后，该账户登录仍须具备下方授予的权限。新主体默认没有权限。</p>
            </details>
            <form class="grant-form" @submit.prevent="addGrant">
              <label>管理主体标识<input v-model="principalId" required autocomplete="off" /></label
              ><label
                >角色<select v-model="grantRole">
                  <option value="viewer" :disabled="!can('server', 'grants.manage')">服务器只读</option>
                  <option value="server-admin" :disabled="!can('server', 'grants.manage')">服务器管理员</option>
                  <option value="workspace-admin" :disabled="!can('workspace', 'grants.manage')">工作区管理员</option>
                </select></label
              ><button class="primary" :disabled="busy || !principalId.trim()">添加授权</button>
            </form>
            <article v-for="grant in grants" :key="grant.id" class="grant">
              <strong>{{ grant.principalId }}</strong>
              <p>{{ grant.scope.kind === 'server' ? '服务器' : '工作区' }} · {{ grant.scope.id }}</p>
              <p>{{ grant.actions.join('、') }}</p>
              <button
                :disabled="busy"
                @click="
                  state.mutate(
                    'POST',
                    `/grants/${encode(grant.id)}/revoke`,
                    { revision: grant.revision },
                    grant.revision,
                  )
                "
              >
                撤销授权
              </button>
            </article>
            <ManagementCredentials
              :credentials="credentials"
              :key="client?.context.endpoint"
              :capabilities="capabilities"
              :busy="busy"
              :issued="issuedCredential"
              @issue="issueCredential"
              @revoke="revokeCredential"
              @dismiss="issuedCredential = undefined"
            />
          </section>
        </div>
      </div>
    </template>
  </main>
</template>

<style scoped>
.management-console {
  width: 100%;
  min-height: 100%;
  padding: 0;
  background: #f4f6fa;
  color: #0f172a;
}
.management-heading,
.binding-card header,
.operation header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.management-heading h1 {
  font-size: 1.65rem;
  margin: 0;
}
.management-heading p {
  margin: 0.5rem 0;
}
.management-heading small,
.hint,
.context-note {
  color: #64748b;
}
.context-note {
  font-size: 0.9rem;
}
.actions,
.grant-form {
  display: flex;
  align-items: end;
  gap: 0.65rem;
  flex-wrap: wrap;
}
button {
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  padding: 0.55rem 0.85rem;
  background: #fff;
  color: #334155;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
button[aria-pressed='true'],
button[aria-current='page'] {
  background: #eff6ff;
  color: #1d4ed8;
  border-color: #93c5fd;
}
.primary {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.tabs {
  display: flex;
  flex-direction: column;
  align-self: start;
  position: sticky;
  top: 1rem;
  gap: 0.5rem;
  margin: 0;
  border-right: 1px solid #e2e8f0;
  padding-right: 1rem;
  padding-bottom: 0.75rem;
  overflow: auto;
}
.tabs button {
  text-align: left;
  white-space: nowrap;
}
.message {
  padding: 0.8rem 1rem;
  border-radius: 8px;
  background: #f1f5f9;
}
.error {
  color: #b91c1c;
}
.message.error {
  background: #fef2f2;
}
.success {
  background: #ecfdf5;
  color: #047857;
}
.login-card,
.server-summary,
.binding-card,
.operation,
.grant {
  background: #fff;
  border: 1px solid #e2e8f0;
  padding: 1.2rem;
  border-radius: 12px;
  margin: 1rem 0;
}
.login-card {
  max-width: 520px;
}
.login-card p,
.hint {
  font-size: 0.9rem;
  line-height: 1.6;
}
label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0.6rem 0;
}
input,
select {
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 0.6rem;
  color: #0f172a;
  background: #fff;
}
.login-card input {
  max-width: 400px;
}
.binding-card h3 {
  margin: 0;
}
.badge {
  font-size: 0.75rem;
  color: #1d4ed8;
  background: #dbeafe;
  border-radius: 4px;
  padding: 0.15rem 0.35rem;
}
.binding-card dl {
  display: grid;
  grid-template-columns: 6rem 1fr;
  font-size: 0.85rem;
  gap: 0.4rem;
}
.binding-card dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: #475569;
}
.binding-options {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}
.binding-options label {
  flex-direction: row;
  align-items: center;
  font-size: 0.9rem;
}
.operation small {
  display: block;
  color: #64748b;
  margin-bottom: 0.75rem;
  overflow-wrap: anywhere;
}
.grant-form {
  margin-bottom: 1rem;
}
.console-layout {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 1.5rem;
  margin-top: 1.5rem;
}
.console-content {
  min-width: 0;
}
.overview-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.7rem;
}
.overview-stats > * {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: white;
  padding: 0.9rem;
  font-size: 0.8rem;
  text-align: left;
}
.overview-stats strong {
  display: block;
  font-size: 1.7rem;
  color: #0f172a;
  margin-bottom: 0.3rem;
}
.bootstrap-help pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: #f1f5f9;
  padding: 0.7rem;
  font-size: 0.8rem;
}
@media (max-width: 800px) {
  .console-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .tabs {
    flex-direction: row;
    position: static;
    border-right: 0;
    border-bottom: 1px solid #e2e8f0;
  }
  .overview-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 600px) {
  .management-console {
    padding: 1rem;
  }
  .management-heading .actions {
    width: 100%;
  }
  .actions label {
    width: 100%;
  }
}

.management-heading {
  min-height: 64px;
  padding: 0.65rem 1.5rem;
  background: white;
  border-bottom: 1px solid #e2e8f0;
}
.management-context {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.management-context .identity {
  padding-left: 1rem;
  border-left: 1px solid #e2e8f0;
}
.management-heading p {
  font-size: 0.85rem;
  color: #64748b;
}
.management-heading a {
  color: #475569;
  text-decoration: none;
  font-size: 0.9rem;
  padding: 0.5rem;
}
.management-console > .message {
  margin: 1rem 2rem;
}
.console-layout {
  grid-template-columns: 232px minmax(0, 1fr);
  gap: 0;
  margin-top: 0;
  min-height: calc(100dvh - var(--site-navigation-height, 0px) - 64px);
}
.tabs {
  background: #111d32;
  color: #cbd5e1;
  padding: 1.5rem 1rem;
  border: 0;
  top: 0;
  height: calc(100dvh - var(--site-navigation-height, 0px) - 64px);
  border-radius: 0;
}
.tabs button {
  border: 0;
  background: transparent;
  color: #cbd5e1;
  padding: 0.8rem 1rem;
}
.tabs button:hover:not(:disabled):not([aria-current='page']) {
  background: #20324e;
}
.tabs button[aria-current='page'] {
  background: #2563eb;
  color: white;
}
.sidebar-brand {
  padding: 0.5rem 1rem 1.5rem;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.08em;
}
.sidebar-brand span {
  display: block;
  margin-top: 0.4rem;
  font-size: 0.75rem;
  color: #94a3b8;
  letter-spacing: 0;
  font-weight: 400;
}
.console-content {
  padding: 2rem;
}
.login-card {
  margin: 4rem auto;
  width: calc(100% - 2rem);
  max-width: 460px;
  padding: 2rem;
  box-shadow: 0 12px 40px #0f172a08;
}
.login-card h2 {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0.75rem 0;
}
.login-eyebrow {
  color: #64748b;
  font-size: 0.75rem;
  letter-spacing: 0.15em;
}
.login-primary,
.account-login {
  display: block;
  width: 100%;
  text-align: center;
  margin: 1rem 0;
  padding: 0.8rem;
  border-radius: 8px;
}
.account-login {
  border: 1px solid #cbd5e1;
  color: #334155;
  text-decoration: none;
}
.remember-device {
  flex-direction: row;
  align-items: center;
  font-size: 0.85rem;
}
.bootstrap-help {
  border-top: 1px solid #e2e8f0;
  margin-top: 1.5rem;
  padding-top: 1.2rem;
}
.bootstrap-help summary {
  cursor: pointer;
  font-size: 0.9rem;
}
.sidebar-toggle {
  display: none;
}
button:focus-visible,
a:focus-visible,
summary:focus-visible {
  outline: 3px solid #60a5fa;
  outline-offset: 2px;
}
@media (max-width: 800px) {
  .console-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .tabs {
    display: none;
    position: static;
    height: auto;
    flex-direction: column;
  }
  .tabs.open {
    display: flex;
  }
  .sidebar-toggle {
    display: inline-block;
  }
  .console-content {
    padding: 1rem;
  }
  .management-heading {
    padding: 0.75rem 1rem;
  }
  .management-context {
    gap: 0.3rem 0.75rem;
  }
  .management-context p {
    margin: 0;
  }
  .management-context .identity {
    padding: 0;
    border: 0;
  }
  .management-console {
    padding: 0;
  }
  .management-console > .message {
    margin: 1rem;
  }
}
</style>
