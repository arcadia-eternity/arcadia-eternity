<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  hasOfflineResources,
  loadOfflineManifest,
  offlineSupported,
  saveOfflineResources,
  type OfflineManifest,
} from '@/services/offlineResources'

const supported = offlineSupported()
const manifest = ref<OfflineManifest>()
const ready = ref(false)
const saving = ref(false)
const completed = ref(0)
const error = ref('')

onMounted(async () => {
  if (!supported) return
  try {
    ready.value = await hasOfflineResources()
    manifest.value = await loadOfflineManifest()
  } catch {
    // An installed build still works without a network manifest.
  }
})

async function save() {
  saving.value = true
  error.value = ''
  completed.value = 0
  try {
    manifest.value = await loadOfflineManifest()
    await saveOfflineResources(manifest.value, value => {
      completed.value = value
    })
    ready.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '离线资源保存失败，请重试。'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700" aria-label="离线资源">
    <div class="flex flex-wrap items-center gap-3">
      <span v-if="ready" role="status">离线资源已就绪</span>
      <span v-else>本地对战无需游戏服务器。</span>
      <button
        v-if="supported"
        type="button"
        class="rounded border border-slate-400 bg-white px-3 py-1 disabled:opacity-50"
        :disabled="saving"
        @click="save"
      >
        {{ saving ? `正在保存 ${completed}/${manifest?.files.length ?? 0}` : '保存离线资源' }}
      </button>
      <span v-if="manifest">约 {{ Math.ceil(manifest.bytes / 1048576) }} MB</span>
      <span v-if="!supported">此浏览器暂不支持离线保存；请使用 HTTPS 或本机访问。</span>
    </div>
    <p class="mt-1 text-xs">
      首次使用需加载资源。保存完成后可断网重开；浏览器清理数据会移除缓存和本地队伍，请在精灵仓库导出备份。
    </p>
    <p v-if="error" role="alert" class="mt-1 text-red-700">{{ error }}</p>
  </section>
</template>
