<template>
  <div class="download-page">
    <!-- 页面头部 -->
    <div class="download-header">
      <div class="container mx-auto px-4 py-8">
        <h1 class="text-4xl font-bold text-center mb-4">
          {{ $t('download.title', '下载客户端') }}
        </h1>
        <p class="text-xl text-gray-600 text-center mb-8">
          {{ $t('download.subtitle', '获得更好的游戏体验') }}
        </p>

        <!-- 版本信息 -->
        <div class="text-center mb-8">
          <span class="inline-block bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
            {{ $t('download.version', '版本') }} {{ version }}
          </span>
        </div>
      </div>
    </div>

    <!-- 主要下载区域 -->
    <div class="container mx-auto px-4 pb-8">
      <!-- 推荐下载 -->
      <div class="recommended-download mb-12">
        <h2 class="text-2xl font-semibold mb-6 text-center">
          {{ $t('download.recommended', '推荐下载') }}
        </h2>

        <div class="max-w-md mx-auto">
          <div class="bg-white rounded-lg shadow-lg p-6 border-2 border-blue-200">
            <!-- 检测到的平台信息 -->
            <div class="text-center mb-4" v-if="platformInfo">
              <div class="flex items-center justify-center mb-2">
                <component :is="getPlatformIcon(platformInfo.platform)" class="w-8 h-8 mr-2" />
                <span class="text-lg font-medium">
                  {{ getPlatformDisplayName(platformInfo.platform, platformInfo.architecture) }}
                </span>
              </div>
              <p class="text-sm text-gray-600">
                {{ $t('download.detected', '已自动检测您的系统') }}
              </p>
            </div>

            <!-- 下载按钮 -->
            <button
              @click="handleRecommendedDownload"
              :disabled="isLoading || isMobile"
              class="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-3 px-6 rounded-lg transition-colors duration-200 flex items-center justify-center"
            >
              <svg
                v-if="isLoading"
                class="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <svg v-else class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              {{ isLoading ? $t('download.downloading', '下载中...') : $t('download.downloadNow', '立即下载') }}
            </button>

            <!-- 移动设备提示 -->
            <div v-if="isMobile" class="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p class="text-sm text-yellow-800 text-center">
                {{ $t('download.mobileNotice', '客户端暂不支持移动设备，请在桌面设备上下载') }}
              </p>
            </div>

            <!-- 文件信息 -->
            <div v-if="recommendedFileInfo" class="mt-4 text-sm text-gray-600 text-center">
              <p>{{ recommendedFileInfo.name }}</p>
              <p v-if="recommendedFileInfo.size">
                {{ $t('download.fileSize', '文件大小') }}: {{ formatFileSize(recommendedFileInfo.size) }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- 所有下载选项 -->
      <div class="all-downloads">
        <h2 class="text-2xl font-semibold mb-6 text-center">
          {{ $t('download.allVersions', '所有版本') }}
        </h2>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <!-- Windows -->
          <div class="platform-card bg-white rounded-lg shadow-md p-6">
            <div class="flex items-center mb-4">
              <WindowsIcon class="w-8 h-8 mr-3 text-blue-600" />
              <h3 class="text-xl font-semibold">Windows</h3>
            </div>

            <div class="space-y-3">
              <DownloadButton
                platform="windows"
                architecture="x64"
                format="nsis"
                :label="$t('download.windowsInstaller', 'Windows 安装包')"
                :description="$t('download.windowsInstallerDesc', '推荐给大多数用户')"
                @download="handleDownload"
              />
              <DownloadButton
                platform="windows"
                architecture="x64"
                format="msi"
                :label="$t('download.windowsMsi', 'Windows MSI')"
                :description="$t('download.windowsMsiDesc', '')"
                @download="handleDownload"
              />
            </div>
          </div>

          <!-- macOS -->
          <div class="platform-card bg-white rounded-lg shadow-md p-6">
            <div class="flex items-center mb-4">
              <MacOSIcon class="w-8 h-8 mr-3 text-gray-700" />
              <h3 class="text-xl font-semibold">macOS</h3>
            </div>

            <div class="space-y-3">
              <DownloadButton
                platform="macos"
                architecture="aarch64"
                format="app"
                :label="$t('download.macosAppleSilicon', 'macOS (Apple Silicon)')"
                :description="$t('download.macosAppleSiliconDesc', 'M系列 芯片')"
                @download="handleDownload"
              />
              <DownloadButton
                platform="macos"
                architecture="x64"
                format="app"
                :label="$t('download.macosIntel', 'macOS (Intel)')"
                :description="$t('download.macosIntelDesc', 'Intel 处理器')"
                @download="handleDownload"
              />
            </div>
          </div>

          <!-- Linux (预留) -->
          <div class="platform-card bg-white rounded-lg shadow-md p-6 opacity-50">
            <div class="flex items-center mb-4">
              <LinuxIcon class="w-8 h-8 mr-3 text-orange-600" />
              <h3 class="text-xl font-semibold">Linux</h3>
            </div>

            <div class="text-center text-gray-500">
              <p class="mb-2">{{ $t('download.comingSoon', '即将推出') }}</p>
              <p class="text-sm">{{ $t('download.linuxNotice', 'Linux 版本正在开发中') }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 功能对比 -->
      <div class="feature-comparison mt-12">
        <h2 class="text-2xl font-semibold mb-6 text-center">
          {{ $t('download.featureComparison', '功能对比') }}
        </h2>

        <div class="max-w-4xl mx-auto">
          <div class="bg-white rounded-lg shadow-md overflow-hidden">
            <table class="w-full">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {{ $t('download.feature', '功能') }}
                  </th>
                  <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {{ $t('download.webVersion', '网页版') }}
                  </th>
                  <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {{ $t('download.clientVersion', '客户端') }}
                  </th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                <FeatureRow :feature="$t('download.features.basicGame', '基础游戏功能')" :web="true" :client="true" />
                <FeatureRow :feature="$t('download.features.offline', '离线模式')" :web="true" :client="true" />
                <FeatureRow :feature="$t('download.features.localCache', '本地资源缓存')" :web="false" :client="true" />
                <FeatureRow :feature="$t('download.features.autoUpdate', '自动更新')" :web="false" :client="true" />
                <FeatureRow :feature="$t('download.features.performance', '更好的性能')" :web="false" :client="true" />
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 下载源状态 -->
      <div v-if="availableSources.length > 1" class="download-sources mt-12">
        <h2 class="text-2xl font-semibold mb-6 text-center">
          {{ $t('download.downloadSources', '下载源状态') }}
        </h2>

        <div class="max-w-2xl mx-auto">
          <div class="bg-white rounded-lg shadow-md p-6">
            <div class="space-y-3">
              <div
                v-for="source in availableSources"
                :key="source.id"
                class="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <div class="flex items-center">
                  <div
                    :class="[
                      'w-3 h-3 rounded-full mr-3',
                      sourceAvailability[source.id] ? 'bg-green-500' : 'bg-red-500',
                    ]"
                  ></div>
                  <div>
                    <p class="font-medium">{{ source.name }}</p>
                    <p class="text-sm text-gray-600">{{ source.description }}</p>
                  </div>
                </div>
                <span
                  :class="[
                    'px-2 py-1 rounded-full text-xs font-medium',
                    sourceAvailability[source.id] ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800',
                  ]"
                >
                  {{
                    sourceAvailability[source.id]
                      ? $t('download.available', '可用')
                      : $t('download.unavailable', '不可用')
                  }}
                </span>
              </div>
            </div>

            <button
              @click="refreshSourceAvailability"
              class="mt-4 w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 px-4 rounded-lg transition-colors duration-200"
            >
              {{ $t('download.refreshSources', '刷新状态') }}
            </button>
          </div>
        </div>
      </div>

      <!-- 错误提示 -->
      <div v-if="error" class="error-message mt-8">
        <div class="max-w-2xl mx-auto">
          <div class="bg-red-50 border border-red-200 rounded-lg p-4">
            <div class="flex">
              <svg class="w-5 h-5 text-red-400 mr-3 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div>
                <h3 class="text-sm font-medium text-red-800">
                  {{ $t('download.error', '下载出错') }}
                </h3>
                <p class="mt-1 text-sm text-red-700">{{ error }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useSmartDownload } from '@/composition/useSmartDownload'
