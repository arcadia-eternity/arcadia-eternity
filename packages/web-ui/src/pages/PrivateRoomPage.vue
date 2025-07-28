<template>
  <div class="private-room-container">
    <!-- 加载状态 -->
    <div v-if="privateRoomStore.isLoading" class="loading-container">
      <el-icon class="is-loading"><Loading /></el-icon>
      <p>加载中...</p>
    </div>

    <!-- 错误状态 -->
    <el-alert
      v-if="privateRoomStore.error"
      :title="privateRoomStore.error"
      type="error"
      show-icon
      :closable="false"
      class="error-alert"
    />

    <!-- 房间内容 -->
    <div v-if="privateRoomStore.currentRoom && !privateRoomStore.isLoading" class="room-content">
      <!-- 房间头部信息 -->
      <div class="room-header">
        <div class="room-title">
          <h1>房间 {{ privateRoomStore.currentRoom.config.roomCode }}</h1>
          <div class="room-status">
            <el-tag :type="getStatusTagType(privateRoomStore.currentRoom.status)">
              {{ getStatusText(privateRoomStore.currentRoom.status) }}
            </el-tag>
          </div>
        </div>

        <!-- 战斗结果显示 -->
        <div v-if="privateRoomStore.currentRoom.lastBattleResult" class="battle-result">
          <el-card class="result-card">
            <template #header>
              <div class="result-header">
                <el-icon><Trophy /></el-icon>
                <span>上一局战斗结果</span>
              </div>
            </template>
            <div class="result-content">
              <div class="winner-info">
                <span v-if="privateRoomStore.currentRoom.lastBattleResult.winner" class="winner">
                  🏆 胜利者: {{ getPlayerName(privateRoomStore.currentRoom.lastBattleResult.winner) }}
                </span>
                <span v-else class="draw">🤝 平局</span>
              </div>
              <div class="result-reason">
                {{ privateRoomStore.currentRoom.lastBattleResult.reason }}
              </div>
              <div class="result-time">
                {{ formatTime(privateRoomStore.currentRoom.lastBattleResult.endedAt) }}
              </div>
            </div>
          </el-card>
        </div>

        <div class="room-info">
          <el-tag>{{ getRuleSetName(privateRoomStore.currentRoom.config.ruleSetId) }}</el-tag>
          <el-tag type="info">房主: {{ getHostPlayerName() }}</el-tag>
          <el-button type="primary" size="small" @click="copyRoomCode"> 复制房间码 </el-button>
        </div>
      </div>

      <!-- 玩家区域 -->
      <div class="players-section">
        <h3>玩家 ({{ privateRoomStore.players.length }}/{{ privateRoomStore.currentRoom.config.maxPlayers }})</h3>

        <div class="player-slots">
          <div v-for="player in privateRoomStore.players" :key="player.playerId" class="player-slot filled">
            <PlayerCard
              :player="player"
              :isHost="player.playerId === privateRoomStore.currentRoom.config.hostPlayerId"
              :isReady="player.isReady"
              :isCurrentPlayer="player.playerId === playerStore.player.id"
            />
          </div>

          <div
            v-for="i in privateRoomStore.currentRoom.config.maxPlayers - privateRoomStore.players.length"
            :key="`empty-${i}`"
            class="player-slot empty"
          >
            <div class="waiting-indicator">
              <el-icon><User /></el-icon>
              <span>等待玩家加入...</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 房间控制 -->
      <div class="room-controls">
        <!-- 房主控制按钮 -->
        <template v-if="privateRoomStore.isHost">
          <!-- 等待状态：可以开始战斗 -->
          <el-button
            v-if="privateRoomStore.currentRoom?.status === 'waiting' && privateRoomStore.canStartBattle"
            type="primary"
            :disabled="privateRoomStore.isLoading"
            @click="startBattle"
          >
            开始对战
          </el-button>

          <!-- 等待状态：等待玩家准备 -->
          <el-button v-else-if="privateRoomStore.currentRoom?.status === 'waiting'" type="primary" disabled>
            等待玩家准备
          </el-button>

          <!-- 战斗结束状态：可以再来一局 -->
          <el-button
            v-else-if="privateRoomStore.currentRoom?.status === 'finished'"
            type="success"
            :disabled="privateRoomStore.isLoading"
            @click="resetRoom"
          >
            再来一局
          </el-button>

          <!-- 战斗进行中状态 -->
          <el-button v-else-if="privateRoomStore.currentRoom?.status === 'started'" type="info" disabled>
            战斗进行中
          </el-button>
        </template>

        <!-- 玩家准备按钮 -->
        <el-button
          v-if="
            !privateRoomStore.isHost && privateRoomStore.isPlayer && privateRoomStore.currentRoom?.status === 'waiting'
          "
          :type="privateRoomStore.myReadyStatus ? 'success' : 'primary'"
          :disabled="privateRoomStore.isLoading"
          @click="toggleReady"
        >
          {{ privateRoomStore.myReadyStatus ? '取消准备' : '准备' }}
        </el-button>

        <!-- 角色转换按钮 -->
        <template v-if="privateRoomStore.currentRoom?.status === 'waiting'">
          <!-- 玩家转观战者 -->
          <el-dropdown
            v-if="!privateRoomStore.isHost && privateRoomStore.isPlayer"
            @command="switchToSpectator"
            :disabled="privateRoomStore.isLoading"
          >
            <el-button type="info" :disabled="privateRoomStore.isLoading">
              转为观战者
              <el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="god">上帝视角</el-dropdown-item>
                <el-dropdown-item command="player1">玩家1视角</el-dropdown-item>
                <el-dropdown-item command="player2">玩家2视角</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>

          <!-- 观战者转玩家 -->
          <el-button
            v-if="privateRoomStore.isSpectator && privateRoomStore.players.length < 2"
            type="warning"
            :disabled="privateRoomStore.isLoading"
            @click="showSwitchToPlayerDialog"
          >
            转为玩家
          </el-button>
        </template>

        <!-- 离开房间按钮 -->
        <el-button :disabled="privateRoomStore.isLoading" @click="leaveRoom">
          {{ privateRoomStore.isHost ? '解散房间' : '离开房间' }}
        </el-button>
      </div>

      <!-- 观战者区域 -->
      <div v-if="privateRoomStore.currentRoom.config.allowSpectators" class="spectators-section">
        <h3>
          观战者 ({{ privateRoomStore.spectators.length }}/{{ privateRoomStore.currentRoom.config.maxSpectators }})
        </h3>

        <div v-if="privateRoomStore.spectators.length > 0" class="spectator-list">
          <div v-for="spectator in privateRoomStore.spectators" :key="spectator.playerId" class="spectator-item">
            <el-avatar :size="32">{{ spectator.playerName.charAt(0) }}</el-avatar>
            <span class="spectator-name">{{ spectator.playerName }}</span>
            <el-tag v-if="spectator.preferredView" size="small">
              {{ getViewModeText(spectator.preferredView) }}
            </el-tag>
          </div>
        </div>

        <div v-else class="no-spectators">
          <p>暂无观战者</p>
        </div>
      </div>
    </div>

    <!-- 转为玩家对话框 -->
    <el-dialog v-model="switchToPlayerDialogVisible" title="转为玩家" width="500px">
      <div class="switch-dialog-content">
        <p>转为玩家需要选择你的队伍。请确保你已经准备好参与战斗。</p>

        <div class="team-selection">
          <h4>选择队伍：</h4>
          <el-alert
            title="提示"
            description="这里应该集成队伍选择组件，目前使用默认队伍"
            type="info"
            show-icon
            :closable="false"
          />
        </div>
      </div>

      <template #footer>
        <div class="dialog-footer">
          <el-button @click="switchToPlayerDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="confirmSwitchToPlayer" :loading="privateRoomStore.isLoading">
            确认转为玩家
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePrivateRoomStore } from '@/stores/privateRoom'
import { usePlayerStore } from '@/stores/player'
import { useValidationStore } from '@/stores/validation'
import { User, Loading, ArrowDown } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import PlayerCard from '@/components/PlayerCard.vue'

