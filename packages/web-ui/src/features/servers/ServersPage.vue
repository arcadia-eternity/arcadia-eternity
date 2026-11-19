<script setup lang="ts">
import { flushProfile, profileInitialized } from '@/services/profile'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElMessageBox, ElInput, ElSelect, ElOption, ElButton, ElInputNumber } from 'element-plus'
import { getBackendOrigin } from '@/bootstrap/deployment'
import { useBattleClientStore } from '@/stores/battleClient'
import { useLocalServerStore } from '@/stores/localServer'
import { createIpcManagementClient } from '@/services/managementClient'
import { enterLocalServer, serverOrigin } from '@/services/serverNavigation'
import { readLocalData, writeLocalData } from '@/services/localStorage'
import type { LocalServerRequest } from '@/types/localServer'
import type { ManagedServer } from '@/types/management'
import { isDesktop, isStaticMode } from '@/utils/env'
import './serverPages.css'
const router = useRouter()
const client = useBattleClientStore()
const local = useLocalServerStore()
const address = ref('')
const error = ref('')
const notice = ref('')
const connecting = ref(false)
const summary = ref<ManagedServer>()
const { configuration, snapshot, busy: hostBusy } = storeToRefs(local)
const canHost = computed(() => local.available)
const { initComplete } = storeToRefs(client)
const desktop = ref(isDesktop)
const host = computed(() => local.snapshot.host)
const running = computed(() => (host.value.status === 'running' ? host.value : undefined))
const phaseLabels = {
  idle: '未启动',
  preparing: '正在准备玩法…',
  starting: '正在启动服务…',
  ready: '运行中',
  draining: '等待现有对局结束…',
  failed: '需要处理',
}
const phase = computed(() =>
  local.busy
    ? phaseLabels[local.snapshot.phase]
    : local.running
      ? '运行中'
      : host.value.status === 'failed'
        ? '启动失败'
        : '未启动',
)
const recent = ref<string[]>([])
try {
  const stored: unknown = JSON.parse(readLocalData('servers.recent') ?? '[]')
  if (Array.isArray(stored))
    recent.value = stored
      .filter((value): value is string => {
        try {
          return typeof value === 'string' && serverOrigin(value) === value
        } catch {
          return false
        }
      })
      .slice(0, 8)
} catch {
  /* A damaged history never blocks connecting. */
}
let timer: ReturnType<typeof setTimeout> | undefined
let disposed = false
const management = window.arcadiaDesktop?.managementRequest
  ? createIpcManagementClient(
      { transport: 'ipc', endpoint: 'local-workspace', label: '本机服务器' },
      window.arcadiaDesktop.managementRequest,
    )
  : undefined
