<template>
  <div v-if="showDialog" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg p-6 max-w-md w-full mx-4">
      <!-- 检查更新状态 -->
      <div v-if="status === 'checking'" class="text-center">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <h3 class="text-lg font-semibold mb-2">检查更新中...</h3>
        <p class="text-gray-600">正在检查是否有新版本可用</p>
      </div>

      <!-- 发现更新 -->
      <div v-else-if="status === 'update-available'" class="text-center">
        <div class="text-green-600 mb-4">
          <svg class="w-12 h-12 mx-auto" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
          </svg>
        </div>
        <h3 class="text-lg font-semibold mb-2">发现新版本</h3>
        <p class="text-gray-600 mb-2">版本 {{ updateInfo?.version }}</p>
        <p class="text-sm text-gray-500 mb-4">大小: {{ formatFileSize(updateInfo?.size || 0) }}</p>
        
        <div v-if="updateInfo?.body" class="bg-gray-50 p-3 rounded mb-4 text-left">
          <h4 class="font-medium mb-2">更新内容:</h4>
          <p class="text-sm text-gray-700 whitespace-pre-wrap">{{ updateInfo.body }}</p>
        </div>

        <!-- 更新说明 -->
        <div class="bg-blue-50 p-3 rounded mb-4 text-left">
          <h4 class="font-medium mb-2 text-blue-800">更新步骤:</h4>
          <p class="text-sm text-blue-700 whitespace-pre-line">{{ updateInstructions }}</p>
        </div>

        <div class="flex space-x-3">
          <button 
            @click="downloadDMG"
            class="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
          >
            下载 DMG
          </button>
          <button 
            @click="openReleasePage"
            class="flex-1 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition-colors"
          >
            查看发布页
          </button>
          <button 
            @click="closeDialog"
            class="flex-1 bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400 transition-colors"
          >
            稍后提醒
          </button>
        </div>
      </div>

      <!-- 无更新 -->
      <div v-else-if="status === 'no-update'" class="text-center">
        <div class="text-blue-600 mb-4">
          <svg class="w-12 h-12 mx-auto" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
          </svg>
        </div>
        <h3 class="text-lg font-semibold mb-2">已是最新版本</h3>
        <p class="text-gray-600 mb-4">当前版本已是最新，无需更新</p>
        
        <button 
          @click="closeDialog"
          class="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
        >
          确定
        </button>
      </div>

      <!-- 错误状态 -->
      <div v-else-if="status === 'error'" class="text-center">
        <div class="text-red-600 mb-4">
          <svg class="w-12 h-12 mx-auto" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
          </svg>
        </div>
        <h3 class="text-lg font-semibold mb-2">检查更新失败</h3>
        <p class="text-gray-600 mb-4">{{ errorMessage }}</p>
        
        <div class="flex space-x-3">
          <button 
            @click="checkForUpdates"
            class="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
          >
            重试
          </button>
          <button 
            @click="closeDialog"
            class="flex-1 bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400 transition-colors"
          >
            取消
          </button>
        </div>
      </div>

      <!-- 下载提示 -->
      <div v-else-if="status === 'downloading'" class="text-center">
        <div class="text-blue-600 mb-4">
          <svg class="w-12 h-12 mx-auto" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
        </div>
        <h3 class="text-lg font-semibold mb-2">正在下载...</h3>
        <p class="text-gray-600 mb-4">浏览器将开始下载新版本 DMG</p>
        
        <div class="bg-yellow-50 p-3 rounded mb-4 text-left">
          <h4 class="font-medium mb-2 text-yellow-800">下载完成后:</h4>
          <p class="text-sm text-yellow-700 whitespace-pre-line">{{ updateInstructions }}</p>
        </div>
        
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
import { ref, computed } from 'vue'
import { 
  dmgUpdater,
  type DMGUpdateInfo
} from '@/utils/dmgUpdater'

type UpdateStatus = 'checking' | 'update-available' | 'downloading' | 'no-update' | 'error'

const showDialog = ref(false)
const status = ref<UpdateStatus>('checking')
const updateInfo = ref<DMGUpdateInfo | null>(null)
const errorMessage = ref('')

const updateInstructions = computed(() => {
  return dmgUpdater.getUpdateInstructions()
})

const formatFileSize = (bytes: number): string => {
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
    const update = await dmgUpdater.checkForUpdates()
    
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

const downloadDMG = async () => {
  if (!updateInfo.value) return
  
  try {
    status.value = 'downloading'
    await dmgUpdater.downloadDMG(updateInfo.value)
  } catch (error) {
    status.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : '下载失败'
  }
}

const openReleasePage = async () => {
  if (!updateInfo.value) return
  
  try {
    await dmgUpdater.openDownloadPage(updateInfo.value)
  } catch (error) {
    console.error('打开发布页面失败:', error)
  }
}

const closeDialog = () => {
  showDialog.value = false
  status.value = 'checking'
  updateInfo.value = null
  errorMessage.value = ''
}

// 暴露方法给父组件
defineExpose({
  checkForUpdates
})
</script>
