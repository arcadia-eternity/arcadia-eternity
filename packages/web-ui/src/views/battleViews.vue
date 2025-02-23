<script setup lang="ts">
import { useBattleStore } from '@/stores/battle'
import { ELEMENT_MAP, type PetMessage } from '@test-battle/const'
import PetStatus from '@/components/PetStatus.vue'
const store = useBattleStore()

// 新增工具方法
const getPetById = (id: string) => {
  return [...(store.state!.players[0].team ?? []), ...(store.state!.players[1].team ?? [])].find(p => p.id === id)
}

const getElementIcon = (element: string) => {
  return ELEMENT_MAP[element]?.emoji || '❓'
}

const formatHp = (pet: PetMessage) => {
  const percent = (pet.currentHp / pet.maxHp) * 100
  return `${percent.toFixed(1)}%`
}
</script>

<template>
  <div class="battle-container">
    <!-- 对手区域 -->
    <div class="opponent-side">
      <div class="rage-bar">怒气: {{ store.opponent?.rage }}</div>
      <PetStatus
        :pet="store.opponent?.activePet!"
        :is-fainted="store.opponent?.activePet!.currentHp! <= 0"
        is-opponent
      />
    </div>

    <!-- 战场效果 -->
    <div class="field-effects">
      <div v-for="mark in store.state?.marks" :key="mark.id" class="mark-bubble" :class="mark.type">
        {{ mark.name }} ×{{ mark.stack }}
      </div>
    </div>

    <!-- 玩家区域 -->
    <div class="player-side">
      <div class="rage-bar">怒气: {{ store.currentPlayer?.rage }}</div>
      <PetStatus :pet="store.currentPlayer?.activePet!" :is-fainted="store.currentPlayer?.activePet?.currentHp! <= 0" />
    </div>

    <!-- 操作面板 -->
    <div class="action-panel">
      <template v-if="store.availableActions.length">
        <div class="action-group" v-for="(action, index) in store.availableActions" :key="index">
          <button v-if="action.type === 'use-skill'" @click="store.sendPlayerAction(action)" class="skill-btn">
            <span class="skill-name">{{ getSkillName(action.skill) }}</span>
            <span class="rage-cost">消耗 {{ getSkillCost(action.skill) }} 怒气</span>
          </button>

          <button v-if="action.type === 'switch-pet'" @click="store.sendPlayerAction(action)" class="switch-btn">
            <span class="pet-name">{{ getPetById(action.pet)?.name }}</span>
            <span class="pet-hp">{{ getPetById(action.pet)?.currentHp }} HP</span>
          </button>
        </div>
      </template>

      <!-- <div v-else class="status-message">
        {{ store.isMyTurn ? '正在思考...' : '等待对手操作' }}
      </div> -->
    </div>

    <!-- 战斗日志 -->
    <div class="battle-log">
      <div v-for="(msg, index) in store.log" :key="index" class="log-entry" :class="msg.type">
        <component :is="getLogComponent(msg)" :msg="msg" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 新增样式 */
.battle-container {
  display: grid;
  grid-template-rows: 1fr auto 1fr;
  background: linear-gradient(to bottom, #1a1a2e, #16213e);
  color: white;
  min-height: 100vh;
}

.rage-bar {
  padding: 8px;
  background: rgba(0, 0, 0, 0.5);
  text-align: center;
  font-weight: bold;
}

.field-effects {
  display: flex;
  gap: 8px;
  justify-content: center;
  padding: 12px;
}

.mark-bubble {
  background: rgba(255, 255, 255, 0.1);
  padding: 6px 12px;
  border-radius: 20px;
  backdrop-filter: blur(5px);
}

.action-panel {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(0, 0, 0, 0.8);
  padding: 16px;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.skill-btn,
.switch-btn {
  padding: 12px;
  border: 2px solid #4caf50;
  border-radius: 8px;
  background: rgba(76, 175, 80, 0.15);
  color: white;
  display: flex;
  flex-direction: column;
  transition: all 0.2s;
}

.skill-btn:disabled {
  opacity: 0.6;
  border-color: #666;
}

.battle-log {
  position: fixed;
  right: 20px;
  bottom: 120px;
  width: 300px;
  max-height: 200px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.7);
  padding: 12px;
  border-radius: 8px;
}

.log-entry {
  padding: 8px;
  margin: 4px 0;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}
</style>