async function refresh() {
  await local.refresh()
  if (running.value && management) {
    const serverId = running.value.serverId
    const result = await management.request<{ servers: ManagedServer[] }>('GET', '/servers')
    if (running.value?.serverId === serverId) summary.value = result.servers.find(server => server.id === serverId)
  } else summary.value = undefined
}
async function poll() {
  try {
    await refresh()
  } catch (cause) {
    if (!local.busy) error.value = cause instanceof Error ? cause.message : '无法读取服务器状态'
  } finally {
    if (!disposed) timer = setTimeout(poll, 1500)
  }
}
onMounted(() => {
  if (local.available) void poll()
})
onBeforeUnmount(() => {
  disposed = true
  clearTimeout(timer)
})
async function operate(input: LocalServerRequest) {
  error.value = ''
  notice.value = ''
  try {
    await local.execute(input)
    await refresh()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '操作失败，请重试'
  }
}
async function start() {
  await operate({ action: 'start', configuration: { ...configuration.value } })
}
async function editSavedSettings() {
  await operate({ action: 'recover' })
  if (local.running) await router.push('/management?target=local&tab=network')
}
async function enter() {
  local.error = ''
  connecting.value = true
  error.value = ''
  try {
    if (await enterLocalServer()) await router.push('/lobby')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法进入服务器'
  } finally {
    connecting.value = false
  }
}
async function remote(value: string, mode: 'play' | 'management' = 'play') {
  connecting.value = true
  error.value = ''
  try {
    const url = serverOrigin(value)
    if (window.arcadiaDesktop) {
      if (mode !== 'management' && profileInitialized()) await flushProfile()
      await window.arcadiaDesktop.openRemotePlay({ url, mode })
      recent.value = [...new Set([url, ...recent.value])].slice(0, 8)
      writeLocalData('servers.recent', JSON.stringify(recent.value))
    } else {
      if (url !== getBackendOrigin()) throw new Error('当前网页连接由此站点提供的服务器；访问其他服务器请打开它的网页')
      if (mode === 'management') await router.push({ path: '/management', query: { target: 'server' } })
      else {
        await client.connect()
        await router.push('/lobby')
      }
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法打开服务器'
  } finally {
    connecting.value = false
  }
}
async function website(value: string) {
  error.value = ''
  try {
    const url = serverOrigin(value)
    if (window.arcadiaDesktop) await window.arcadiaDesktop.openServerWebsite({ url })
    else throw new Error('请直接在浏览器访问服务器网址；当前网页不提供切服')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法打开服务器网页'
  }
}
async function forceStop() {
  try {
    await ElMessageBox.confirm('立即停止会中断仍在进行的对局。', '立即停止服务器', {
      confirmButtonText: '中断并停止',
      cancelButtonText: '继续等待',
      type: 'warning',
    })
  } catch {
    return
  }
  await operate({ action: 'stop', force: true })
}
async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    notice.value = '连接地址已复制'
  } catch {
    error.value = '无法写入剪贴板，请选择并复制下面的连接地址'
  }
}
</script>
<template>
  <main class="server-page server-stack">
    <h1>服务器</h1>
    <p v-if="error || local.error" role="alert" class="server-error">{{ error || local.error }}</p>
    <p v-if="notice" role="status" class="server-notice">{{ notice }}</p>
    <p class="server-small">当前游玩：{{ client.isConnected ? client.serverUrl : '离线' }}</p>
    <section v-if="!isStaticMode" class="server-panel server-stack" aria-label="加入服务器">
      <h2>{{ desktop ? '访问服务器' : '当前网页的服务器' }}</h2>
      <form v-if="desktop" class="server-gap" @submit.prevent="remote(address)">
        <label
          >服务器地址<ElInput v-model="address" type="url" required placeholder="https://play.example.com"
        /></label>
        <div class="server-actions">
          <ElButton type="primary" native-type="submit" :loading="connecting" :disabled="!address.trim()"
            >用客户端连接</ElButton
          >
          <ElButton v-if="desktop" native-type="button" :disabled="!address.trim()" @click="website(address)">
            在浏览器中打开
          </ElButton>
          <details v-if="desktop" class="management-menu">
            <summary>更多</summary>
            <ElButton
              native-type="button"
              :disabled="connecting || !address.trim()"
              @click="remote(address, 'management')"
            >
              管理员登录
            </ElButton>
          </details>
        </div>
      </form>
      <div class="server-row">
        <div>
          <h3 v-if="desktop">默认服务器</h3>
          <p class="server-address">{{ getBackendOrigin() }}</p>
        </div>
        <div class="server-actions">
          <ElButton :disabled="connecting || (!desktop && !initComplete)" @click="remote(getBackendOrigin())">
            {{ desktop ? '用客户端连接' : '进入大厅' }}
          </ElButton>
          <ElButton v-if="desktop" @click="website(getBackendOrigin())">在浏览器中打开</ElButton>
          <details class="management-menu">
            <summary>更多</summary>
            <ElButton :disabled="connecting" @click="remote(getBackendOrigin(), 'management')">管理员登录</ElButton>
          </details>
        </div>
      </div>
      <div v-for="url in recent.filter(item => item !== getBackendOrigin())" :key="url" class="server-row server-entry">
        <span class="server-address">{{ url }}</span>
        <div class="server-actions">
          <ElButton :disabled="connecting" @click="remote(url)">用客户端连接</ElButton
          ><ElButton @click="website(url)">在浏览器中打开</ElButton>
          <details class="management-menu">
            <summary>更多</summary>
            <ElButton :disabled="connecting" @click="remote(url, 'management')">管理员登录</ElButton>
          </details>
        </div>
      </div>
    </section>
    <section v-if="canHost" class="server-panel server-stack" aria-label="本机服务器">
      <div class="server-row">
        <h2>{{ summary?.name || '本机服务器' }}</h2>
        <span role="status">{{ phase }}</span>
      </div>
      <template v-if="hostBusy">
        <ElButton v-if="snapshot.phase === 'draining'" @click="forceStop">立即中断并停止</ElButton>
      </template>
      <template v-else-if="running">
        <p v-if="running.localRecovery" class="server-notice">仅本机修复模式。修改网络设置后重启。</p>
        <p v-else-if="running.network?.scope === 'local'">仅本机可连接</p>
        <div v-if="running.network?.inviteUrls.length" class="server-gap">
          <h3>邀请朋友</h3>
          <div v-for="url in running.network.inviteUrls" :key="url" class="server-row">
            <code class="server-address">{{ url }}</code
            ><ElButton @click="copy(url)">复制连接地址</ElButton
            ><ElButton @click="website(url)">在浏览器中打开</ElButton>
          </div>
        </div>
        <p v-else class="server-address">本机地址：{{ running.url }}</p>
        <div class="server-actions">
          <ElButton type="primary" :disabled="connecting || !initComplete" @click="enter"> 进入本机大厅 </ElButton>
          <RouterLink class="server-link" to="/management?target=local&tab=server">管理后台</RouterLink>
          <RouterLink class="server-link" to="/management?target=local&tab=network">网络与容量</RouterLink>
          <RouterLink to="/environments?target=host">服务器环境</RouterLink>
          <ElButton @click="operate({ action: 'stop' })">等待对局结束后停止</ElButton>
        </div>
        <div v-if="summary?.pendingRestart?.length" class="server-notice server-gap">
          <p>设置待重启</p>
          <div><ElButton @click="operate({ action: 'restart' })">对局结束后重启</ElButton></div>
        </div>
        <p class="server-small">退出客户端会停止本机服务器。</p>
      </template>
      <template v-else>
        <p v-if="host.status === 'failed'" role="alert" class="server-error">{{ host.message }}</p>
        <div v-if="snapshot.configured" class="server-actions">
          <ElButton type="primary" @click="operate({ action: 'start' })"> 使用已保存配置启动 </ElButton>
          <ElButton @click="editSavedSettings">修改已保存设置</ElButton>
          <ElButton
            v-if="host.status === 'failed' || snapshot.phase === 'failed'"
            @click="operate({ action: 'recover' })"
          >
            仅本机启动以修复
          </ElButton>
        </div>
        <form v-else class="server-stack" @submit.prevent="start">
          <label>服务器名称<ElInput v-model="configuration.name" required maxlength="80" /></label>
          <label
            >谁可以连接<ElSelect aria-label="谁可以连接" v-model="configuration.scope">
              <ElOption value="lan" label="同一局域网的朋友" />
              <ElOption value="local" label="仅我自己（测试）" />
              <ElOption value="public" label="通过已配置的公网地址" /> </ElSelect
          ></label>
          <p v-if="configuration.scope === 'public'" class="server-small">需要可访问的公网入口。</p>
          <label v-if="configuration.scope === 'public'"
            >公网访问地址<ElInput
              v-model="configuration.publicOrigin"
              type="url"
              required
              placeholder="https://play.example.com"
          /></label>
          <details>
            <summary>高级设置</summary>
            <label
              >端口（0 为自动分配）<ElInputNumber
                controls-position="right"
                :value-on-clear="0"
                v-model="configuration.port"
                required
                :min="0"
                :max="65535"
            /></label>
          </details>
          <div class="server-actions">
            <ElButton type="primary" native-type="submit" :loading="hostBusy">启动服务器</ElButton>
            <RouterLink class="server-link" to="/environments?target=local">管理环境</RouterLink>
          </div>
        </form>
      </template>
    </section>
    <section v-else-if="!desktop" class="server-panel server-gap">
      <h2>自己开服</h2>
      <div><RouterLink class="server-link" to="/download">下载客户端</RouterLink></div>
    </section>
    <details v-if="desktop">
      <summary>高级工具</summary>
      <div class="server-actions">
        <RouterLink class="server-link" to="/settings/local-service">服务器项目与诊断</RouterLink
        ><RouterLink class="server-link" to="/creation/development">开发服务工作区</RouterLink>
      </div>
    </details>
  </main>
</template>
