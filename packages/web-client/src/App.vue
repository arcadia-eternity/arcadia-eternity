<template>
  <div class="seer-battle-container">
    <!-- 顶部匹配按钮 -->
    <div class="match-control" v-if="!isMatching">
      <button class="seer-btn" @click="startMatch">
        <span class="glow-text">⚡ 开始匹配</span>
      </button>
    </div>

    <!-- 加载状态 -->
    <div v-if="isMatching && !battleState" class="matching-status">
      <div class="scanning-animation"></div>
      <h3 class="neon-text">扫描对手中... {{ scanningDots }}</h3>
    </div>

    <!-- 主战场 -->
    <div v-if="battleState" class="battle-main">
      <!-- 对手信息 -->
      <div class="battle-side foe-side">
        <div class="trainer-card">
          <img src="~/assets/foe-trainer.png" class="trainer-img" />
          <div class="trainer-info">
            <h3 class="foe-name">{{ foe?.name }}</h3>
            <div class="rage-bar">
              <div class="rage-fill" :style="{ width: foeRage + '%' }"></div>
            </div>
          </div>
        </div>
        <pet-display :pet="foeActivePet" side="right" />
      </div>

      <!-- 战场中央 -->
      <div class="battle-center">
        <div class="stage-effects">
          <div v-for="(mark, index) in battleState.marks" :key="index" class="stage-mark">
            {{ mark.name }} ×{{ mark.stack }}
          </div>
        </div>
        <div class="turn-counter">第 {{ battleState.currentTurn }} 回合</div>
      </div>

      <!-- 玩家信息 -->
      <div class="battle-side player-side">
        <div class="trainer-card">
          <img src="~/assets/player-trainer.png" class="trainer-img" />
          <div class="trainer-info">
            <h3 class="player-name">{{ playerData.name }}</h3>
            <div class="rage-bar">
              <div class="rage-fill" :style="{ width: playerRage + '%' }"></div>
            </div>
          </div>
        </div>
        <pet-display :pet="playerActivePet" side="left" />
      </div>

      <!-- 战斗操作面板 -->
      <div class="action-panel">
        <div class="action-category" v-if="availableSelections.length">
          <button
            v-for="(action, index) in availableSelections"
            :key="index"
            class="seer-action-btn"
            @click="handleAction(action)"
            :class="getActionTypeClass(action)"
          >
            <span class="action-icon">{{ getActionIcon(action) }}</span>
            {{ getActionLabel(action) }}
          </button>
        </div>
      </div>

      <!-- 战斗日志 -->
      <div class="battle-log">
        <div v-for="(msg, index) in messages" :key="index" class="log-entry" :class="logTypeClass(msg.type)">
          <span class="log-time">{{ formatTime(msg.timestamp) }}</span>
          <span v-html="formatMessage(msg)"></span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type {
  BattleMessage,
  BattleState,
  BattleMessageType,
  PlayerSelection,
  PetMessage,
  Player,
} from '@test-battle/const'
import { BattleClient } from '@test-battle/client'

// 类型定义增强
interface BattleMessageWithTimestamp extends BattleMessage {
  timestamp: number
}

// 组件属性定义
const props = defineProps<{
  serverUrl: string
  playerData: Player
}>()

// 响应式状态
const battleState = ref<BattleState>()
const messages = ref<BattleMessageWithTimestamp[]>([])
const availableSelections = ref<PlayerSelection[]>([])
const isMatching = ref(false)
const scanningDots = ref('')
const client = ref<BattleClient>()

// 计算属性
const foe = computed(() => battleState.value?.players.find(p => p.id !== props.playerData.id))

const playerRage = computed(() => battleState.value?.players.find(p => p.id === props.playerData.id)?.rage ?? 0)

const foeRage = computed(() => foe.value?.rage ?? 0)

// 时间格式化方法
const formatTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString()
}

// 匹配成功处理
const handleMatchSuccess = () => {
  isMatching.value = false
  console.log('匹配成功！对战即将开始...')
}

// 战斗消息处理
const handleBattleMessage = (msg: BattleMessage) => {
  const messageWithTimestamp = {
    ...msg,
    timestamp: Date.now(),
  }
  messages.value.push(messageWithTimestamp)

  switch (msg.type) {
    case BattleMessageType.BattleState:
      battleState.value = msg.data
      break
    case BattleMessageType.TurnAction:
      fetchAvailableActions()
      break
  }
}

// 获取可用操作（调整类型匹配）
const fetchAvailableActions = async () => {
  try {
    const actions = await client.value?.getAvailableSelection()
    // 添加必要的player字段
    availableSelections.value =
      actions?.map(action => ({
        ...action,
        player: props.playerData.id,
      })) || []
  } catch (error) {
    console.error('获取操作失败:', error)
  }
}

// 处理玩家操作（类型适配）
const handleAction = async (action: PlayerSelection) => {
  try {
    // 添加source字段
    const enhancedAction = {
      ...action,
      source: props.playerData.id,
    }
    await client.value?.sendPlayerAction(enhancedAction)
    availableSelections.value = []
  } catch (error) {
    console.error('操作失败:', error)
  }
}

// 日志类型样式
const logTypeClass = (type: BattleMessageType) => {
  const typeMap = {
    [BattleMessageType.Damage]: 'damage-log',
    [BattleMessageType.Heal]: 'heal-log',
    [BattleMessageType.Info]: 'info-log',
    [BattleMessageType.BattleState]: 'state-log',
    [BattleMessageType.SkillUse]: 'skill-log',
    // 添加其他消息类型...
  }
  return typeMap[type] || 'info-log'
}

// 清理未使用的导入和变量
</script>

<style scoped>
.battle-container {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 20px;
  padding: 20px;
  background: #1a1a1a;
  color: white;
}

.battle-state {
  grid-column: 1 / -1;
  background: #2a2a2a;
  padding: 15px;
  border-radius: 8px;
}

.players {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

.player {
  background: #333;
  padding: 15px;
  border-radius: 6px;
}

.action-panel {
  background: #2a2a2a;
  padding: 15px;
  border-radius: 8px;
}

.actions {
  display: grid;
  gap: 10px;
}

button {
  padding: 10px;
  background: #444;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

button:hover {
  background: #555;
}

.battle-log {
  height: 400px;
  overflow-y: auto;
  background: #000;
  padding: 10px;
  border-radius: 6px;
}

.log-entry {
  padding: 5px;
  font-family: monospace;
}

.damage-log {
  color: #ff4444;
}
.heal-log {
  color: #44ff44;
}
.info-log {
  color: #888;
}
</style>