const route = useRoute()
const router = useRouter()
const privateRoomStore = usePrivateRoomStore()
const playerStore = usePlayerStore()
const validationStore = useValidationStore()

const roomCode = route.params.roomCode as string

// 响应式变量
const switchToPlayerDialogVisible = ref(false)

// 计算属性
const getRuleSetName = (ruleSetId: string): string => {
  return validationStore.getRuleSetName(ruleSetId)
}

const getHostPlayerName = (): string => {
  if (!privateRoomStore.currentRoom) return ''
  const hostPlayer = privateRoomStore.players.find(
    p => p.playerId === privateRoomStore.currentRoom?.config.hostPlayerId,
  )
  return hostPlayer?.playerName || '未知'
}

const getStatusText = (status: string): string => {
  switch (status) {
    case 'waiting':
      return '等待中'
    case 'ready':
      return '准备就绪'
    case 'started':
      return '战斗中'
    case 'finished':
      return '战斗结束'
    case 'ended':
      return '已结束'
    default:
      return status
  }
}

const getStatusTagType = (status: string): 'primary' | 'success' | 'warning' | 'info' | 'danger' => {
  switch (status) {
    case 'waiting':
      return 'info'
    case 'ready':
      return 'success'
    case 'started':
      return 'warning'
    case 'finished':
      return 'primary'
    case 'ended':
      return 'danger'
    default:
      return 'info'
  }
}

