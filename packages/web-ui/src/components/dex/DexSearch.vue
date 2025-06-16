<template>
  <div class="bg-slate-800/30 backdrop-blur-sm rounded-lg p-6 border border-slate-700">
    <div class="flex flex-col lg:flex-row gap-4">
      <!-- 搜索框 -->
      <div class="flex-1">
        <div class="relative">
          <MagnifyingGlassIcon class="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            :value="searchQuery"
            @input="$emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
            type="text"
            :placeholder="i18next.t('dex.searchPlaceholder', { ns: 'webui' })"
            class="w-full pl-10 pr-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      <!-- 属性筛选 -->
      <div v-if="activeTab === 'species' || activeTab === 'skills'" class="min-w-[200px]">
        <select
          :value="selectedElement"
          @change="handleElementChange"
          class="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="all">
            {{ i18next.t('dex.all', { ns: 'webui' }) }} {{ i18next.t('dex.element', { ns: 'webui' }) }}
          </option>
          <option v-for="element in elementOptions" :key="element" :value="element">
            {{ getElementName(element) }}
          </option>
        </select>
      </div>

      <!-- 分类筛选（仅技能） -->
      <div v-if="activeTab === 'skills'" class="min-w-[200px]">
        <select
          :value="selectedCategory"
          @change="$emit('update:selectedCategory', ($event.target as HTMLSelectElement).value)"
          class="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="all">
            {{ i18next.t('dex.all', { ns: 'webui' }) }} {{ i18next.t('dex.category', { ns: 'webui' }) }}
          </option>
          <option v-for="category in categoryOptions" :key="category" :value="category">
            {{ getCategoryName(category) }}
          </option>
        </select>
      </div>

      <!-- 清除筛选按钮 -->
      <button
        v-if="hasActiveFilters"
        @click="clearFilters"
        class="px-4 py-3 bg-red-600/20 hover:bg-red-600/30 border border-red-500/50 rounded-lg text-red-300 hover:text-red-200 transition-colors duration-200 flex items-center space-x-2"
      >
        <XMarkIcon class="w-4 h-4" />
        <span>清除</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTranslation } from 'i18next-vue'
import { Element, Category } from '@arcadia-eternity/const'
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/vue/24/outline'

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
const elementOptions = computed(() => Object.values(Element))

// 分类选项
const categoryOptions = computed(() => Object.values(Category))

// 是否有激活的筛选条件
const hasActiveFilters = computed(() => {
  return props.searchQuery.trim() !== '' || props.selectedElement !== 'all' || props.selectedCategory !== 'all'
})

// 处理属性选择变化
function handleElementChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  emit('update:selectedElement', value as Element | 'all')
}

// 获取属性名称
function getElementName(element: Element): string {
  try {
    return i18next.t(`element.${element}`, { ns: 'battle' }) || element
  } catch {
    return element
  }
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
