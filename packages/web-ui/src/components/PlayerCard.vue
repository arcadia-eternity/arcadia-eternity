<template>
  <div class="player-card" :class="{ 'is-host': isHost, 'is-current': isCurrentPlayer, 'is-ready': isReady }">
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
          <el-tag v-else type="warning" size="small">房主</el-tag>
        </div>
      </div>
    </div>

    <!-- 队伍信息已隐藏，保持神秘感 -->
    <div class="team-info">
      <div class="team-status">
        <span class="team-label">队伍状态</span>
        <span class="team-status-text">已准备队伍</span>
      </div>
    </div>

    <div class="join-time">加入时间: {{ formatJoinTime(player.joinedAt) }}</div>

    <!-- 转移房主按钮 -->
    <div v-if="canTransferHost" class="transfer-host-section">
      <el-button type="warning" size="small" :disabled="isLoading" @click="handleTransferHost">
        转移房主给此玩家
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PrivateRoomPlayer } from '@arcadia-eternity/protocol'

interface Props {
  player: PrivateRoomPlayer
  isHost: boolean
  isReady: boolean
  isCurrentPlayer: boolean
  canTransferHost?: boolean
  isLoading?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  transferHost: [playerId: string]
}>()

const handleTransferHost = () => {
  emit('transferHost', props.player.playerId)
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

.transfer-host-section {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--el-border-color-light);
}

.transfer-host-section .el-button {
  width: 100%;
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
