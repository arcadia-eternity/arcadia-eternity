<template>
  <div class="p-6 max-w-2xl mx-auto">
    <h1 class="text-2xl font-bold mb-6">应用更新</h1>

    <!-- 非 Tauri 环境提示 -->
    <div v-if="!isTauri" class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
      <div class="flex items-center">
        <svg class="w-5 h-5 text-yellow-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
          <path
            fill-rule="evenodd"
            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
            clip-rule="evenodd"
          />
        </svg>
        <div>
          <h3 class="text-sm font-medium text-yellow-800">仅在 Tauri 环境下可用</h3>
          <p class="text-sm text-yellow-700 mt-1">
            更新功能仅在 Tauri 桌面应用中可用。当前运行在 Web 环境中，无法使用自动更新功能。
          </p>
        </div>
      </div>
    </div>

    <div v-if="isTauri" class="space-y-4">
      <!-- 手动检查更新按钮 -->
      <div class="bg-white rounded-lg shadow p-4">
        <h2 class="text-lg font-semibold mb-3">手动检查更新</h2>
        <button
          @click="checkUpdates"
          :disabled="isChecking"
          class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {{ isChecking ? '检查中...' : '检查更新' }}
        </button>
      </div>

      <!-- 自动检查设置 -->
      <div class="bg-white rounded-lg shadow p-4">
        <h2 class="text-lg font-semibold mb-3">自动检查设置</h2>
        <label class="flex items-center space-x-2">
          <input type="checkbox" v-model="autoCheck" @change="toggleAutoCheck" class="rounded" />
          <span>启动时自动检查更新</span>
        </label>

        <div v-if="autoCheck" class="mt-3">
          <label class="block text-sm font-medium text-gray-700 mb-1"> 检查间隔 (小时) </label>
          <select v-model="checkInterval" @change="updateCheckInterval" class="border rounded px-3 py-1">
            <option value="1">1 小时</option>
            <option value="6">6 小时</option>
            <option value="12">12 小时</option>
            <option value="24">24 小时</option>
          </select>
        </div>
      </div>

      <!-- 当前版本信息 -->
      <div class="bg-white rounded-lg shadow p-4">
        <h2 class="text-lg font-semibold mb-3">版本信息</h2>
        <div class="space-y-2 text-sm">
          <div><strong>当前版本:</strong> {{ currentVersion }}</div>
          <div><strong>最后检查:</strong> {{ lastCheckTime || '从未检查' }}</div>
          <div v-if="latestVersion"><strong>最新版本:</strong> {{ latestVersion }}</div>
        </div>
      </div>

      <!-- 更新历史 -->
      <div class="bg-white rounded-lg shadow p-4">
        <h2 class="text-lg font-semibold mb-3">更新历史</h2>
        <div v-if="updateHistory.length === 0" class="text-gray-500 text-sm">暂无更新历史</div>
        <div v-else class="space-y-2">
          <div
            v-for="(update, index) in updateHistory"
            :key="index"
            class="border-l-4 border-blue-500 pl-3 py-2 bg-gray-50"
          >
            <div class="font-medium">{{ update.version }}</div>
            <div class="text-sm text-gray-600">{{ update.date }}</div>
            <div class="text-sm">{{ update.status }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 更新对话框 -->
    <TauriUpdaterDialog ref="updaterDialog" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { getVersion } from '@tauri-apps/api/app'
import TauriUpdaterDialog from '@/components/TauriUpdaterDialog.vue'
import { tauriUpdater } from '@/utils/tauriUpdater'
import { isTauri } from '@/utils/env'

interface UpdateRecord {
  version: string
  date: string
  status: string
}

const isChecking = ref(false)
const autoCheck = ref(false)
const checkInterval = ref(24)
const currentVersion = ref('')
const latestVersion = ref('')
const lastCheckTime = ref('')
const updateHistory = ref<UpdateRecord[]>([])
const updaterDialog = ref<InstanceType<typeof TauriUpdaterDialog>>()

let autoCheckTimer: number | null = null

onMounted(async () => {
  if (!isTauri) {
    return
  }

  // 获取当前版本
  currentVersion.value = await getVersion()

  // 加载设置
  loadSettings()

  // 如果启用自动检查，则开始检查
  if (autoCheck.value) {
    startAutoCheck()
    // 启动时立即检查一次
    checkUpdatesInBackground()
  }
})

const loadSettings = () => {
  const settings = localStorage.getItem('updater-settings')
  if (settings) {
    const parsed = JSON.parse(settings)
    autoCheck.value = parsed.autoCheck || false
    checkInterval.value = parsed.checkInterval || 24
  }

  const history = localStorage.getItem('update-history')
  if (history) {
    updateHistory.value = JSON.parse(history)
  }

  lastCheckTime.value = localStorage.getItem('last-check-time') || ''
}

const saveSettings = () => {
  localStorage.setItem(
    'updater-settings',
    JSON.stringify({
      autoCheck: autoCheck.value,
      checkInterval: checkInterval.value,
    }),
  )
}

const addUpdateRecord = (version: string, status: string) => {
  const record: UpdateRecord = {
    version,
    date: new Date().toLocaleString(),
    status,
  }

  updateHistory.value.unshift(record)

  // 只保留最近10条记录
  if (updateHistory.value.length > 10) {
    updateHistory.value = updateHistory.value.slice(0, 10)
  }

  localStorage.setItem('update-history', JSON.stringify(updateHistory.value))
}

const checkUpdates = async () => {
  if (!isTauri) {
    console.warn('更新功能仅在 Tauri 环境下可用')
    return
  }

  if (updaterDialog.value) {
    await updaterDialog.value.checkForUpdates()
  }
}

const checkUpdatesInBackground = async () => {
  if (!isTauri) {
    console.warn('更新功能仅在 Tauri 环境下可用')
    return
  }

  isChecking.value = true

  try {
    const updateInfo = await tauriUpdater.checkForUpdates()
    lastCheckTime.value = new Date().toLocaleString()
    localStorage.setItem('last-check-time', lastCheckTime.value)

    if (updateInfo) {
      latestVersion.value = updateInfo.version
      addUpdateRecord(updateInfo.version, '发现新版本')

      // 如果是自动检查，可以选择是否自动弹出对话框
      if (autoCheck.value) {
        // 这里可以添加通知逻辑，而不是立即弹出对话框
        console.log('发现新版本:', updateInfo.version)
      }
    } else {
      addUpdateRecord(currentVersion.value, '已是最新版本')
    }
  } catch (error) {
    console.error('检查更新失败:', error)
    addUpdateRecord('', `检查失败: ${error}`)
  } finally {
    isChecking.value = false
  }
}

const toggleAutoCheck = () => {
  if (!isTauri) {
    console.warn('更新功能仅在 Tauri 环境下可用')
    return
  }

  saveSettings()

  if (autoCheck.value) {
    startAutoCheck()
  } else {
    stopAutoCheck()
  }
}

const updateCheckInterval = () => {
  if (!isTauri) {
    console.warn('更新功能仅在 Tauri 环境下可用')
    return
  }

  saveSettings()

  if (autoCheck.value) {
    stopAutoCheck()
    startAutoCheck()
  }
}

const startAutoCheck = () => {
  if (!isTauri) {
    console.warn('更新功能仅在 Tauri 环境下可用')
    return
  }

  if (autoCheckTimer) {
    clearInterval(autoCheckTimer)
  }

  const intervalMs = checkInterval.value * 60 * 60 * 1000 // 转换为毫秒
  autoCheckTimer = window.setInterval(checkUpdatesInBackground, intervalMs)
}

const stopAutoCheck = () => {
  if (autoCheckTimer) {
    clearInterval(autoCheckTimer)
    autoCheckTimer = null
  }
}

// 组件卸载时清理定时器
onUnmounted(() => {
  stopAutoCheck()
})
</script>
