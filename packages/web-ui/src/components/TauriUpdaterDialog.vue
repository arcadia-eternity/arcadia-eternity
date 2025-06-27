<template>
  <div v-if="showDialog" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
      <!-- 检查更新中 -->
      <div v-if="status === 'checking'" class="p-6">
        <div class="flex items-center space-x-3">
          <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          <h3 class="text-lg font-semibold">检查更新中...</h3>
        </div>
        <p class="text-gray-600 mt-2">正在检查是否有新版本可用</p>
      </div>

      <!-- 发现新版本 -->
      <div v-else-if="status === 'update-available'" class="p-6">
        <h3 class="text-lg font-semibold text-green-600 mb-4">发现新版本</h3>
        
        <div v-if="updateInfo" class="space-y-3">
          <div class="flex justify-between">
            <span class="text-gray-600">当前版本:</span>
            <span class="font-medium">{{ updateInfo.currentVersion }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">最新版本:</span>
            <span class="font-medium text-green-600">{{ updateInfo.version }}</span>
          </div>
          <div v-if="updateInfo.date" class="flex justify-between">
            <span class="text-gray-600">发布时间:</span>
            <span class="font-medium">{{ formatDate(updateInfo.date) }}</span>
          </div>
        </div>

        <div v-if="updateInfo?.body" class="mt-4">
          <h4 class="font-medium text-gray-800 mb-2">更新说明:</h4>
          <div class="bg-gray-50 p-3 rounded text-sm max-h-32 overflow-y-auto">
            <pre class="whitespace-pre-wrap">{{ updateInfo.body }}</pre>
          </div>
        </div>

        <div class="flex space-x-3 mt-6">
          <button 
            @click="downloadAndInstall"
            class="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
          >
            立即更新
          </button>
          <button 
            @click="closeDialog"
            class="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
          >
            稍后更新
          </button>
        </div>
      </div>

      <!-- 下载安装中 -->
      <div v-else-if="status === 'downloading' || status === 'installing'" class="p-6">
        <h3 class="text-lg font-semibold mb-4">
          {{ status === 'downloading' ? '下载更新中...' : '安装更新中...' }}
        </h3>
        
        <div class="space-y-3">
          <div class="w-full bg-gray-200 rounded-full h-2">
            <div 
              class="bg-blue-600 h-2 rounded-full transition-all duration-300"
              :style="{ width: `${progress.percentage}%` }"
            ></div>
          </div>
          
          <div class="flex justify-between text-sm text-gray-600">
            <span>{{ formatBytes(progress.downloaded) }} / {{ formatBytes(progress.total) }}</span>
            <span>{{ Math.round(progress.percentage) }}%</span>
          </div>
        </div>

        <p class="text-gray-600 mt-4 text-sm">
          {{ status === 'downloading' ? '正在下载更新文件，请稍候...' : '正在安装更新，即将完成...' }}
        </p>
      </div>

      <!-- 更新完成 -->
      <div v-else-if="status === 'complete'" class="p-6">
        <h3 class="text-lg font-semibold text-green-600 mb-4">更新完成</h3>
        <p class="text-gray-600 mb-4">更新已成功安装，需要重启应用以生效。</p>
        
        <div class="flex space-x-3">
          <button 
            @click="restartApp"
            class="flex-1 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition-colors"
          >
            立即重启
          </button>
          <button 
            @click="closeDialog"
            class="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
          >
            稍后重启
          </button>
        </div>
      </div>

      <!-- 已是最新版本 -->
      <div v-else-if="status === 'no-update'" class="p-6">
        <h3 class="text-lg font-semibold text-blue-600 mb-4">已是最新版本</h3>
        <p class="text-gray-600 mb-4">您当前使用的已经是最新版本，无需更新。</p>
        
        <button 
          @click="closeDialog"
          class="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
        >
          我知道了
        </button>
      </div>

      <!-- 错误状态 -->
      <div v-else-if="status === 'error'" class="p-6">
        <h3 class="text-lg font-semibold text-red-600 mb-4">更新失败</h3>
        <p class="text-gray-600 mb-4">{{ errorMessage || '更新过程中发生错误，请稍后重试。' }}</p>
        
        <button 
          @click="closeDialog"
          class="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
        >
          我知道了
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { 
  tauriUpdater,
  type UpdateInfo,
  type UpdateProgress
} from '@/utils/tauriUpdater'

type UpdateStatus = 'checking' | 'update-available' | 'downloading' | 'installing' | 'complete' | 'no-update' | 'error'

const showDialog = ref(false)
const status = ref<UpdateStatus>('checking')
const updateInfo = ref<UpdateInfo | null>(null)
const errorMessage = ref('')
const progress = ref<UpdateProgress>({
  downloaded: 0,
  total: 0,
  percentage: 0,
  status: 'checking'
})

const formatDate = (dateString: string): string => {
  try {
    return new Date(dateString).toLocaleDateString('zh-CN')
  } catch {
    return dateString
  }
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const checkForUpdates = async () => {
  status.value = 'checking'
  showDialog.value = true
  
  try {
    const update = await tauriUpdater.checkForUpdates()
    
    if (update) {
      updateInfo.value = update
      status.value = 'update-available'
    } else {
      status.value = 'no-update'
    }
  } catch (error) {
    status.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : '未知错误'
  }
}

const downloadAndInstall = async () => {
  try {
    status.value = 'downloading'
    
    await tauriUpdater.downloadAndInstall((progressInfo) => {
      progress.value = progressInfo
      status.value = progressInfo.status as UpdateStatus
    })
    
    status.value = 'complete'
  } catch (error) {
    status.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : '下载安装失败'
  }
}

const restartApp = async () => {
  try {
    await tauriUpdater.restartApp()
  } catch (error) {
    console.error('重启应用失败:', error)
    // 如果重启失败，显示错误信息
    status.value = 'error'
    errorMessage.value = '重启应用失败，请手动重启应用'
  }
}

const closeDialog = () => {
  showDialog.value = false
  status.value = 'checking'
  updateInfo.value = null
  errorMessage.value = ''
  progress.value = {
    downloaded: 0,
    total: 0,
    percentage: 0,
    status: 'checking'
  }
  
  // 清除待安装的更新
  tauriUpdater.clearPendingUpdate()
}

// 暴露方法给父组件
defineExpose({
  checkForUpdates
})
</script>
