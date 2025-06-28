<template>
  <button
    @click="handleDownload"
    :disabled="isLoading"
    class="download-button w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center"
  >
    <svg v-if="isLoading" class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    <svg v-else class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
    <div class="text-left">
      <div class="font-medium">{{ label }}</div>
      <div v-if="description" class="text-xs opacity-90">{{ description }}</div>
    </div>
  </button>
</template>

<script setup lang="ts">
import { ref } from 'vue'

interface Props {
  platform: string
  architecture: string
  format: string
  label: string
  description?: string
}

interface Emits {
  (e: 'download', platform: string, architecture: string, format: string): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const isLoading = ref(false)

const handleDownload = async () => {
  if (isLoading.value) return
  
  isLoading.value = true
  try {
    emit('download', props.platform, props.architecture, props.format)
  } finally {
    // 延迟重置加载状态，给用户视觉反馈
    setTimeout(() => {
      isLoading.value = false
    }, 1000)
  }
}
</script>

<style scoped>
.download-button {
  min-height: 3rem;
}

.download-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

.download-button:active:not(:disabled) {
  transform: translateY(0);
}
</style>
