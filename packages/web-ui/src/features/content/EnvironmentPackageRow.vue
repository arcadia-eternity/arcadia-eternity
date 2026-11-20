<script setup lang="ts">
import { Box } from '@element-plus/icons-vue'
import { ElIcon, ElTag } from 'element-plus'
defineProps<{ name: string; version?: string }>()
</script>

<template>
  <article class="package-entry">
    <div class="package-line">
      <ElIcon class="package-icon"><Box /></ElIcon>
      <strong>{{ name }}</strong>
      <ElTag v-if="version" type="info" effect="plain" size="small">{{ version }}</ElTag>
    </div>
    <div v-if="$slots.default" class="package-meta"><slot /></div>
    <div v-if="$slots.actions" class="package-actions"><slot name="actions" /></div>
  </article>
</template>

<style scoped>
.package-entry {
  border-top: 1px solid var(--el-border-color-lighter);
  padding: 12px 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.package-line,
.package-meta,
.package-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
}
.package-line strong {
  font-size: 14px;
  font-weight: 550;
}
.package-icon {
  color: var(--el-text-color-secondary);
}
.package-meta {
  margin-top: 5px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.package-actions:not(:empty) {
  margin-top: 8px;
}
@media (min-width: 1000px) {
  .package-entry {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: 16px;
  }
  .package-meta {
    grid-column: 1;
  }
  .package-actions:not(:empty) {
    grid-column: 2;
    grid-row: 1 / 3;
    align-self: center;
    justify-content: flex-end;
    margin-top: 0;
    max-width: 340px;
  }
}
.package-actions :deep(.el-button) {
  margin: 0;
}
</style>
