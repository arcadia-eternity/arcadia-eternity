<template>
  <div class="player-card" :class="{ 'is-host': isHost, 'is-current': isCurrentPlayer, 'is-ready': isReady }">
    <!-- 房主操作按钮 - 右上角 -->
    <div v-if="canTransferHost || canKick" class="host-actions-corner">
      <el-dropdown trigger="hover" placement="bottom-end">
        <el-button type="text" size="small" class="action-trigger">
          <el-icon><MoreFilled /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-if="canTransferHost" @click="handleTransferHost">
              <el-icon><Star /></el-icon>
              转移房主
            </el-dropdown-item>
            <el-dropdown-item v-if="canKick" @click="handleKickPlayer" class="danger-item">
              <el-icon><Close /></el-icon>
              踢出房间
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div class="player-header">
      <div class="player-avatar">
        <el-avatar :size="40">{{ player.playerName.charAt(0) }}</el-avatar>
      </div>

      <div class="player-info">
        <div class="player-name">
          {{ player.playerName }}
          <el-tag v-if="isHost" type="warning" size="small">房主</el-tag>
          <el-tag v-if="isCurrentPlayer" type="primary" size="small">我</el-tag>
        </div>

        <div class="player-status">
          <el-tag v-if="!isHost" :type="isReady ? 'success' : 'info'" size="small">
            {{ isReady ? '已准备' : '未准备' }}
          </el-tag>
        </div>
      </div>
    </div>

    <div class="join-time">加入时间: {{ formatJoinTime(player.joinedAt) }}</div>
  </div>
</template>

<script setup lang="ts">
import { MoreFilled, Star, Close } from '@element-plus/icons-vue'
import type { PrivateRoomPlayer } from '@arcadia-eternity/protocol'

interface Props {
  player: PrivateRoomPlayer
  isHost: boolean
  isReady: boolean
  isCurrentPlayer: boolean
  canTransferHost?: boolean
  canKick?: boolean
  isLoading?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  transferHost: [playerId: string]
  kickPlayer: [playerId: string]
}>()

const handleTransferHost = () => {
  emit('transferHost', props.player.playerId)
}

const handleKickPlayer = () => {
  emit('kickPlayer', props.player.playerId)
}

const formatJoinTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
</script>

<style scoped>
.player-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  background: var(--el-bg-color);
  border-radius: 8px;
  border: 2px solid var(--el-border-color);
  transition: all 0.3s ease;
}

.player-card.is-host {
  border-color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
}

.player-card.is-current {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.player-card.is-ready {
  border-color: var(--el-color-success);
}

.player-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.player-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.player-name {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.player-status {
  display: flex;
  align-items: center;
}

.team-info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.team-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.team-label {
  font-size: 0.875rem;
  color: var(--el-text-color-regular);
  font-weight: 500;
}

.team-count {
  font-size: 0.75rem;
  color: var(--el-text-color-placeholder);
}

.team-preview {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.pet-preview {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  font-size: 0.75rem;
}

.pet-avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--el-color-primary);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.625rem;
  font-weight: bold;
}

.pet-name {
  color: var(--el-text-color-regular);
  max-width: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.more-pets {
  padding: 0.25rem 0.5rem;
  background: var(--el-fill-color);
  border-radius: 4px;
  font-size: 0.75rem;
  color: var(--el-text-color-placeholder);
}

.no-team {
  padding: 1rem;
  text-align: center;
  background: var(--el-bg-color-page);
  border: 2px dashed var(--el-border-color);
  border-radius: 6px;
  margin-top: 0.5rem;
}

.no-team-text {
  color: var(--el-text-color-placeholder);
  font-style: italic;
  font-size: 0.9rem;
}

.join-time {
  font-size: 0.75rem;
  color: var(--el-text-color-placeholder);
  text-align: right;
}

.host-actions-corner {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  z-index: 10;
}

.action-trigger {
  padding: 4px !important;
  min-height: auto !important;
  border-radius: 50% !important;
  color: var(--el-text-color-regular) !important;
  background: var(--el-bg-color-overlay) !important;
  backdrop-filter: blur(4px);
  transition: all 0.2s ease;
}

.action-trigger:hover {
  background: var(--el-color-primary-light-9) !important;
  color: var(--el-color-primary) !important;
  transform: scale(1.1);
}

.danger-item {
  color: var(--el-color-danger);
}

.danger-item:hover {
  background: var(--el-color-danger-light-9);
}

@media (max-width: 768px) {
  .player-card {
    padding: 0.75rem;
  }

  .team-preview {
    gap: 0.25rem;
  }

  .pet-preview {
    padding: 0.125rem 0.25rem;
  }

  .pet-name {
    max-width: 40px;
  }
}
</style>
