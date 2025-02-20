<template>
  <div class="battle-container">
    <!-- 对战状态区 -->
    <div class="battle-state">
      <h2>第 {{ battleState?.currentTurn }} 回合 - {{ translatePhase(battleState?.currentPhase) }}</h2>
      <div class="players">
        <div v-for="player in battleState?.players" :key="player.id" class="player">
          <h3>{{ player.name }}</h3>
          <div class="rage">怒气值: {{ player.rage }}/100</div>
          <pet-info v-if="player.activePet" :pet="player.activePet" />
        </div>
      </div>
    </div>

    <!-- 操作选择区 -->
    <div class="action-panel" v-if="availableSelections.length">
      <h3>选择你的行动</h3>
      <div class="actions">
        <button v-for="(action, index) in availableSelections" :key="index" @click="handleAction(action)">
          {{ getActionLabel(action) }}
        </button>
      </div>
    </div>

    <!-- 战斗日志区 -->
    <div class="battle-log">
      <div v-for="(msg, index) in messages" :key="index" class="log-entry">
        <span :class="logTypeClass(msg.type)">[{{ formatTime(msg.timestamp) }}]</span>
        {{ formatMessage(msg) }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import {
  type BattleMessage,
  type BattleState,
  BattleMessageType,
  type PlayerSelection,
  type PetMessage,
} from '@test-battle/const'
import { BattleClient } from '@test-battle/client'

const props = defineProps({
  serverUrl: {
    type: String,
    required: true,
  },
  playerData: {
    type: Object,
    required: true,
  },
})

// 响应式状态
const battleState = ref<BattleState>()
const messages = ref<BattleMessage[]>([])
const availableSelections = ref<PlayerSelection[]>([])
const client = ref<BattleClient>()

// 初始化客户端
onMounted(() => {
  client.value = new BattleClient({ serverUrl: props.serverUrl })
  setupEventHandlers()
  connect()
})

// 清理资源
onUnmounted(() => {
  client.value?.disconnect()
})

// 事件处理
const setupEventHandlers = () => {
  client.value?.on('battleEvent', handleBattleMessage)
  client.value?.on('matchSuccess', handleMatchSuccess)
}

// 连接服务器
const connect = async () => {
  try {
    await client.value?.joinMatchmaking(props.playerData)
    console.log('等待匹配对手...')
  } catch (error) {
    console.error('连接失败:', error)
  }
}

// 处理战斗消息
const handleBattleMessage = (msg: BattleMessage) => {
  messages.value.push(msg)

  switch (msg.type) {
    case BattleMessageType.BattleState:
      battleState.value = msg.data
      break
    case BattleMessageType.TurnAction:
      fetchAvailableActions()
      break
  }
}

// 获取可用操作
const fetchAvailableActions = async () => {
  try {
    const actions = await client.value?.getAvailableSelection()
    availableSelections.value = actions || []
  } catch (error) {
    console.error('获取操作失败:', error)
  }
}

// 执行玩家操作
const handleAction = async (action: PlayerSelection) => {
  try {
    await client.value?.sendPlayerAction(action)
    availableSelections.value = []
  } catch (error) {
    console.error('操作失败:', error)
  }
}

// 格式化操作标签
const getActionLabel = (action: PlayerSelection) => {
  switch (action.type) {
    case 'use-skill':
      return `使用技能 ${action.skill}`
    case 'switch-pet':
      return `更换精灵 ${action.pet}`
    case 'do-nothing':
      return '本回合待机'
    case 'surrender':
      return '投降'
    default:
      return '未知操作'
  }
}

// 消息格式化逻辑（部分示例）
const formatMessage = (msg: BattleMessage) => {
  switch (msg.type) {
    case BattleMessageType.Damage:
      return `${msg.data.target} 受到 ${msg.data.damage}点伤害`
    case BattleMessageType.SkillUse:
      return `${msg.data.user} 使用 ${msg.data.skill}`
    // 其他消息类型处理...
    default:
      return msg.data?.toString() || ''
  }
}

// 辅助方法
const translatePhase = (phase?: string) => {
  // 实现阶段翻译逻辑...
}

const logTypeClass = (type: BattleMessageType) => {
  return {
    [BattleMessageType.Damage]: 'damage-log',
    [BattleMessageType.Heal]: 'heal-log',
    [BattleMessageType.Info]: 'info-log',
  }[type]
}
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
