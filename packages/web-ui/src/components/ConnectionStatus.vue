<template>
  <div class="fixed right-4 bottom-4 z-50 md:right-5 md:bottom-5">
    <!-- 连接状态指示器 -->
    <transition name="connection-status" mode="out-in">
      <div
        v-if="showStatus"
        :class="{ 'cursor-pointer': !isMobile || connectionState === 'disconnected' }"
        @click="handleStatusClick"
      >
        <!-- 正常连接状态 -->
        <el-tag
          v-if="connectionState === 'connected'"
          type="success"
          effect="dark"
          round
          :class="['transition-all duration-300', !isMobile ? 'hover:scale-105 hover:shadow-lg cursor-pointer' : '']"
        >
          <el-icon :size="14" class="animate-pulse">
            <Connection />
          </el-icon>
          已连接
        </el-tag>

        <!-- 连接中状态 -->
        <el-tag
          v-else-if="connectionState === 'connecting'"
          type="warning"
          effect="dark"
          round
          class="transition-all duration-300"
        >
          <el-icon :size="14" class="animate-spin">
            <Loading />
          </el-icon>
          连接中...
        </el-tag>

        <!-- 断线状态 - 更明显的提示 -->
        <div
          v-else
          class="bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg border-2 border-red-400 transition-all duration-300 hover:scale-105 hover:shadow-xl animate-pulse cursor-pointer"
        >
          <div class="flex items-center space-x-2">
            <el-icon :size="16" class="text-red-200">
              <Warning />
            </el-icon>
            <span class="font-medium">连接断开</span>
            <el-icon :size="14" class="text-red-200">
              <Refresh />
            </el-icon>
          </div>
          <div class="text-xs text-red-200 mt-1 text-center">点击立即重连</div>
        </div>
      </div>
    </transition>

    <!-- 连接详情对话框 -->
    <el-dialog v-model="showReconnectDialog" title="连接详情" width="400px" center>
      <div class="text-center space-y-4">
        <div class="flex justify-center">
          <el-icon :size="48" :class="dialogIconClass">
            <component :is="dialogIcon" />
          </el-icon>
        </div>

        <div>
          <h3 class="text-lg font-semibold mb-2">连接正常</h3>
          <p class="text-gray-600">{{ dialogMessage }}</p>
        </div>

        <!-- 连接详情 -->
        <div v-if="showConnectionDetails" class="bg-gray-50 p-3 rounded-lg text-sm">
          <div class="space-y-1">
            <div class="flex justify-between">
              <span>连接状态:</span>
              <span :class="connectionStateClass">{{ connectionStateText }}</span>
            </div>
            <div class="flex justify-between">
              <span>在线玩家:</span>
              <span>{{ serverState.onlinePlayers }}</span>
            </div>
            <div class="flex justify-between">
              <span>匹配队列:</span>
              <span>{{ serverState.matchmakingQueue }}</span>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-center">
          <el-button @click="showReconnectDialog = false"> 关闭 </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Connection, Refresh, Loading, SuccessFilled, Warning } from '@element-plus/icons-vue'
import { useMobile } from '@/composition/useMobile'
import { useBattleClientStore } from '@/stores/battleClient'
import { useServerStateStore } from '@/stores/serverState'

const battleClientStore = useBattleClientStore()
const serverStateStore = useServerStateStore()

// 移动端检测
const { isMobile } = useMobile()

// 响应式状态
const showStatus = ref(true)
const showReconnectDialog = ref(false)
const isReconnecting = ref(false)
const showConnectionDetails = ref(false)

// 计算属性
const connectionState = computed(() => {
  return battleClientStore.currentState.status
})

const serverState = computed(() => {
  return serverStateStore.serverState
})

const connectionStateText = computed(() => {
  switch (connectionState.value) {
    case 'connected':
      return '已连接'
    case 'connecting':
      return '连接中'
    case 'disconnected':
    default:
      return '已断开'
  }
})

const connectionStateClass = computed(() => {
  switch (connectionState.value) {
    case 'connected':
      return 'text-green-600 font-medium'
    case 'connecting':
      return 'text-yellow-600 font-medium'
    case 'disconnected':
    default:
      return 'text-red-600 font-medium'
  }
})

const dialogMessage = computed(() => {
  return '与服务器连接正常，所有功能可用。如需重连，请点击右下角的连接状态指示器。'
})

const dialogIcon = computed(() => {
  return SuccessFilled
})

const dialogIconClass = computed(() => {
  return 'text-green-500'
})

// 方法
const handleStatusClick = () => {
  console.log('连接状态被点击:', connectionState.value, '移动端:', isMobile.value)

  if (connectionState.value === 'disconnected') {
    // 断线状态直接重连
    handleReconnect()
  } else if (connectionState.value === 'connected' && !isMobile.value) {
    // 已连接状态在桌面端显示详情对话框，移动端不响应
    showReconnectDialog.value = true
    showConnectionDetails.value = true
  }
  // 连接中状态不做任何操作
  // 移动端连接正常时不做任何操作
}

const handleReconnect = async () => {
  if (isReconnecting.value) return

  isReconnecting.value = true

  try {
    await battleClientStore.connect()
    ElMessage.success('重连成功')
    showReconnectDialog.value = false
  } catch (error: any) {
    console.error('重连失败:', error)
    ElMessage.error(error.message || '重连失败，请稍后再试')
  } finally {
    isReconnecting.value = false
  }
}

// 监听连接状态变化
watch(connectionState, (newState, oldState) => {
  console.log('连接状态变化:', oldState, '->', newState)

  // 从断开状态恢复连接时显示成功消息
  if (oldState === 'disconnected' && newState === 'connected') {
    ElMessage.success('连接已恢复')
    if (showReconnectDialog.value) {
      showReconnectDialog.value = false
    }
  }

  // 连接断开时显示警告
  if (oldState === 'connected' && newState === 'disconnected') {
    ElMessage.warning('连接已断开')
  }

  // 连接超时时显示提示
  if (oldState === 'connecting' && newState === 'disconnected') {
    ElMessage.error('连接超时，请检查网络连接')
  }
})
</script>

<style scoped>
/* 连接状态过渡动画 */
.connection-status-enter-active,
.connection-status-leave-active {
  transition: all 0.3s ease;
}

.connection-status-enter-from {
  opacity: 0;
  transform: translateY(10px) scale(0.9);
}

.connection-status-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.9);
}

/* 脉冲动画增强 */
@keyframes enhanced-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.7;
    transform: scale(1.05);
  }
}

.animate-pulse {
  animation: enhanced-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
</style>
