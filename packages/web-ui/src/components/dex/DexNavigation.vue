<template>
  <div class="mb-6 overflow-x-auto" style="touch-action: pan-x;">
    <div class="flex space-x-1 bg-gray-100 rounded-lg p-1 border border-gray-300 min-w-max">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        :class="[
          'px-4 sm:px-6 py-2 sm:py-3 rounded-md font-medium transition-all duration-200 text-sm sm:text-base',
          'flex items-center space-x-2 flex-shrink-0',
          activeTab === tab.key
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200',
        ]"
        @click="$emit('update:activeTab', tab.key)"
      >
        <component :is="tab.icon" class="w-5 h-5" />
        <span>{{ tab.label }}</span>
        <span class="text-xs opacity-75 bg-gray-500 text-white px-2 py-0.5 rounded-full">
          {{ tab.count }}
        </span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useGameDataStore } from '@/stores/gameData'
import { useTranslation } from 'i18next-vue'
import { UserIcon, BoltIcon, ShieldCheckIcon, TableCellsIcon } from '@heroicons/vue/24/outline'

const { i18next } = useTranslation()
const gameDataStore = useGameDataStore()

defineProps<{
  activeTab: 'species' | 'skills' | 'marks' | 'typeChart'
}>()

defineEmits<{
  'update:activeTab': [value: 'species' | 'skills' | 'marks' | 'typeChart']
}>()

const tabs = computed(() => [
  {
    key: 'species' as const,
    label: i18next.t('dex.species', { ns: 'webui' }),
    icon: UserIcon,
    count: gameDataStore.species.allIds.length,
  },
  {
    key: 'skills' as const,
    label: i18next.t('dex.skills', { ns: 'webui' }),
    icon: BoltIcon,
    count: gameDataStore.skills.allIds.length,
  },
  {
    key: 'marks' as const,
    label: i18next.t('dex.marks', { ns: 'webui' }),
    icon: ShieldCheckIcon,
    count: gameDataStore.marks.allIds.length,
  },
  {
    key: 'typeChart' as const,
    label: i18next.t('dex.typeChart', { ns: 'webui' }),
    icon: TableCellsIcon,
    count: 23, // 总属性数量
  },
])
</script>

<style scoped>
:deep(::-webkit-scrollbar) {
  height: 6px;
}

:deep(::-webkit-scrollbar-track) {
  background: #f1f1f1;
  border-radius: 3px;
}

:deep(::-webkit-scrollbar-thumb) {
  background: #c1c1c1;
  border-radius: 3px;
}

:deep(::-webkit-scrollbar-thumb:hover) {
  background: #a1a1a1;
}
</style>

