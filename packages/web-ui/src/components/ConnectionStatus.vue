<template>
  <div class="connection-status">
    <el-button
      class="connection-trigger"
      :title="statusDetail"
      :aria-label="statusDetail + '，连接设置'"
      size="small"
      :type="battleClientStore.isConnected ? 'success' : 'default'"
      @click="showDialog = true"
    >
      <span class="connection-label">{{ statusText }}</span>
    </el-button>
    <!-- The navigation's backdrop filter contains fixed-position descendants. -->
    <el-dialog v-model="showDialog" title="服务器连接" width="min(440px, 94vw)" append-to-body>
      <div class="space-y-4">
        <p role="status">{{ statusDetail }}</p>
        <p v-if="!battleClientStore.isConnected" class="text-sm break-all">
          准备连接：{{ battleClientStore.serverUrl }}
        </p>
        <el-switch v-if="!settings.isLocalMode" v-model="settings.autoConnect" active-text="进入联机页面时自动连接" />
        <p v-if="error || battleClientStore.connectionError" role="alert" class="text-sm text-red-600">
          {{ error || battleClientStore.connectionError }}
        </p>
        <p v-if="battleClientStore.isConnected" class="text-sm">
          在线玩家：{{ serverStateStore.serverState.onlinePlayers }} · 房间：{{ serverStateStore.serverState.rooms }}
        </p>
      </div>
      <template #footer>
        <RouterLink to="/servers" class="mr-4 text-blue-600" @click="showDialog = false">服务器列表</RouterLink>
        <el-button @click="showDialog = false">关闭</el-button>
        <el-button
          v-if="!battleClientStore.isConnected"
          type="primary"
          :loading="busy"
          :disabled="busy || !battleClientStore.initComplete"
          @click="connect"
          >{{ error || battleClientStore.connectionError ? '重试连接' : '连接服务器' }}</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useBattleClientStore } from '@/stores/battleClient'
import { useServerStateStore } from '@/stores/serverState'
import { connectionPresentation } from '@/services/connectionPresentation'
import { useLocalServerStore } from '@/stores/localServer'
import { useConnectionSettingsStore } from '@/stores/connectionSettings'

const battleClientStore = useBattleClientStore()
const serverStateStore = useServerStateStore()
const settings = useConnectionSettingsStore()
const local = useLocalServerStore()
const connection = computed(() =>
  connectionPresentation({
    connected: battleClientStore.isConnected,
    endpoint: battleClientStore.serverUrl,
    pageOrigin: window.location.origin,
    localEndpoint: local.snapshot.host.status === 'running' ? local.snapshot.host.url : undefined,
  }),
)
const showDialog = ref(false)
const pending = ref(false)
const error = ref('')
const busy = computed(
  () =>
    pending.value ||
    battleClientStore.isConnecting ||
    battleClientStore.isServerWaking ||
    battleClientStore.currentState.status === 'connecting',
)
const statusText = computed(() => {
  if (!battleClientStore.initComplete) return '初始化中'
  if (battleClientStore.isConnected) return connection.value.label
  if (busy.value) return battleClientStore.isServerWaking ? '正在唤醒服务器…' : '正在连接…'
  return '离线'
})
const statusDetail = computed(() =>
  !battleClientStore.initComplete
    ? '初始化中'
    : busy.value
      ? `${statusText.value} ${battleClientStore.serverUrl}`
      : connection.value.detail,
)
async function connect() {
  if (busy.value || !battleClientStore.initComplete) return
  pending.value = true
  error.value = ''
  try {
    await battleClientStore.connect()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '连接失败，请重试'
  } finally {
    pending.value = false
  }
}
</script>

<style scoped>
.connection-status {
  min-width: 0;
}
.connection-label {
  display: block;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 767px) {
  .connection-label {
    max-width: 108px;
  }
}
</style>
