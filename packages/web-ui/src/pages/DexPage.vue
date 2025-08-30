<template>
  <div class="bg-white p-2 sm:p-3 flex flex-col h-full">
    <div class="flex flex-col h-full">
      <!-- 页面标题 -->
      <div class="text-center mb-4 sm:mb-6">
        <h1 class="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900">
          {{ i18next.t('dex.title', { ns: 'webui' }) }}
        </h1>
      </div>

      <!-- 导航标签 -->
      <DexNavigation v-model:activeTab="activeTab" />

      <!-- 搜索和筛选 (非属性克制表时显示) -->
      <DexSearch
        v-if="activeTab !== 'typeChart'"
        v-model:searchQuery="searchQuery"
        v-model:selectedElement="selectedElement"
        v-model:selectedCategory="selectedCategory"
        :active-tab="activeTab"
      />

      <!-- 内容区域 -->
      <div class="mt-4 sm:mt-6 flex-1 min-h-0">
        <!-- 属性克制表 -->
        <TypeChart v-if="activeTab === 'typeChart'" class="h-full" />

        <!-- 其他标签页的内容 -->
        <template v-else>
          <!-- 结果统计 -->
          <div class="mb-3 text-gray-600 text-xs">
            {{ i18next.t('dex.total', { ns: 'webui', count: filteredItems.length }) }}
          </div>

          <!-- 卡片网格 -->
          <div
            v-if="filteredItems.length > 0"
            class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3"
          >
            <DexCard
              v-for="item in paginatedItems"
              :key="item.id"
              :item="item"
              :type="activeTab"
              @click="handleItemClick"
            />
          </div>

          <!-- 无结果提示 -->
          <div v-else class="text-center py-8">
            <div class="text-gray-500 text-sm">
              {{ i18next.t('dex.noResults', { ns: 'webui' }) }}
            </div>
          </div>

          <!-- 分页 -->
          <div v-if="totalPages > 1" class="mt-4 flex justify-center">
            <el-pagination
              v-model:current-page="currentPage"
              :page-size="pageSize"
              :total="filteredItems.length"
              layout="prev, pager, next"
              class="dex-pagination"
            />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useGameDataStore } from '@/stores/gameData'
import { useTranslation } from 'i18next-vue'
import { Element } from '@arcadia-eternity/const'
import DexNavigation from '@/components/dex/DexNavigation.vue'
import DexSearch from '@/components/dex/DexSearch.vue'
import DexCard from '@/components/dex/DexCard.vue'
import TypeChart from '@/components/dex/TypeChart.vue'

const { i18next } = useTranslation()
const router = useRouter()
const gameDataStore = useGameDataStore()

// 响应式数据
const activeTab = ref<'species' | 'skills' | 'marks' | 'typeChart'>('species')
const searchQuery = ref('')
const selectedElement = ref<Element | 'all'>('all')
const selectedCategory = ref<string>('all')
const currentPage = ref(1)
const pageSize = 20

// 计算属性
const allItems = computed(() => {
  switch (activeTab.value) {
    case 'species':
      return Object.values(gameDataStore.species.byId)
    case 'skills':
      return Object.values(gameDataStore.skills.byId)
    case 'marks':
      return Object.values(gameDataStore.marks.byId)
    case 'typeChart':
      return [] // 属性克制表不需要列表项
    default:
      return []
  }
})

const filteredItems = computed(() => {
  let items = allItems.value

  // 搜索过滤
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase().trim()
    items = items.filter(item => {
      const name = getItemName(item).toLowerCase()
      const id = item.id.toLowerCase()
      return name.includes(query) || id.includes(query)
    })
  }

  // 属性过滤（仅对精灵和技能有效）
  if (selectedElement.value !== 'all' && (activeTab.value === 'species' || activeTab.value === 'skills')) {
    items = items.filter(item => 'element' in item && item.element === selectedElement.value)
  }

  // 分类过滤（仅对技能有效）
  if (selectedCategory.value !== 'all' && activeTab.value === 'skills') {
    items = items.filter(item => 'category' in item && item.category === selectedCategory.value)
  }

  return items
})

const totalPages = computed(() => Math.ceil(filteredItems.value.length / pageSize))

const paginatedItems = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  const end = start + pageSize
  return filteredItems.value.slice(start, end)
})

// 方法
function getItemName(item: any): string {
  try {
    switch (activeTab.value) {
      case 'species':
        return i18next.t(`${item.id}.name`, { ns: 'species' }) || item.id
      case 'skills':
        return i18next.t(`${item.id}.name`, { ns: 'skill' }) || item.id
      case 'marks':
        return (
          i18next.t(`${item.id}.name`, {
            ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
          }) || item.id
        )
      default:
        return item.id
    }
  } catch {
    return item.id
  }
}

function handleItemClick(item: any) {
  if (activeTab.value === 'typeChart') {
    // 属性克制表直接跳转到专门页面
    router.push({ name: 'TypeChart' })
    return
  }

  // 正确的路由名称映射
  const routeNameMap: Record<string, string> = {
    species: 'SpeciesDetail',
    skills: 'SkillDetail',
    marks: 'MarkDetail',
  }

  const routeName = routeNameMap[activeTab.value]
  if (routeName) {
    router.push({
      name: routeName,
      params: { id: item.id },
    })
  }
}

// 监听标签切换，重置分页
watch(activeTab, () => {
  currentPage.value = 1
  searchQuery.value = ''
  selectedElement.value = 'all'
  selectedCategory.value = 'all'
})

// 监听搜索和筛选，重置分页
watch([searchQuery, selectedElement, selectedCategory], () => {
  currentPage.value = 1
})

// 初始化
onMounted(async () => {
  if (!gameDataStore.loaded) {
    await gameDataStore.initialize()
  }
})
</script>

<style scoped>
:deep(.dex-pagination) {
  --el-color-primary: #3b82f6;
}

:deep(.dex-pagination .el-pager li) {
  background-color: #f9fafb;
  color: #374151;
  border: 1px solid #d1d5db;
}

:deep(.dex-pagination .el-pager li:hover) {
  background-color: #e5e7eb;
}

:deep(.dex-pagination .el-pager li.is-active) {
  background-color: #3b82f6;
  color: white;
}

:deep(.dex-pagination .btn-prev),
:deep(.dex-pagination .btn-next) {
  background-color: #f9fafb;
  color: #374151;
  border: 1px solid #d1d5db;
}

:deep(.dex-pagination .btn-prev:hover),
:deep(.dex-pagination .btn-next:hover) {
  background-color: #e5e7eb;
}
</style>
