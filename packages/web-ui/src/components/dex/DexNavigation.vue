<template>
  <div class="flex justify-center mb-6">
    <div class="bg-slate-800/50 backdrop-blur-sm rounded-lg p-1 border border-slate-700">
      <div class="flex space-x-1">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          :class="[
            'px-6 py-3 rounded-md font-medium transition-all duration-200',
            'flex items-center space-x-2',
            activeTab === tab.key
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
              : 'text-gray-300 hover:text-white hover:bg-slate-700/50',
          ]"
          @click="$emit('update:activeTab', tab.key)"
        >
          <component :is="tab.icon" class="w-5 h-5" />
          <span>{{ tab.label }}</span>
          <span class="text-xs opacity-75 bg-slate-600 px-2 py-0.5 rounded-full">
            {{ tab.count }}
          </span>
        </button>
      </div>
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
