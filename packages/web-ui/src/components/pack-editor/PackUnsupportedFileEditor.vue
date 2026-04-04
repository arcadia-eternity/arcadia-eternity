<template>
  <el-card shadow="never">
    <template #header>
      <div class="font-semibold">{{ titleText }}</div>
    </template>

    <el-alert
      type="warning"
      show-icon
      :closable="false"
      title="当前文件暂无可视化编辑器"
      description="该文件类型暂不支持在线编辑。你可以保留它在数据包中，或在外部编辑器修改。"
    />

    <div class="mt-4 rounded-md border bg-gray-50 p-3 text-sm text-gray-700">
      <div class="font-medium">文件路径</div>
      <div class="mt-1 break-all">{{ packFolder }}/{{ relativePath }}</div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  packFolder: string
  relativePath: string
  title?: string
}>()

const titleText = computed(() => {
  if (props.title && props.title.trim().length > 0) return props.title
  return `${props.packFolder}/${props.relativePath}`
})
</script>
