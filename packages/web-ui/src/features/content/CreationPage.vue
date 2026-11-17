<script setup lang="ts">
import ContentProjectsPanel from './ContentProjectsPanel.vue'
</script>
<template>
  <main class="creation-page">
    <h1>创作</h1>
    <ContentProjectsPanel />
  </main>
</template>
<style scoped>
.creation-page {
  height: 100%;
  min-height: 0;
  overflow: auto;
  color: var(--el-text-color-primary);
  background: var(--el-bg-color-page);
}
h1 {
  padding: 12px 20px;
  font-size: 22px;
  font-weight: 600;
}
</style>