import { getPlatformDisplayName, getFormatInfo } from '@/utils/platformDetection'
import DownloadButton from '@/components/DownloadButton.vue'
import FeatureRow from '@/components/FeatureRow.vue'
import WindowsIcon from '@/components/icons/WindowsIcon.vue'
import MacOSIcon from '@/components/icons/MacOSIcon.vue'
import LinuxIcon from '@/components/icons/LinuxIcon.vue'

// 简单的翻译函数，如果需要可以后续集成 i18next
const t = (key: string, fallback: string) => fallback

// 使用智能下载组合式函数
const {
  isLoading,
  error,
  platformInfo,
  sourceAvailability,
  version,
  availableSources,
  recommendedPlatform,
  recommendedArchitecture,
  recommendedFormat,
  isMobile,
  smartDownload,
  downloadSpecific,
  refreshSourceAvailability,
} = useSmartDownload()

// 推荐文件信息
const recommendedFileInfo = computed(() => {
  if (!recommendedFormat.value) return null
  const formatInfo = getFormatInfo(recommendedFormat.value)
  return {
    ...formatInfo,
    size: 0, // 暂时设为0，实际大小需要从构建过程中获取
  }
})

// 获取平台图标
const getPlatformIcon = (platform: string) => {
  switch (platform) {
    case 'windows':
      return WindowsIcon
    case 'macos':
      return MacOSIcon
    case 'linux':
      return LinuxIcon
    default:
      return WindowsIcon
  }
}

// 格式化文件大小
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// 处理推荐下载
const handleRecommendedDownload = async () => {
  if (isMobile.value) return
  await smartDownload()
}

// 处理特定平台下载
const handleDownload = async (platform: string, architecture: string, format: string) => {
  await downloadSpecific(platform, architecture, format)
}
</script>

<style scoped>
.download-page {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.download-header {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  color: white;
}

.container {
  max-width: 1200px;
}

.platform-card {
  transition:
    transform 0.2s ease-in-out,
    box-shadow 0.2s ease-in-out;
}

.platform-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
}

.feature-comparison table {
  border-collapse: separate;
  border-spacing: 0;
}

.download-sources {
  animation: fadeInUp 0.6s ease-out;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 响应式设计 */
@media (max-width: 768px) {
  .download-header h1 {
    font-size: 2rem;
  }

  .download-header p {
    font-size: 1rem;
  }

  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
