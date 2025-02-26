<template>
  <el-popover placement="right" trigger="hover" :width="400">
    <template #reference>
      <div class="nested-cell">
        {{ previewText }}
      </div>
    </template>

    <div class="p-4">
      <el-descriptions :column="2" border>
        <el-descriptions-item v-for="(value, key) in data" :key="key" :label="key">
          {{ value }}
        </el-descriptions-item>
      </el-descriptions>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  data: Record<string, any>
}>()

const previewText = computed(() => {
  return Object.entries(props.data)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' | ')
})
</script>
