<script setup lang="ts">
import { ElButton, ElMessage } from 'element-plus'
import { CopyDocument } from '@element-plus/icons-vue'

const props = defineProps<{ value: string }>()

async function copy() {
  try {
    await navigator.clipboard.writeText(props.value)
    ElMessage.success('已复制指纹')
  } catch {
    ElMessage.error('复制失败，请选中指纹后复制')
  }
}
</script>

<template>
  <details class="environment-fingerprint">
    <summary>
      指纹 <code>{{ value.slice(0, 8) }}</code>
    </summary>
    <div class="fingerprint-value">
      <code>{{ value }}</code>
      <ElButton :icon="CopyDocument" size="small" @click="copy">复制指纹</ElButton>
    </div>
  </details>
</template>

<style scoped>
.environment-fingerprint {
  flex-basis: 100%;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
summary {
  width: fit-content;
  cursor: pointer;
}
.fingerprint-value {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
code {
  color: var(--el-text-color-primary);
  overflow-wrap: anywhere;
  user-select: text;
}
</style>
