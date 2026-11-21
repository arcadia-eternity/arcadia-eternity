<template>
  <div class="download-page">
    <div class="download-header">
      <div class="container mx-auto px-4 py-8 text-center">
        <h1 class="text-4xl font-bold mb-4">{{ $t('download.title', '下载客户端') }}</h1>
        <span class="inline-block bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
          {{ $t('download.version', '版本') }} {{ version }}
        </span>
      </div>
    </div>

    <div class="container mx-auto px-4 pb-8">
      <label v-if="sources.length > 1" class="mb-6 flex items-center justify-center gap-2">
        {{ $t('download.source', '下载源') }}
        <select v-model="source">
          <option v-for="item in sources" :key="item.base" :value="item.base">{{ item.name }}</option>
        </select>
      </label>
      <section v-if="recommended" class="recommended-download mx-auto mb-12 max-w-md">
        <h2 class="text-2xl font-semibold mb-6 text-center">{{ $t('download.recommended', '推荐下载') }}</h2>
        <DownloadButton :href="recommended.url">
          {{ platforms[recommended.platform].name }} · {{ downloadLabel(recommended) }}
        </DownloadButton>
      </section>
      <p v-else-if="platform?.isMobile" class="mb-6 text-center">
        {{ $t('download.mobileNotice', '客户端暂不支持移动设备，请在桌面设备上下载') }}
      </p>
      <section>
        <h2 class="text-2xl font-semibold mb-6 text-center">{{ $t('download.selectPlatform', '选择安装包') }}</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div
            v-for="group in groups"
            :key="group.name"
            class="platform-card bg-white rounded-lg shadow-md p-6 border border-gray-300"
          >
            <h3 class="flex items-center mb-4 text-xl font-semibold">
              <component :is="group.icon" class="w-8 h-8 mr-3" />{{ group.name }}
            </h3>
            <div class="space-y-3">
              <DownloadButton v-for="item in group.downloads" :key="item.url" :href="item.url">
                {{ downloadLabel(item) }}
              </DownloadButton>
            </div>
          </div>
        </div>
      </section>
      <p class="mt-6 text-center"><a :href="releasesUrl" class="text-blue-700 underline">GitHub Releases</a></p>

      <!-- 功能对比 -->
      <div class="feature-comparison mt-12">
        <h2 class="text-2xl font-semibold mb-6 text-center">
          {{ $t('download.featureComparison', '功能对比') }}
        </h2>

        <div class="max-w-4xl mx-auto">
          <div class="bg-white rounded-lg shadow-md overflow-hidden border border-gray-300">
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { releasesUrl } from '@/config/downloadSources'
import { useSmartDownload } from '@/composition/useSmartDownload'
import type { DesktopDownload, Platform } from '@/types/download'
import DownloadButton from '@/components/DownloadButton.vue'
import FeatureRow from '@/components/FeatureRow.vue'
import WindowsIcon from '@/components/icons/WindowsIcon.vue'
import MacOSIcon from '@/components/icons/MacOSIcon.vue'
import LinuxIcon from '@/components/icons/LinuxIcon.vue'

const { version, sources, source, downloads, recommended, platform } = useSmartDownload()
const platforms = {
  windows: { name: 'Windows', icon: WindowsIcon },
  macos: { name: 'macOS', icon: MacOSIcon },
  linux: { name: 'Linux', icon: LinuxIcon },
} satisfies Record<Platform, unknown>
const groups = computed(() =>
  Object.entries(platforms).map(([id, group]) => ({
    ...group,
    downloads: downloads.value.filter(item => item.platform === id),
  })),
)

function downloadLabel(item: DesktopDownload) {
  const chip =
    item.platform === 'macos' ? (item.architecture === 'arm64' ? 'Apple Silicon' : 'Intel') : item.architecture
  return `${chip} · ${item.format === 'AppImage' ? item.format : item.format.toUpperCase()}`
}
</script>

<style scoped>
.download-page {
  min-height: 100vh;
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
