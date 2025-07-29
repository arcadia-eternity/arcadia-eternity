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

      <!-- 队伍选择区域 -->
      <div
        v-if="privateRoomStore.isPlayer && privateRoomStore.currentRoom?.status === 'waiting'"
        class="team-selection-section"
      >
        <h3>队伍选择</h3>
        <div class="team-selection-content">
          <div class="current-team-display">
            <h4>当前选择的队伍</h4>
            <div class="team-pets">
              <div v-for="pet in privateRoomStore.selectedTeam" :key="pet.id" class="pet-card">
                <div class="pet-info">
                  <span class="pet-name">{{ pet.name }}</span>
                  <span class="pet-species">{{ pet.species }}</span>
                  <span class="pet-level">Lv.{{ pet.level }}</span>
                </div>
              </div>
              <div v-if="privateRoomStore.selectedTeam.length === 0" class="no-team">
                <span>请选择队伍</span>
              </div>
            </div>
          </div>
          <div class="team-actions">
            <el-button type="primary" @click="showTeamSelector = true"> 选择队伍 </el-button>
            <el-button v-if="privateRoomStore.selectedTeam.length > 0" type="success" @click="useCurrentTeam">
              使用当前队伍
            </el-button>
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

          <!-- 等待状态：等待玩家准备或选择队伍 -->
          <el-button v-else-if="privateRoomStore.currentRoom?.status === 'waiting'" type="primary" disabled>
            {{ getStartBattleDisabledReason() }}
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
            v-if="privateRoomStore.isPlayer"
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
        <el-button :disabled="privateRoomStore.isLoading" @click="leaveRoom"> 离开房间 </el-button>
      </div>

      <!-- 观战者区域 -->
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
                  <el-tag v-if="spectator.playerId === playerStore.player.id" type="primary" size="small">我</el-tag>
                </div>
                <div class="spectator-meta">
                  <el-tag v-if="spectator.preferredView" size="small">
                    {{ getViewModeText(spectator.preferredView) }}
                  </el-tag>
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

    <!-- 队伍选择对话框 -->
    <el-dialog v-model="showTeamSelector" title="选择队伍" width="600px">
      <div class="team-selector">
        <div v-for="(team, index) in petStorageStore.teams" :key="index" class="team-option">
          <div class="team-header">
            <h4>{{ team.name }}</h4>
            <span class="team-count">{{ team.pets.length }}只精灵</span>
          </div>
          <div class="team-preview">
            <div v-for="pet in team.pets.slice(0, 6)" :key="pet.id" class="pet-preview">
              <span class="pet-name">{{ pet.name }}</span>
              <span class="pet-species">{{ pet.species }}</span>
            </div>
          </div>
          <el-button type="primary" size="small" @click="selectTeam(index)"> 选择此队伍 </el-button>
        </div>
        <div v-if="petStorageStore.teams.length === 0" class="no-teams">
          <p>暂无可用队伍，请先在队伍编辑器中创建队伍</p>
          <el-button type="primary" @click="router.push('/team-builder')"> 前往队伍编辑器 </el-button>
        </div>
      </div>
    </el-dialog>

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
import { ref, onMounted, onUnmounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePrivateRoomStore } from '@/stores/privateRoom'
import { usePlayerStore } from '@/stores/player'
import { useValidationStore } from '@/stores/validation'
import { usePetStorageStore } from '@/stores/petStorage'
import { User, Loading, ArrowDown, MoreFilled, Star, Close } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PlayerCard from '@/components/PlayerCard.vue'

const route = useRoute()
const router = useRouter()
const privateRoomStore = usePrivateRoomStore()
const playerStore = usePlayerStore()
const validationStore = useValidationStore()
const petStorageStore = usePetStorageStore()

const roomCode = route.params.roomCode as string

// 响应式变量
const switchToPlayerDialogVisible = ref(false)
const showTeamSelector = ref(false)
const showRoomConfigDialog = ref(false)

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

const getStartBattleDisabledReason = (): string => {
  if (!privateRoomStore.currentRoom) return '房间信息加载中'

  if (privateRoomStore.players.length < 2) {
    return '等待玩家加入'
  }

  // 如果房主是玩家且没有选择队伍
  if (privateRoomStore.isPlayer && privateRoomStore.selectedTeam.length === 0) {
    return '请先选择队伍'
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

// 队伍选择相关方法
const useCurrentTeam = () => {
  const currentTeam = petStorageStore.getCurrentTeam()
  privateRoomStore.updateSelectedTeam(currentTeam)
  ElMessage.success('已选择当前队伍')
}

const selectTeam = (teamIndex: number) => {
  const team = petStorageStore.teams[teamIndex]?.pets || []
  privateRoomStore.updateSelectedTeam(team)
  showTeamSelector.value = false
  ElMessage.success(`已选择队伍：${petStorageStore.teams[teamIndex]?.name || '未命名队伍'}`)
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

// 生命周期
onMounted(async () => {
  if (!roomCode) {
    ElMessage.error('房间码无效')
    router.push('/')
    return
  }

  // 如果已经有当前房间状态且房间码匹配，直接使用
  if (privateRoomStore.currentRoom && privateRoomStore.currentRoom.config.roomCode === roomCode) {
    console.log('🏠 Using existing room state, skipping server call')
    try {
      // 重新设置事件监听器（因为页面切换时可能被移除）
      privateRoomStore.setupRoomEventListeners()
      // 初始化选择的队伍
      privateRoomStore.initializeSelectedTeam()
      console.log('🏠 PrivateRoomPage mounted successfully with existing state')
    } catch (error) {
      console.error('🏠 Error setting up existing room state:', error)
      // 如果使用现有状态失败，尝试重新获取
      try {
        console.log('🏠 Fallback: Getting room info from server...')
        await privateRoomStore.getRoomInfo(roomCode)
        privateRoomStore.initializeSelectedTeam()
        console.log('🏠 Fallback successful')
      } catch (fallbackError) {
        console.error('🏠 Fallback also failed:', fallbackError)
        ElMessage.error('房间状态异常: ' + (fallbackError as Error).message)
        router.push('/')
      }
    }
  } else {
    // 没有匹配的房间状态，从服务器获取
    try {
      console.log('🏠 Getting room info from server...')
      await privateRoomStore.getRoomInfo(roomCode)
      privateRoomStore.initializeSelectedTeam()
      console.log('🏠 Room info retrieved successfully')
    } catch (error) {
      console.error('🏠 Failed to get room info:', error)
      ElMessage.error('获取房间信息失败: ' + (error as Error).message)
      router.push('/')
    }
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

onUnmounted(() => {
  // 页面卸载时不清空房间状态，保持全局房间状态
  // 只移除事件监听器
  privateRoomStore.removeEventListeners()
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

.form-help-text {
  font-size: 0.875rem;
  color: var(--el-text-color-secondary);
  margin-top: 0.25rem;
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
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem;
  background: var(--el-bg-color);
  border-radius: 6px;
  border: 1px solid var(--el-border-color);
}

.spectator-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
}

.spectator-details {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
}

.spectator-name-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.spectator-name {
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.spectator-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.join-time {
  font-size: 0.75rem;
  color: var(--el-text-color-placeholder);
}

.spectator-actions {
  display: flex;
  gap: 0.5rem;
}

.spectator-actions-corner {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  z-index: 10;
}

.spectator-action-trigger {
  padding: 4px !important;
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