const getViewModeText = (viewMode: string): string => {
  switch (viewMode) {
    case 'player1':
      return '玩家1视角'
    case 'player2':
      return '玩家2视角'
    case 'god':
      return '上帝视角'
    case 'free':
      return '自由视角'
    default:
      return viewMode
  }
}

const getPlayerName = (playerId: string): string => {
  const player = privateRoomStore.players.find(p => p.playerId === playerId)
  return player?.playerName || playerId
}

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// 方法
const copyRoomCode = async () => {
  try {
    await navigator.clipboard.writeText(roomCode)
    ElMessage.success('房间码已复制到剪贴板')
  } catch (error) {
    ElMessage.error('复制失败，请手动复制房间码')
  }
}

const toggleReady = async () => {
  try {
    await privateRoomStore.toggleReady()
    ElMessage.success(privateRoomStore.myReadyStatus ? '已准备' : '已取消准备')
  } catch (error) {
    ElMessage.error('操作失败: ' + (error as Error).message)
  }
}

const startBattle = async () => {
  try {
    await privateRoomStore.startBattle()
    ElMessage.success('战斗已开始')
  } catch (error) {
    ElMessage.error('开始战斗失败: ' + (error as Error).message)
  }
}

const resetRoom = async () => {
  try {
    await privateRoomStore.resetRoom()
    ElMessage.success('房间已重置，可以开始新的战斗')
  } catch (error) {
    ElMessage.error('重置房间失败: ' + (error as Error).message)
  }
}

const leaveRoom = async () => {
  try {
    await privateRoomStore.leaveRoom()
    ElMessage.success('已离开房间')
    router.push('/')
  } catch (error) {
    ElMessage.error('离开房间失败: ' + (error as Error).message)
  }
}

// 角色转换方法
const switchToSpectator = async (preferredView: 'player1' | 'player2' | 'god') => {
  try {
    await privateRoomStore.switchToSpectator(preferredView)
    ElMessage.success(`已转为观战者 (${getViewModeText(preferredView)})`)
  } catch (error) {
    ElMessage.error('转换为观战者失败: ' + (error as Error).message)
  }
}

const showSwitchToPlayerDialog = () => {
  switchToPlayerDialogVisible.value = true
}

