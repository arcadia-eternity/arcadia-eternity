<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useBattleStore } from '@/stores/battle'
const router = useRouter()
const battleStore = useBattleStore()
const returnToEditor = () => window.arcadiaAuthorPreview?.returnToEditor()
</script>
<template>
  <div class="h-screen flex flex-col">
    <header class="preview-header">
      <span
        >内容调试 <small>{{ router.currentRoute.value.name === 'Battle' ? '· 战斗与日志' : '· 测试队伍' }}</small></span
      >
      <div class="preview-actions">
        <button
          v-if="router.currentRoute.value.name === 'Battle'"
          type="button"
          @click="
            router.push({ name: 'AuthorPreview', query: { endpoint: router.currentRoute.value.query.authorPreview } })
          "
        >
          {{ battleStore.isBattleEnd ? '调整队伍' : '结束并调整队伍' }}
        </button>
        <button type="button" @click="returnToEditor">返回编辑器</button>
      </div>
    </header>
    <main class="flex-1 min-h-0 overflow-auto relative">
      <router-view v-slot="{ Component }"><component :is="Component" class="w-full" :key="$route.path" /></router-view>
    </main>
  </div>
</template>
<style scoped>
.preview-header {
  display: flex;
  flex: 0 0 3.75rem;
  align-items: center;
  justify-content: space-between;
  padding: 0 1.5rem;
  background: #09131f;
  color: #c9e9f7;
  border-bottom: 1px solid #294559;
}
.preview-actions {
  display: flex;
  gap: 10px;
}
.preview-header button {
  cursor: pointer;
  padding: 0.4rem 0.9rem;
  border: 1px solid #486477;
  border-radius: 0.4rem;
}
</style>
