<template>
  <div>
    <el-button size="small" :type="battleClientStore.isConnected ? 'success' : 'default'" @click="showDialog = true">
      {{ statusText }}
    </el-button>
    <!-- The navigation's backdrop filter contains fixed-position descendants. -->
    <el-dialog v-model="showDialog" title="服务器连接" width="min(440px, 94vw)" append-to-body>
      <div class="space-y-4">
        <p role="status">{{ statusText }}</p>
        <p class="text-sm break-all">服务器：{{ battleClientStore.serverUrl }}</p>
        <p v-if="settings.isLocalMode" class="text-sm text-gray-500">
          本地模式不会自动连接服务器。需要联机时，请手动连接或在大厅启动本机托管。
        </p>
        <template v-else>
          <el-switch v-model="settings.autoConnect" active-text="进入联机页面时自动连接" />
          <p class="text-sm text-gray-500">设置会保存在此浏览器。关闭后仍可手动连接，不会断开已有连接。</p>
        </template>
        <p v-if="error || battleClientStore.connectionError" role="alert" class="text-sm text-red-600">
          {{ error || battleClientStore.connectionError }}
        </p>
        <p v-if="battleClientStore.isConnected" class="text-sm">
          在线玩家：{{ serverStateStore.serverState.onlinePlayers }} · 房间：{{ serverStateStore.serverState.rooms }}
        </p>
      </div>
      <template #footer>
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
import { useConnectionSettingsStore } from '@/stores/connectionSettings'

const battleClientStore = useBattleClientStore()
const serverStateStore = useServerStateStore()
const settings = useConnectionSettingsStore()
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
  if (battleClientStore.isConnected) return '已连接'
  if (busy.value) return battleClientStore.isServerWaking ? '正在唤醒服务器…' : '正在连接…'
  return '未连接 · 连接设置'
})
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
