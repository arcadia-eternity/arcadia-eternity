<template>
  <div class="inline-array-editor">
    <!-- 编辑模式 -->
    <div v-if="isEditing" class="edit-mode">
      <el-select-v2
        ref="selectRef"
        v-model="tempValue"
        :options="virtualOptions"
        multiple
        filterable
        allow-create
        collapse-tags
        remote
        :remote-method="handleSearch"
        :loading="searchLoading"
        :popper-height="300"
        style="width: 100%"
        @blur="handleBlur"
        @keyup.enter="confirmEdit"
        @keyup.esc="cancelEdit"
      />
    </div>

    <!-- 展示模式 -->
    <div v-else class="view-mode" @click="startEdit">
      <div class="tags-wrapper">
        <span v-for="item in filteredItems" :key="item.id" class="tag-item" :style="tagStyle(item)">
          {{ item.name || item.id }}
          <el-icon class="remove-icon" @click.stop="removeItem(item.id)">
            <Close />
          </el-icon>
        </span>
        <span class="add-trigger">
          <el-icon><Plus /></el-icon>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useGameDataStore } from '@/stores/gameData'
import { ref, computed, nextTick } from 'vue'
import { useDebounceFn } from '@vueuse/core'

const props = defineProps<{
  modelValue: string[]
  type: 'ability' | 'emblem' | 'effect'
}>()

const emit = defineEmits(['update:modelValue'])

const gameData = useGameDataStore()
const isEditing = ref(false)
const selectRef = ref()
const tempValue = ref(props.modelValue ? [...props.modelValue] : [])

// 获取对应数据源
const dataSource = computed(() => {
  if (props.type != 'effect') return gameData.marks.byId
  return gameData.effects.byId
})

const searchLoading = ref(false)
const cachedOptions = ref(new Map())
const filteredOptions = ref<any[]>([])

// 建立搜索索引
const searchIndex = computed(() => {
  return Object.values(dataSource.value).map(item => ({
    id: item.id.toLowerCase(),
    name: (item.name || '').toLowerCase(),
    original: item,
  }))
})

const itemLabel = (item: { id: string; name?: string }) => {
  return item.name ? `${item.name} (${item.id})` : item.id
}

const virtualOptions = computed(() => {
  const baseOptions = filteredOptions.value.map(item => ({
    value: item.id,
    label: itemLabel(item),
    raw: item,
  }))

  // 包含自定义创建项
  const customItems = tempValue.value
    .filter(id => !dataSource.value[id])
    .map(id => ({
      value: id,
      label: id,
      raw: { id, name: id },
    }))

  return [...new Map([...baseOptions, ...customItems].map(item => [item.value, item])).values()]
})

const handleSearch = useDebounceFn(async (query: string) => {
  searchLoading.value = true
  const cacheKey = query.toLowerCase()

  if (cachedOptions.value.has(cacheKey)) {
    filteredOptions.value = cachedOptions.value.get(cacheKey)
    searchLoading.value = false
    return
  }

  const results = await performSearch(query)
  cachedOptions.value.set(cacheKey, results.slice(0, 100))
  filteredOptions.value = results
  searchLoading.value = false
}, 300)

// 实际搜索逻辑
const performSearch = async (query: string) => {
  const q = query.trim().toLowerCase()
  if (!q) return Object.values(dataSource.value).slice(0, 50)

  return searchIndex.value
    .filter(item => item.id.includes(q) || item.name.includes(q))
    .map(item => item.original)
    .slice(0, 100)
}

// 处理标签显示
const filteredItems = computed(() => {
  return props.modelValue
    ? props.modelValue.map(id => ({
        id,
        name: props.type == 'effect' ? id : dataSource.value[id]?.name || id,
      }))
    : []
})

// 启动编辑
const startEdit = async () => {
  isEditing.value = true
  tempValue.value = [...props.modelValue]
  await nextTick()
  selectRef.value?.focus()
}

// 确认修改
const confirmEdit = () => {
  emit('update:modelValue', [...new Set(tempValue.value)]) // 去重
  isEditing.value = false
}

// 取消修改
const cancelEdit = () => {
  isEditing.value = false
}

// 处理失去焦点
const handleBlur = () => {
  if (tempValue.value.join(',') !== props.modelValue.join(',')) {
    confirmEdit()
  } else {
    cancelEdit()
  }
}

// 删除单个项
const removeItem = (id: string) => {
  emit(
    'update:modelValue',
    props.modelValue.filter(item => item !== id),
  )
}

// 标签样式
const tagStyle = (item: any) => ({
  backgroundColor: dataSource.value[item.id] ? '#e8f4ff' : '#f0f0f0',
  borderColor: dataSource.value[item.id] ? '#409eff' : '#ddd',
})
</script>

<style scoped>
.inline-array-editor {
  position: relative;
  min-height: 32px;
  transition: all 0.2s;
}

.view-mode {
  cursor: pointer;
  padding: 2px;
}

.tags-wrapper {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.tag-item {
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  height: 24px;
  border-radius: 4px;
  border: 1px solid;
  font-size: 12px;
  transition: all 0.2s;
  position: relative;
}

.remove-icon {
  margin-left: 4px;
  font-size: 12px;
  color: #999;
  cursor: pointer;
}

.remove-icon:hover {
  color: #666;
}

.add-trigger {
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  color: #666;
  cursor: pointer;
  transition: all 0.2s;
}

.add-trigger:hover {
  color: #409eff;
}

.edit-mode {
  position: relative;
  min-width: 200px;
}

.el-select-v2__menu {
  --el-select-v2-item-height: 36px;
}

.el-select-v2__item {
  height: 36px;
  padding: 8px 12px;
}
</style>
