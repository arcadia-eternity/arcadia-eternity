<template>
  <div class="auth-status">
    <!-- 认证状态显示 -->
    <div class="status-display">
      <el-tag :type="statusTagType" :icon="statusIcon" size="small">
        {{ playerStore.authStatusText }}
      </el-tag>

      <span class="player-name">{{ playerStore.name }}</span>

      <el-tag v-if="playerStore.is_registered" type="success" size="small" class="ml-2"> 注册用户 </el-tag>

      <el-tag v-else type="info" size="small" class="ml-2"> 游客 </el-tag>
    </div>

    <!-- 操作按钮 -->
    <div class="actions">
      <!-- 注册用户需要恢复提示 -->
      <el-button
        v-if="playerStore.is_registered && !playerStore.isAuthenticated"
        type="warning"
        size="small"
        @click="showEmailDialog = true"
      >
        通过邮箱恢复
      </el-button>

      <!-- 登出按钮 -->
      <el-button
        v-if="playerStore.is_registered && playerStore.isAuthenticated"
        type="default"
        size="small"
        @click="handleLogout"
      >
        登出
      </el-button>

      <!-- 创建新游客按钮 -->
      <el-button v-if="!playerStore.is_registered" type="default" size="small" @click="handleCreateNewGuest">
        新游客
      </el-button>

      <!-- 邮箱继承按钮 -->
      <el-button type="success" size="small" @click="showEmailDialog = true">
        {{ playerStore.is_registered ? '邮箱管理' : '绑定邮箱' }}
      </el-button>
    </div>

    <!-- 邮箱继承对话框 -->
    <EmailInheritance v-model:visible="showEmailDialog" @player-upgraded="handlePlayerUpgraded" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { User, Lock, Unlock } from '@element-plus/icons-vue'
import { usePlayerStore } from '../../stores/player'
import EmailInheritance from '../EmailInheritance.vue'
import type { PlayerInfo } from '../../stores/auth'

const playerStore = usePlayerStore()

// 响应式状态
const showEmailDialog = ref(false)

// 计算属性
const statusTagType = computed(() => {
  if (!playerStore.isInitialized) return 'info'
  if (playerStore.is_registered) {
    return playerStore.isAuthenticated ? 'success' : 'warning'
  }
  return 'info'
})

const statusIcon = computed(() => {
  if (!playerStore.isInitialized) return User
  if (playerStore.is_registered) {
    return playerStore.isAuthenticated ? Unlock : Lock
  }
  return User
})

// 方法
const handleLogout = async () => {
  await playerStore.logout()
}

const handleCreateNewGuest = async () => {
  await playerStore.createNewGuest()
}

const handlePlayerUpgraded = (playerInfo: PlayerInfo) => {
  playerStore.upgradeToRegisteredUser(playerInfo)
  showEmailDialog.value = false
}

// 生命周期
onMounted(async () => {
  if (!playerStore.isInitialized) {
    await playerStore.initializePlayer()
  }
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
}

.player-name {
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ml-2 {
  margin-left: 8px;
}

@media (max-width: 768px) {
  .auth-status {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .status-display {
    justify-content: center;
  }

  .actions {
    justify-content: center;
  }
}
</style>
