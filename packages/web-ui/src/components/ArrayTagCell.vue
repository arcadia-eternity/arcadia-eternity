<template>
  <div class="array-tag-container">
    <!-- 空状态提示 -->
    <span v-if="!items?.length" class="text-gray-400 text-xs">空数组</span>

    <!-- 基础类型标签 -->
    <template v-else>
      <el-tag
        v-for="(item, index) in items"
        :key="index"
        :type="tagType"
        size="small"
        class="m-0.5 max-w-full"
        :closable="closable"
        @close="$emit('remove', index)"
      >
        <!-- 字符串截断处理 -->
        <span class="truncate">
          {{ formatItem(item) }}
        </span>
      </el-tag>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ElTag } from 'element-plus'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    items?: Array<string | number | boolean | object> // 支持的数组元素类型
    maxDisplay?: number // 最多显示数量（超出显示+N）
    tagType?: '' | 'success' | 'info' | 'warning' | 'danger' // 标签类型
    closable?: boolean // 是否可删除
    showAll?: boolean // 强制显示全部元素
  }>(),
  {
    maxDisplay: 5,
    tagType: '',
    closable: false,
    showAll: false,
  },
)

const emit = defineEmits(['remove'])

// 格式化显示内容
const formatItem = (item: unknown) => {
  if (typeof item === 'object') {
    try {
      return JSON.stringify(item)
    } catch {
      return '[复杂对象]'
    }
  }
  return String(item)
}

// 计算实际显示项（性能优化）
const displayItems = computed(() => {
  if (props.showAll) return props.items
  return props.items?.slice(0, props.maxDisplay) || []
})

// 计算隐藏项数量
const hiddenCount = computed(() => {
  if (!props.items) return 0
  return Math.max(props.items.length - props.maxDisplay, 0)
})
</script>

<style scoped>
.array-tag-container {
  @apply flex flex-wrap items-center gap-1;
  min-height: 28px; /* 保持单元格最小高度 */
  max-height: 120px; /* 防止数组过大时撑开表格 */
  overflow-y: auto;
}

/* 滚动条样式 */
.array-tag-container::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
.array-tag-container::-webkit-scrollbar-thumb {
  @apply bg-gray-300 rounded-full;
}

.truncate {
  max-width: 150px; /* 根据列宽调整 */
  @apply overflow-hidden text-ellipsis whitespace-nowrap;
}
</style>