const confirmSwitchToPlayer = async () => {
  try {
    // 这里应该使用用户选择的队伍，目前使用默认队伍
    const defaultTeam = playerStore.player?.team || []

    if (defaultTeam.length === 0) {
      ElMessage.error('请先设置你的队伍')
      return
    }

    await privateRoomStore.switchToPlayer(defaultTeam)
    switchToPlayerDialogVisible.value = false
    ElMessage.success('已转为玩家')
  } catch (error) {
    ElMessage.error('转换为玩家失败: ' + (error as Error).message)
  }
}

// 生命周期
onMounted(async () => {
  if (!roomCode) {
    ElMessage.error('房间码无效')
    router.push('/')
    return
  }

  try {
    // 获取房间信息
    await privateRoomStore.getRoomInfo(roomCode)
  } catch (error) {
    ElMessage.error('获取房间信息失败: ' + (error as Error).message)
    router.push('/')
  }
})

onUnmounted(() => {
  privateRoomStore.cleanup()
})
</script>

<style scoped>
.private-room-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
  min-height: 100vh;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 50vh;
  gap: 1rem;
}

.error-alert {
  margin-bottom: 2rem;
}

.room-content {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.room-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  background: var(--el-bg-color-page);
  border-radius: 8px;
  border: 1px solid var(--el-border-color);
}

.room-title {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.room-title h1 {
  margin: 0;
  font-size: 1.5rem;
  color: var(--el-text-color-primary);
}

.room-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.players-section {
  padding: 1.5rem;
  background: var(--el-bg-color-page);
  border-radius: 8px;
  border: 1px solid var(--el-border-color);
}

.players-section h3 {
  margin: 0 0 1rem 0;
  color: var(--el-text-color-primary);
}

.player-slots {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1rem;
}

.player-slot {
  padding: 1rem;
  border-radius: 8px;
  border: 2px solid var(--el-border-color);
  transition: all 0.3s ease;
}

.player-slot.filled {
  background: var(--el-bg-color);
  border-color: var(--el-color-primary);
}

.player-slot.empty {
  background: var(--el-fill-color-light);
  border-style: dashed;
}

.waiting-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  color: var(--el-text-color-placeholder);
  min-height: 80px;
}

.room-controls {
  display: flex;
  justify-content: center;
  gap: 1rem;
  padding: 1.5rem;
  background: var(--el-bg-color-page);
  border-radius: 8px;
  border: 1px solid var(--el-border-color);
}

.battle-result {
  margin: 1.5rem 0;
}

.result-card {
  border: 2px solid #e6f7ff;
  background: linear-gradient(135deg, #f6ffed 0%, #e6f7ff 100%);
}

.result-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: bold;
  color: #1890ff;
}

.result-content {
  text-align: center;
}

.winner-info {
  font-size: 1.2rem;
  font-weight: bold;
  margin-bottom: 0.5rem;
}

.winner {
  color: #52c41a;
}

.draw {
  color: #faad14;
}

.result-reason {
  color: #666;
  margin-bottom: 0.5rem;
}

.result-time {
  font-size: 0.9rem;
  color: #999;
}

.switch-dialog-content {
  padding: 1rem 0;
}

.team-selection {
  margin-top: 1rem;
}

.team-selection h4 {
  margin-bottom: 0.5rem;
  color: #333;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.spectators-section {
  padding: 1.5rem;
  background: var(--el-bg-color-page);
  border-radius: 8px;
  border: 1px solid var(--el-border-color);
}

.spectators-section h3 {
  margin: 0 0 1rem 0;
  color: var(--el-text-color-primary);
}

.spectator-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.spectator-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem;
  background: var(--el-bg-color);
  border-radius: 6px;
}

.spectator-name {
  flex: 1;
  color: var(--el-text-color-primary);
}

.no-spectators {
  text-align: center;
  color: var(--el-text-color-placeholder);
  padding: 2rem;
}

@media (max-width: 768px) {
  .private-room-container {
    padding: 1rem;
  }

  .room-header {
    flex-direction: column;
    gap: 1rem;
    align-items: stretch;
  }

  .room-info {
    justify-content: center;
  }

  .player-slots {
    grid-template-columns: 1fr;
  }

  .room-controls {
    flex-direction: column;
  }
}
</style>
