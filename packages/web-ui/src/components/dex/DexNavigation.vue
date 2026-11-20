<template>
  <div class="mb-4 overflow-x-auto">
    <ElRadioGroup :model-value="activeTab" aria-label="图鉴分类" class="flex-nowrap!" @update:model-value="choose">
      <ElRadioButton v-for="tab in tabs" :key="tab.key" :value="tab.key">
        <span class="inline-flex items-center gap-1.5"
          ><component :is="tab.icon" class="size-4" />{{ tab.label }} ({{ tab.count }})</span
        >
      </ElRadioButton>
    </ElRadioGroup>
  </div>
</template>
<script setup lang="ts">
import { ElRadioButton, ElRadioGroup } from 'element-plus'
import { computed } from 'vue'
import { useGameDataStore } from '@/stores/gameData'
import { useTranslation } from 'i18next-vue'
import { UserIcon, BoltIcon, ShieldCheckIcon, TableCellsIcon } from '@heroicons/vue/24/outline'

const { i18next } = useTranslation()
const gameDataStore = useGameDataStore()

defineProps<{
  activeTab: 'species' | 'skills' | 'marks' | 'typeChart'
}>()

const emit = defineEmits<{
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
    count: gameDataStore.elementCatalog.elements.length,
  },
])
function choose(value: string | number | boolean | undefined) {
  const tab = tabs.value.find(item => item.key === value)
  if (tab) emit('update:activeTab', tab.key)
}
</script>
