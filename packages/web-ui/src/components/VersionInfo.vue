<template>
  <div class="version-info">
    <!-- 简单版本显示 -->
    <div
      v-if="!showDetails"
      @click="showDetails = true"
      class="version-simple cursor-pointer text-xs text-gray-500 hover:text-gray-700 transition-colors"
      :title="detailedVersionString"
    >
      {{ versionString }}
    </div>

    <!-- 详细版本信息弹窗 -->
    <el-dialog
      v-model="showDetails"
      title="版本信息"
      width="400px"
      :show-close="true"
      :close-on-click-modal="true"
      :close-on-press-escape="true"
    >
      <div class="version-details space-y-3">
        <div class="flex justify-between items-center">
          <span class="text-gray-600">版本号:</span>
          <span class="font-mono font-semibold">{{ versionInfo.version }}</span>
        </div>

        <div class="flex justify-between items-center">
          <span class="text-gray-600">环境:</span>
          <el-tag :type="versionInfo.environment === 'production' ? 'success' : 'warning'" size="small">
            {{ versionInfo.environment === 'production' ? '生产环境' : '开发环境' }}
          </el-tag>
        </div>

        <div class="flex justify-between items-center">
          <span class="text-gray-600">平台:</span>
          <el-tag :type="versionInfo.isTauri ? 'primary' : 'info'" size="small">
            {{ versionInfo.isTauri ? 'Tauri桌面版' : 'Web版' }}
          </el-tag>
        </div>

        <div class="flex justify-between items-center">
          <span class="text-gray-600">构建时间:</span>
          <span class="text-sm">{{ buildTimeFormatted }}</span>
        </div>

        <div v-if="versionInfo.environment === 'development'" class="flex justify-between items-center">
          <span class="text-gray-600">提交哈希:</span>
          <span class="font-mono text-sm">{{ versionInfo.commitHash.substring(0, 7) }}</span>
        </div>

        <!-- 更新检查按钮（仅Tauri版本） -->
        <div v-if="versionInfo.isTauri" class="pt-3 border-t">
          <el-button @click="checkForUpdates" :loading="checkingUpdates" type="primary" size="small" class="w-full">
            {{ checkingUpdates ? '检查中...' : '检查更新' }}
          </el-button>
        </div>
      </div>

      <template #footer>
        <el-button @click="showDetails = false" size="small"> 关闭 </el-button>
        <el-button @click="copyVersionInfo" type="primary" size="small"> 复制版本信息 </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getVersionInfo,
  getVersionString,
  getDetailedVersionString,
  getVersionInfoAsync,
  getVersionStringAsync,
  getDetailedVersionStringAsync,
} from '@/utils/version'
import { isTauri } from '@/utils/env'

// 版本信息
const versionInfo = ref(getVersionInfo())
const versionString = ref(getVersionString())
const detailedVersionString = ref(getDetailedVersionString())

// 状态
const showDetails = ref(false)
const checkingUpdates = ref(false)

// 在 Tauri 环境下异步更新版本信息
onMounted(async () => {
  if (isTauri) {
    try {
      versionInfo.value = await getVersionInfoAsync()
      versionString.value = await getVersionStringAsync()
      detailedVersionString.value = await getDetailedVersionStringAsync()
    } catch (error) {
      console.warn('无法获取 Tauri 版本信息:', error)
    }
  }
})

// 格式化构建时间
const buildTimeFormatted = computed(() => {
  return new Date(versionInfo.value.buildTime).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
})

/**
 * 复制版本信息到剪贴板
 */
async function copyVersionInfo() {
  try {
    await navigator.clipboard.writeText(detailedVersionString.value)
    ElMessage.success('版本信息已复制到剪贴板')
  } catch (error) {
    console.error('复制失败:', error)
    ElMessage.error('复制失败，请手动复制')
  }
}

/**
 * 检查更新（仅Tauri版本）
 */
async function checkForUpdates() {
  if (!versionInfo.value.isTauri) {
    return
  }

  checkingUpdates.value = true

  try {
    // 动态导入Tauri API
    const { check } = await import('@tauri-apps/plugin-updater')

    const update = await check()

    if (update) {
      ElMessage.success(`发现新版本: ${update.version}`)

      // 询问是否立即更新
      const { ElMessageBox } = await import('element-plus')

      try {
        await ElMessageBox.confirm(`发现新版本 ${update.version}，是否立即下载并安装？`, '更新提示', {
          confirmButtonText: '立即更新',
          cancelButtonText: '稍后更新',
          type: 'info',
        })

        // 开始下载和安装更新
        ElMessage.info('开始下载更新...')
        await update.downloadAndInstall()

        // 重启应用
        const { relaunch } = await import('@tauri-apps/plugin-process')
        await relaunch()
      } catch (cancelError) {
        // 用户取消更新
        ElMessage.info('已取消更新')
      }
    } else {
      ElMessage.info('当前已是最新版本')
    }
  } catch (error) {
    console.error('检查更新失败:', error)
    ElMessage.error('检查更新失败，请稍后重试')
  } finally {
    checkingUpdates.value = false
  }
}
</script>

<style scoped>
.version-info {
  user-select: none;
}

.version-simple {
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Droid Sans Mono', 'Source Code Pro', monospace;
}

.version-details {
  font-size: 14px;
}
</style>
