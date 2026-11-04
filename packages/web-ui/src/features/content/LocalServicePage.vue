<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { ContentProjectSummary, ContentProjectAction, LocalBattleHostStatus } from '@/types/desktop'
import type { ContentLibrarySnapshot } from '@/types/contentPackages'
import type { ManagedServer, ManagedServerSettings } from '@/types/management'
import { createIpcManagementClient } from '@/services/managementClient'
import ServerSettingsForm from '@/features/management/ServerSettingsForm.vue'
const api = window.arcadiaDesktop
const management = api?.managementRequest
  ? createIpcManagementClient(
      { transport: 'ipc', endpoint: 'local-workspace', label: '本机工作区' },
      api.managementRequest,
    )
  : undefined
const server = ref<ManagedServer & { activeBattles?: number; rooms?: number; queued?: number }>()
const settingsSaveSequence = ref(0)
const forceStop = ref(false)
const library = ref<ContentLibrarySnapshot>()
const projects = ref<ContentProjectSummary[]>([])
const selected = ref('')
const name = ref('')
const busy = ref(false),
  error = ref(''),
  notice = ref(''),
  trusted = ref(false),
  includeLocal = ref(false),
  offline = ref(false)
const status = ref<LocalBattleHostStatus>({ status: 'idle' })
let refreshGeneration = 0
let disposed = false
async function refresh() {
  const generation = ++refreshGeneration
  const [nextLibrary, nextProjects, nextStatus] = await Promise.all([
    api?.listContentPackages?.(),
    api?.listContentProjects?.(),
    api?.getLocalBattleStatus?.(),
  ])
  const nextServer =
    nextStatus?.status === 'running' && management
      ? (await management.request<{ servers: NonNullable<typeof server.value>[] }>('GET', '/servers')).servers.find(
          item => item.id === nextStatus.serverId,
        )
      : undefined
  if (disposed || generation !== refreshGeneration) return
  library.value = nextLibrary
  projects.value = nextProjects ?? []
  status.value = nextStatus ?? { status: 'idle' }
  server.value = nextServer
  if (!nextServer?.draining || !nextServer.activeBattles) forceStop.value = false
}
async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await action()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '本机操作失败'
  } finally {
    busy.value = false
  }
}
async function start() {
  await run(async () => {
    await api!.contentPackageAction!({ action: 'start' })
    await refresh()
    notice.value = '本机联机托管已启动'
  })
}
async function stop() {
  await run(async () => {
    try {
      await api!.stopLocalBattle!({ force: forceStop.value })
    } finally {
      await refresh()
    }
    forceStop.value = false
    notice.value = '本机联机托管已停止'
  })
}
async function recover() {
  await run(async () => {
    try {
      await api!.recoverLocalBattle!()
    } finally {
      await refresh()
    }
    notice.value = '已仅在本机启动。修正下方设置后，停止并正常启动托管。'
  })
}
async function saveSettings(
  settings: Omit<ManagedServerSettings, 'publicOrigin'> & { publicOrigin: string | null },
  revision: number,
) {
  if (!server.value || !management) return
  const path = `/servers/${encodeURIComponent(server.value.id)}`
  await run(async () => {
    await management.request('PATCH', path, { body: { settings }, revision })
    settingsSaveSequence.value++
    await refresh()
    notice.value = '网络与容量设置已保存，停止后重新启动托管即可应用'
  })
}
async function add() {
  await run(async () => {
    const id = await api!.addContentProject!()
    await refresh()
    if (id) {
      selected.value = id
      selectProject()
    }
  })
}
function selectProject() {
  name.value = projects.value.find(project => project.id === selected.value)?.name ?? ''
  trusted.value = false
}
async function operate(action: ContentProjectAction['action']) {
  if (!selected.value || (action === 'approve' && !trusted.value)) return
  await run(async () => {
    await api!.contentProjectAction!({
      id: selected.value,
      action,
      name: name.value,
      offline: offline.value,
      includeLocalArtifacts: includeLocal.value,
    })
    await refresh()
    notice.value = '操作已完成'
  })
}
let refreshTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void run(refresh)
  refreshTimer = setInterval(() => {
    if (!busy.value && status.value.status === 'running') void refresh().catch(() => undefined)
  }, 5000)
})
onBeforeUnmount(() => {
  disposed = true
  clearInterval(refreshTimer)
})
</script>
<template>
  <main class="local-service">
    <h1>高级本机工具</h1>
    <p>内容会根据你的选择自动准备。这里提供诊断与已有服务器项目的管理工具。</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <details>
      <summary>联机托管与诊断</summary>
      <h2>当前可用内容</h2>
      <p>
        官方基础内容<span
          v-for="pkg in library?.packages.filter(pkg => library?.activeIds.includes(pkg.id))"
          :key="pkg.id"
          >、{{ pkg.title }} {{ pkg.version }}</span
        >
      </p>
      <p>只有由本机承担联机服务端时，才需要启动托管。离线对战、UGC 试战和连接其他服务器均无需启动。</p>
      <template v-if="status.status === 'running'">
        <p v-if="status.localRecovery" role="status">
          当前为本机修复模式。已保存的网络设置保留，修正后需重新启动托管。
        </p>
        <p>本机连接：{{ status.url }}</p>
        <p v-if="status.network">
          监听 {{ status.network.host }}:{{ status.network.port }} ·
          {{ status.network.scope === 'local' ? '仅本机可连接' : '已开放网络监听' }}
        </p>
        <template v-if="status.network?.inviteUrls.length">
          <h2>玩家连接地址</h2>
          <p>将地址填入客户端的服务器连接设置。局域网地址需要处于可互通的网络，对外地址需要服主配置代理与网络入口。</p>
          <ul>
            <li v-for="address in status.network.inviteUrls" :key="address">
              <code>{{ address }}</code>
            </li>
          </ul>
        </template>
        <p v-else-if="!status.localRecovery">
          尚无可供其他设备连接的地址。在下方设置网卡地址或 0.0.0.0，保存后重启托管。
        </p>
        <p v-if="status.network?.availableHosts.length">本机网卡地址：{{ status.network.availableHosts.join('、') }}</p>
        <p v-if="server">
          {{ server.draining ? '正在排空，不再接纳新局' : '正在接纳新局' }} · 进行中
          {{ server.activeBattles ?? 0 }} 场对战
        </p>
        <label v-if="server?.draining && (server.activeBattles ?? 0) > 0"
          ><input v-model="forceStop" type="checkbox" />立即中断正在进行的对战并停止托管</label
        >
      </template>
      <p v-else-if="status.status === 'failed'" class="error">{{ status.message }}</p>
      <p v-else>未托管联机对战</p>
      <div class="actions">
        <button v-if="status.status === 'failed' && api?.recoverLocalBattle" :disabled="busy" @click="recover">
          仅本机启动以修复设置
        </button>
        <button :disabled="busy || !library?.hasSelection || status.status === 'running'" @click="start">
          由本机托管联机对战</button
        ><button :disabled="busy || status.status !== 'running'" @click="stop">
          {{ forceStop ? '立即中断并停止' : '排空后停止托管' }}</button
        ><button :disabled="busy" @click="run(refresh)">刷新状态</button>
      </div>
      <p v-if="!library?.hasSelection">在内容包页选择需要的内容，客户端会自动准备。</p>
      <ServerSettingsForm
        v-if="server?.settings"
        :settings="server.settings"
        :runtime-settings="server.runtimeSettings"
        :revision="server.revision"
        :save-sequence="settingsSaveSequence"
        :pending-restart="server.pendingRestart"
        :busy="busy"
        :can-edit="!!management"
        @save="saveSettings"
      />
      <p v-if="status.status === 'running'">
        <RouterLink to="/management">管理环境、服务器与权限</RouterLink>。远程网页管理需要管理员身份与
        HTTPS；玩家连接不会获得本机文件访问权限。
      </p>
    </details>
    <details>
      <summary>高级服务器项目管理</summary>
      <p>兼容已有的 npm 服务器项目。普通内容包管理不需要手动登记项目目录。</p>
      <button :disabled="busy" @click="add">登记项目目录</button
      ><label
        >已有项目<select v-model="selected" @change="selectProject">
          <option value="">请选择</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
        </select></label
      >
      <template v-if="selected"
        ><label>项目名称<input v-model="name" maxlength="80" /></label>
        <div class="actions">
          <button :disabled="busy" @click="operate('rename')">保存名称</button
          ><button :disabled="busy" @click="operate('inspect')">检查项目</button
          ><button :disabled="busy" @click="operate('install')">安装锁定依赖</button
          ><button :disabled="busy" @click="operate('validate')">校验项目</button
          ><button :disabled="busy || status.status === 'running'" @click="operate('start')">
            使用此项目托管联机对战</button
          ><button :disabled="busy" @click="operate('forget')">移出列表</button>
        </div>
        <label><input v-model="offline" type="checkbox" />仅离线安装</label
        ><label><input v-model="trusted" type="checkbox" />我信任此项目的代码及依赖，允许其在本机运行</label
        ><button :disabled="busy || !trusted" @click="operate('approve')">准入此项目</button
        ><label><input v-model="includeLocal" type="checkbox" />导出时包含有权再分发的本地 tgz</label>
        <div class="actions">
          <button :disabled="busy" @click="operate('export')">导出到新目录</button
          ><button :disabled="busy" @click="operate('verify')">验证导出项目</button>
        </div></template
      >
    </details>
  </main>
</template>
<style scoped>
.local-service {
  max-width: 960px;
  margin: auto;
  padding: 28px 20px;
  color: #243042;
}
h1 {
  font-size: 26px;
  font-weight: 600;
}
h2 {
  font-size: 18px;
  font-weight: 600;
}
section,
details {
  background: #fff;
  border: 1px solid #dce2ea;
  border-radius: 8px;
  padding: 20px;
  margin-top: 20px;
}
p {
  margin: 12px 0;
  line-height: 1.6;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 14px 0;
}
button,
input,
select {
  font: inherit;
  border: 1px solid #bcc7d4;
  border-radius: 5px;
  background: white;
  padding: 8px 10px;
}
button {
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
label {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 15px 0;
}
input:not([type='checkbox']),
select {
  max-width: 100%;
}
.error {
  color: #a92f37;
}
summary {
  cursor: pointer;
  font-weight: 600;
}
</style>
