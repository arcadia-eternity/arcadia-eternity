<template>
  <div class="mb-4 flex flex-wrap items-center gap-2">
    <ElInput
      class="flex-1"
      style="min-width: min(100%, 14rem)"
      :model-value="searchQuery"
      clearable
      :prefix-icon="Search"
      :aria-label="i18next.t('dex.searchPlaceholder', { ns: 'webui' })"
      :placeholder="i18next.t('dex.searchPlaceholder', { ns: 'webui' })"
      @update:model-value="emit('update:searchQuery', $event)"
    />
    <ElSelect
      v-if="activeTab !== 'marks'"
      style="width: 10rem"
      filterable
      :model-value="selectedElement"
      :aria-label="i18next.t('dex.element', { ns: 'webui' })"
      @update:model-value="emit('update:selectedElement', $event)"
    >
      <ElOption
        value="all"
        :label="i18next.t('dex.all', { ns: 'webui' }) + ' ' + i18next.t('dex.element', { ns: 'webui' })"
      />
      <ElOption v-for="element in elementOptions" :key="element" :value="element" :label="getElementName(element)" />
    </ElSelect>
    <ElSelect
      v-if="activeTab === 'skills'"
      style="width: 10rem"
      :model-value="selectedCategory"
      :aria-label="i18next.t('dex.category', { ns: 'webui' })"
      @update:model-value="emit('update:selectedCategory', $event)"
    >
      <ElOption
        value="all"
        :label="i18next.t('dex.all', { ns: 'webui' }) + ' ' + i18next.t('dex.category', { ns: 'webui' })"
      />
      <ElOption
        v-for="category in categoryOptions"
        :key="category"
        :value="category"
        :label="getCategoryName(category)"
      />
    </ElSelect>
    <ElButton v-if="hasActiveFilters" @click="clearFilters">清除筛选</ElButton>
  </div>
</template>
<script setup lang="ts">
import { ElInput, ElButton, ElSelect, ElOption } from 'element-plus'
import { gameplayName } from '@/i18n/environment'
import { computed } from 'vue'
import { useTranslation } from 'i18next-vue'
import { useGameDataStore } from '@/stores/gameData'
import { type Element, Category } from '@arcadia-eternity/const'
import { Search } from '@element-plus/icons-vue'

const { i18next } = useTranslation()

const props = defineProps<{
  searchQuery: string
  selectedElement: Element | 'all'
  selectedCategory: string
  activeTab: 'species' | 'skills' | 'marks'
}>()

const emit = defineEmits<{
  'update:searchQuery': [value: string]
  'update:selectedElement': [value: Element | 'all']
  'update:selectedCategory': [value: string]
}>()

// 属性选项
const data = useGameDataStore()
const elementOptions = computed(() => data.elementCatalog.elements.map(row => row.id))

// 分类选项
const categoryOptions = computed(() => Object.values(Category))

// 是否有激活的筛选条件
const hasActiveFilters = computed(() => {
  return props.searchQuery.trim() !== '' || props.selectedElement !== 'all' || props.selectedCategory !== 'all'
})

// 获取属性名称
function getElementName(element: Element): string {
  return gameplayName('element', element, data.getElement(element)?.name)
}

// 获取分类名称
function getCategoryName(category: Category): string {
  try {
    return i18next.t(`category.${category}`, { ns: 'battle' }) || category
  } catch {
    return category
  }
}

// 清除所有筛选条件
function clearFilters() {
  emit('update:searchQuery', '')
  emit('update:selectedElement', 'all')
  emit('update:selectedCategory', 'all')
}
</script>
