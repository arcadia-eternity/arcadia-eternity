<template>
  <div class="auth-status">
    <div class="status-display">
      <el-tag :type="authStore.isAccount ? 'success' : 'info'" size="small">
        {{ statusText }}
      </el-tag>
      <span class="player-name">{{ playerStore.name }}</span>
    </div>

    <router-link to="/account">
      <el-button size="small">档案与账号</el-button>
    </router-link>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePlayerStore } from '@/stores/player'
import { useAuthStore } from '@/stores/auth'

const playerStore = usePlayerStore()
const authStore = useAuthStore()
const statusText = computed(() => {
  if (!authStore.isAuthenticated) return '本地档案'
  return authStore.isAccount ? '服务器账号' : '游客会话'
})
</script>

<style scoped>
.auth-status {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--el-bg-color-page);
  border-radius: 6px;
  border: 1px solid var(--el-border-color-light);
}

.status-display {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.player-name {
  overflow-wrap: anywhere;
  font-weight: 500;
  color: var(--el-text-color-primary);
}

@media (max-width: 768px) {
  .auth-status {
    flex-wrap: wrap;
  }
}
</style>
