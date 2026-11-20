<script setup lang="ts">
import { ElCard } from 'element-plus'
defineProps<{ heading: string }>()
</script>

<template>
  <ElCard class="environment-panel" shadow="never">
    <template #header>
      <header class="panel-heading">
        <h2>{{ heading }}</h2>
        <div v-if="$slots.tools" class="panel-tools"><slot name="tools" /></div>
      </header>
    </template>
    <slot />
  </ElCard>
</template>

<style scoped>
.environment-panel {
  min-width: 0;
  --el-card-border-radius: 12px;
  --el-card-padding: clamp(14px, 2vw, 24px);
}
.environment-panel :deep(.el-card__header) {
  padding-block: 14px;
}
.panel-heading,
.panel-tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.panel-heading {
  justify-content: space-between;
}
.panel-heading h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.panel-tools :deep(.el-button) {
  margin: 0;
}
</style>
