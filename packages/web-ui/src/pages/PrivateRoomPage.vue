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
          <strong v-if="privateRoomStore.currentRoom.lastBattleResult.winner" class="winner">
            🏆 胜利者: {{ getPlayerName(privateRoomStore.currentRoom.lastBattleResult.winner) }}
          </strong>
          <strong v-else class="draw">🤝 平局</strong>
          <span class="result-reason">{{ privateRoomStore.currentRoom.lastBattleResult.reason }}</span>
          <span class="result-time">{{ formatTime(privateRoomStore.currentRoom.lastBattleResult.endedAt) }}</span>
        </div>

        <div class="room-info">
          <el-tag>{{ getRuleSetName(privateRoomStore.currentRoom.config.ruleSetId) }}</el-tag>
          <el-tag type="info">房主: {{ getHostPlayerName() }}</el-tag>
          <el-button type="primary" size="small" @click="copyRoomCode"> 复制房间码 </el-button>
          <el-button type="primary" size="small" @click="copyRoomLink"> 复制链接 </el-button>
          <!-- 房主配置按钮 -->
          <el-button
            v-if="privateRoomStore.isHost && privateRoomStore.currentRoom?.status === 'waiting'"
            type="warning"
            size="small"
            @click="openRoomConfigDialog"
          >
            房间设置
          </el-button>
        </div>
      </div>

      <!-- Combined Players and Spectators Section -->
      <div class="participants-section">
        <!-- Players Section -->
        <div class="players-column">
          <div class="players-section">
            <h3>玩家 ({{ privateRoomStore.players.length }}/{{ privateRoomStore.currentRoom.config.maxPlayers }})</h3>

            <div class="player-slots">
              <div v-for="player in privateRoomStore.players" :key="player.playerId" class="player-slot filled">
                <PlayerCard
                  :player="player"
                  :isHost="player.playerId === privateRoomStore.currentRoom.config.hostPlayerId"
                  :isReady="player.isReady"
                  :isCurrentPlayer="player.playerId === playerStore.player.id"
                  :canTransferHost="
                    privateRoomStore.isHost &&
                    privateRoomStore.currentRoom?.status === 'waiting' &&
                    player.playerId !== privateRoomStore.currentRoom.config.hostPlayerId
                  "
                  :canKick="
                    privateRoomStore.isHost &&
                    privateRoomStore.currentRoom?.status === 'waiting' &&
                    player.playerId !== privateRoomStore.currentRoom.config.hostPlayerId &&
                    player.playerId !== playerStore.player.id
                  "
                  :isLoading="privateRoomStore.isLoading"
                  @transferHost="transferHost"
                  @kickPlayer="kickPlayer"
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
        </div>

        <!-- Spectators Section -->
        <div class="spectators-column">
          <div class="spectators-section">
            <h3>观战者 ({{ privateRoomStore.spectators.length }})</h3>

            <div v-if="privateRoomStore.spectators.length > 0" class="spectator-list">
              <div v-for="spectator in privateRoomStore.spectators" :key="spectator.playerId" class="spectator-item">
                <!-- 房主操作按钮 - 右上角 -->
                <div
                  v-if="
                    privateRoomStore.isHost &&
                    privateRoomStore.currentRoom?.status === 'waiting' &&
                    spectator.playerId !== privateRoomStore.currentRoom?.config.hostPlayerId &&
                    spectator.playerId !== playerStore.player.id
                  "
                  class="spectator-actions-corner"
                >
                  <el-dropdown trigger="hover" placement="bottom-end">
                    <el-button type="text" size="small" class="spectator-action-trigger">
                      <el-icon><MoreFilled /></el-icon>
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item @click="transferHost(spectator.playerId)">
                          <el-icon><Star /></el-icon>
                          转移房主
                        </el-dropdown-item>
                        <el-dropdown-item @click="kickPlayer(spectator.playerId)" class="danger-item">
                          <el-icon><Close /></el-icon>
                          踢出房间
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>

                <div class="spectator-info">
                  <el-avatar :size="32">{{ spectator.playerName.charAt(0) }}</el-avatar>
                  <div class="spectator-details">
                    <div class="spectator-name-row">
                      <span class="spectator-name">{{ spectator.playerName }}</span>
                      <el-tag
                        v-if="spectator.playerId === privateRoomStore.currentRoom?.config.hostPlayerId"
                        type="warning"
                        size="small"
                        >房主</el-tag
                      >
                      <el-tag v-if="spectator.playerId === playerStore.player.id" type="primary" size="small"
                        >我</el-tag
                      >
                    </div>
                    <div class="spectator-meta">
                      <span class="join-time">{{ formatTime(spectator.joinedAt) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div v-else class="no-spectators">
              <p>暂无观战者</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 队伍选择区域 -->
      <div
        v-if="privateRoomStore.isPlayer && privateRoomStore.currentRoom?.status === 'waiting'"
        class="team-selection-section"
      >
        <TeamSelector
          v-model="selectedTeam"
          :selected-rule-set-id="privateRoomStore.currentRoom.config.ruleSetId"
          @update:is-valid="isTeamValid = $event"
          @update:validation-errors="teamValidationErrors = $event"
        />
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

          <!-- 等待状态：等待玩家准备或选择队伍 -->
          <el-button v-else-if="privateRoomStore.currentRoom?.status === 'waiting'" type="primary" disabled>
            {{ getStartBattleDisabledReason() }}
          </el-button>

          <!-- 战斗进行中状态 -->
          <el-button v-else-if="privateRoomStore.currentRoom?.status === 'started'" type="info" disabled>
            战斗进行中
          </el-button>
        </template>

        <!-- 观战/战斗中 状态 -->
        <el-button
          v-if="privateRoomStore.isBattleInProgress && privateRoomStore.isSpectator"
          type="success"
          @click="joinSpectate"
        >
          进入观战
        </el-button>
        <el-button v-else-if="privateRoomStore.isBattleInProgress" type="info" disabled> 战斗进行中 </el-button>

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
          <el-button
            v-if="privateRoomStore.isPlayer"
            type="info"
            :disabled="privateRoomStore.isLoading"
            @click="switchToSpectator()"
          >
            转为观战者
          </el-button>

          <!-- 观战者转玩家 -->
          <el-button
            v-if="privateRoomStore.isSpectator && privateRoomStore.players.length < 2"
            type="warning"
            :disabled="privateRoomStore.isLoading"
            @click="confirmSwitchToPlayer"
          >
            转为玩家
          </el-button>
        </template>

        <!-- 离开房间按钮 -->
        <el-button :disabled="privateRoomStore.isLoading" @click="leaveRoom"> 离开房间 </el-button>
      </div>
    </div>

    <!-- 房间配置对话框 -->
    <el-dialog v-model="showRoomConfigDialog" title="房间设置" width="500px">
      <el-form :model="privateRoomStore.roomConfigForm" label-width="120px">
        <!-- 规则集选择 -->
        <el-form-item label="游戏规则">
          <el-select v-model="privateRoomStore.roomConfigForm.ruleSetId" placeholder="选择规则集" style="width: 100%">
            <el-option
              v-for="ruleSet in validationStore.availableRuleSets"
              :key="ruleSet.id"
              :label="ruleSet.name"
              :value="ruleSet.id"
            >
              <div style="display: flex; justify-content: space-between; align-items: center">
                <span>{{ ruleSet.name }}</span>
                <el-tag size="small" type="info">{{ ruleSet.ruleCount }} 条规则</el-tag>
              </div>
            </el-option>
          </el-select>
          <div class="form-help-text">当前: {{ getRuleSetName(privateRoomStore.roomConfigForm.ruleSetId) }}</div>
        </el-form-item>

        <!-- 观战功能默认开启，无需配置 -->

        <!-- 房间隐私设置 -->
        <el-form-item label="房间类型">
          <el-radio-group v-model="privateRoomStore.roomConfigForm.isPrivate">
            <el-radio :label="false">公开房间</el-radio>
            <el-radio :label="true">私密房间</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item v-if="privateRoomStore.roomConfigForm.isPrivate" label="房间密码">
          <el-input
            v-model="privateRoomStore.roomConfigForm.password"
            type="password"
            placeholder="设置房间密码"
            show-password
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <div class="dialog-footer">
          <el-button @click="showRoomConfigDialog = false">取消</el-button>
          <el-button type="primary" @click="saveRoomConfig" :loading="privateRoomStore.isLoading"> 保存设置 </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePrivateRoomStore } from '@/stores/privateRoom'
import { usePlayerStore } from '@/stores/player'
import { useValidationStore } from '@/stores/validation'
import { useBattleClientStore } from '@/stores/battleClient'
import { User, Loading, MoreFilled, Star, Close } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PlayerCard from '@/components/PlayerCard.vue'
import TeamSelector from '@/components/TeamSelector.vue'

const route = useRoute()
const router = useRouter()
const privateRoomStore = usePrivateRoomStore()
const playerStore = usePlayerStore()
const validationStore = useValidationStore()
const battleClientStore = useBattleClientStore()

const roomCode = route.params.roomCode as string

const selectedTeam = ref<any | null>(null)
const isTeamValid = ref(false)
const teamValidationErrors = ref<string[]>([])

const showRoomConfigDialog = ref(false)

watch(selectedTeam, newTeam => {
  if (newTeam) {
    privateRoomStore.updateSelectedTeam(newTeam.pets)
  } else {
    privateRoomStore.updateSelectedTeam([])
  }
})

// 计算属性
const getRuleSetName = (ruleSetId: string): string => {
  return validationStore.getRuleSetName(ruleSetId)
}

const getHostPlayerName = (): string => {
  if (!privateRoomStore.currentRoom) return ''
  const hostPlayerId = privateRoomStore.currentRoom.config.hostPlayerId

  // 先在玩家中查找
  const hostPlayer = privateRoomStore.players.find(p => p.playerId === hostPlayerId)
  if (hostPlayer) {
    return hostPlayer.playerName
  }

  // 再在观战者中查找
  const hostSpectator = privateRoomStore.spectators.find(s => s.playerId === hostPlayerId)
  if (hostSpectator) {
    return `${hostSpectator.playerName} (观战)`
  }

  return '未知'
}

const getStatusText = (status: string): string => {
  switch (status) {
    case 'waiting':
      return '等待中'
    case 'ready':
      return '准备就绪'
    case 'started':
      return '战斗中'
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
    case 'ended':
      return 'danger'
    default:
      return 'info'
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

const getStartBattleDisabledReason = (): string => {
  if (!privateRoomStore.currentRoom) return '房间信息加载中'

  if (privateRoomStore.players.length < 2) {
    return '等待玩家加入'
  }

  // 如果房主是玩家且没有选择队伍
  if (privateRoomStore.isPlayer && !selectedTeam.value) {
    return '请先选择队伍'
  }

  if (!isTeamValid.value) {
    return teamValidationErrors.value[0] || '队伍不符合规则'
  }

  // 检查非房主玩家是否都已准备
  const nonHostPlayers = privateRoomStore.players.filter(
    p => p.playerId !== privateRoomStore.currentRoom?.config.hostPlayerId,
  )
  const unreadyPlayers = nonHostPlayers.filter(p => !p.isReady)

  if (unreadyPlayers.length > 0) {
    return '等待玩家准备'
  }

  return '可以开始战斗'
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

const copyRoomLink = async () => {
  try {
    const roomUrl = `${window.location.origin}/room/${roomCode}`
    await navigator.clipboard.writeText(roomUrl)
    ElMessage.success('房间链接已复制到剪贴板')
  } catch (error) {
    ElMessage.error('复制失败，请手动复制房间链接')
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

const joinSpectate = async () => {
  try {
    await privateRoomStore.joinSpectateBattle()
    ElMessage.success('正在进入观战...')
  } catch (error) {
    ElMessage.error('进入观战失败: ' + (error as Error).message)
  }
}

// 队伍选择相关方法

const leaveRoom = async () => {
  try {
    await privateRoomStore.leaveRoom()
    ElMessage.success('已离开房间')
    router.push('/')
  } catch (error) {
    ElMessage.error('离开房间失败: ' + (error as Error).message)
  }
}

// 转移房主
const transferHost = async (targetPlayerId: string) => {
  try {
    const targetPlayer = privateRoomStore.players.find(p => p.playerId === targetPlayerId)
    await privateRoomStore.transferHost(targetPlayerId)
    ElMessage.success(`房主权限已转移给 ${targetPlayer?.playerName || '该玩家'}`)
  } catch (error) {
    ElMessage.error('转移房主失败: ' + (error as Error).message)
  }
}

// 踢出玩家
const kickPlayer = async (targetPlayerId: string) => {
  try {
    const targetPlayer = privateRoomStore.players.find(p => p.playerId === targetPlayerId)
    const targetSpectator = privateRoomStore.spectators.find(s => s.playerId === targetPlayerId)
    const targetName = targetPlayer?.playerName || targetSpectator?.playerName || '该玩家'

    await ElMessageBox.confirm(`确定要踢出 ${targetName} 吗？`, '踢出玩家', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })

    await privateRoomStore.kickPlayer(targetPlayerId)
    ElMessage.success(`已踢出 ${targetName}`)
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('踢出玩家失败: ' + (error as Error).message)
    }
  }
}

// 角色转换方法
const switchToSpectator = async () => {
  try {
    await privateRoomStore.switchToSpectator()
    ElMessage.success('已转为观战者')
  } catch (error) {
    ElMessage.error('转换为观战者失败: ' + (error as Error).message)
  }
}

const confirmSwitchToPlayer = async () => {
  try {
    // 这里应该使用用户选择的队伍，目前使用默认队伍
    const teamToSwitch = selectedTeam.value?.pets || playerStore.player?.team || []

    if (teamToSwitch.length === 0) {
      ElMessage.error('请先选择或设置你的队伍')
      return
    }

    await privateRoomStore.switchToPlayer(teamToSwitch)
    ElMessage.success('已转为玩家')
  } catch (error) {
    ElMessage.error('转换为玩家失败: ' + (error as Error).message)
  }
}

// 房间配置相关方法
const openRoomConfigDialog = () => {
  // 初始化配置表单
  privateRoomStore.initializeRoomConfigForm()
  showRoomConfigDialog.value = true
}

const saveRoomConfig = async () => {
  try {
    const configUpdates: {
      ruleSetId?: string
      isPrivate?: boolean
      password?: string
    } = { ...privateRoomStore.roomConfigForm }

    // 如果密码为空字符串，设置为undefined
    if (configUpdates.password === '') {
      delete configUpdates.password
    }

    await privateRoomStore.updateRoomConfig(configUpdates)
    showRoomConfigDialog.value = false
    ElMessage.success('房间配置已更新')
  } catch (error) {
    ElMessage.error('更新房间配置失败: ' + (error as Error).message)
  }
}

onMounted(async () => {
  if (!roomCode) {
    ElMessage.error('房间码无效')
    router.push('/')
    return
  }

  const joinRoomAction = async () => {
    // 检查是否已在该房间
    const isAlreadyInRoom = privateRoomStore.currentRoom?.config.roomCode === roomCode
    if (isAlreadyInRoom) {
      console.log('🏠 Already in room, skipping join logic.')
      return
    }

    try {
      console.log(`🚪 Attempting to join room: ${roomCode}`)
      await privateRoomStore.joinRoom(roomCode)
      console.log(`✅ Successfully joined room: ${roomCode}`)
    } catch (error) {
      console.error(`💥 Failed to join room: ${roomCode}`, error)
      ElMessage.error(`加入房间失败: ${(error as Error).message}`)
      router.push('/')
    }
  }

  if (battleClientStore.currentState.status === 'connected') {
    await joinRoomAction()
  } else {
    const unwatch = watch(
      () => battleClientStore.currentState.status,
      newStatus => {
        if (newStatus === 'connected') {
          joinRoomAction()
          unwatch() // Stop watching after the action is triggered
        }
      },
    )
  }
})

onBeforeUnmount(async () => {
  // 页面离开时只取消准备状态，不离开房间
  if (privateRoomStore.myReadyStatus && privateRoomStore.isPlayer) {
    try {
      await privateRoomStore.toggleReady()
    } catch (err) {
      console.error('Failed to cancel ready on page leave:', err)
    }
  }
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
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 1rem;
  background: var(--el-bg-color-page);
  border-radius: 6px;
  border: 1px solid var(--el-border-color);
  margin: 1rem 0;
}

.winner-info {
  font-size: 1.2rem;
  font-weight: bold;
  margin-bottom: 0.5rem;
}

.winner {
  color: #52c41a;
  font-weight: bold;
}

.draw {
  color: #faad14;
  font-weight: bold;
}

.result-reason {
  color: var(--el-text-color-secondary);
  font-size: 0.9rem;
}

.result-time {
  font-size: 0.9rem;
  color: var(--el-text-color-placeholder);
  margin-left: auto;
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

.form-help-text {
  font-size: 0.875rem;
  color: var(--el-text-color-secondary);
  margin-top: 0.25rem;
}

.participants-section {
  display: flex;
  flex-wrap: wrap;
  gap: 2rem;
}

.players-column {
  flex: 2;
  min-width: 300px;
}

.spectators-column {
  flex: 1;
  min-width: 250px;
}

.spectators-section {
  padding: 1.5rem;
  background: var(--el-bg-color-page);
  border-radius: 8px;
  border: 1px solid var(--el-border-color);
  height: 100%; /* Ensure it takes full height of its column */
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
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem; /* Reduced gap */
  padding: 0.5rem 0.75rem; /* Reduced padding */
  background: var(--el-bg-color);
  border-radius: 6px;
  border: 1px solid var(--el-border-color);
  font-size: 0.875rem; /* Smaller font size */
}

.spectator-info {
  display: flex;
  align-items: center;
  gap: 0.5rem; /* Reduced gap */
  flex: 1;
}

.spectator-details {
  display: flex;
  flex-direction: column;
  gap: 0.1rem; /* Reduced gap */
  flex: 1;
}

.spectator-name-row {
  display: flex;
  align-items: center;
  gap: 0.4rem; /* Reduced gap */
}

.spectator-name {
  font-weight: 500;
  color: var(--el-text-color-primary);
  font-size: 0.9rem; /* Slightly smaller name font */
}

.spectator-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem; /* Reduced gap */
}

.join-time {
  font-size: 0.7rem; /* Smaller join time font */
  color: var(--el-text-color-placeholder);
}

.spectator-actions {
  display: flex;
  gap: 0.5rem;
}

.spectator-actions-corner {
  position: absolute;
  top: 0.2rem; /* Adjusted position */
  right: 0.2rem; /* Adjusted position */
  z-index: 10;
}

.spectator-action-trigger {
  padding: 2px !important; /* Reduced padding */
  min-height: auto !important;
  border-radius: 50% !important;
  color: var(--el-text-color-regular) !important;
  background: var(--el-bg-color-overlay) !important;
  backdrop-filter: blur(4px);
  transition: all 0.2s ease;
}

.spectator-action-trigger:hover {
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

.no-spectators {
  text-align: center;
  color: var(--el-text-color-placeholder);
  padding: 1rem; /* Reduced padding */
  font-size: 0.9rem; /* Smaller font size */
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

  .participants-section {
    flex-direction: column; /* Stack columns on small screens */
  }
}

/* 队伍选择样式 */
.team-selection-section {
  margin: 2rem 0;
  padding: 1.5rem;
  background: var(--el-bg-color-page);
  border-radius: 8px;
  border: 1px solid var(--el-border-color);
}

.team-selection-section h3 {
  margin: 0 0 1rem 0;
  color: var(--el-text-color-primary);
}

.team-selection-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.current-team-display h4 {
  margin: 0 0 0.5rem 0;
  color: var(--el-text-color-regular);
  font-size: 0.9rem;
}

.team-pets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.pet-card {
  padding: 0.5rem;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  min-width: 120px;
}

.pet-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.pet-name {
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.pet-species {
  font-size: 0.8rem;
  color: var(--el-text-color-regular);
}

.pet-level {
  font-size: 0.8rem;
  color: var(--el-text-color-placeholder);
}

.no-team {
  padding: 1rem;
  text-align: center;
  color: var(--el-text-color-placeholder);
  border: 2px dashed var(--el-border-color);
  border-radius: 6px;
}

.team-actions {
  display: flex;
  gap: 0.5rem;
}

/* 队伍选择对话框样式 */
.team-selector {
  max-height: 400px;
  overflow-y: auto;
}

.team-option {
  padding: 1rem;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  margin-bottom: 1rem;
}

.team-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.team-header h4 {
  margin: 0;
  color: var(--el-text-color-primary);
}

.team-count {
  font-size: 0.8rem;
  color: var(--el-text-color-placeholder);
}

.team-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.pet-preview {
  display: flex;
  flex-direction: column;
  padding: 0.25rem 0.5rem;
  background: var(--el-bg-color-page);
  border-radius: 4px;
  min-width: 80px;
}

.pet-preview .pet-name {
  font-size: 0.8rem;
  font-weight: 500;
}

.pet-preview .pet-species {
  font-size: 0.7rem;
  color: var(--el-text-color-placeholder);
}

.no-teams {
  text-align: center;
  padding: 2rem;
  color: var(--el-text-color-placeholder);
}
</style>
