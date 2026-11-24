<script setup lang="ts">
import { ElTag } from 'element-plus'
import EnvironmentFingerprint from './EnvironmentFingerprint.vue'
defineProps<{ name: string; readonly?: boolean; environmentVersion?: string }>()
</script>

<template>
  <header class="detail-heading">
    <div class="detail-title">
      <h3>{{ name }}</h3>
      <ElTag v-if="readonly" size="small" type="info" effect="plain">只读</ElTag>
      <slot name="status" />
    </div>
    <div v-if="$slots.default" class="detail-actions"><slot /></div>
    <EnvironmentFingerprint v-if="environmentVersion" :key="environmentVersion" :value="environmentVersion" />
  </header>
</template>

<style scoped>
.detail-heading,
.detail-title,
.detail-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.detail-heading {
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
}
.detail-title h3 {
  margin: 0;
  font-size: 21px;
  line-height: 1.35;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.detail-actions :deep(.el-button) {
  margin: 0;
}
</style>
