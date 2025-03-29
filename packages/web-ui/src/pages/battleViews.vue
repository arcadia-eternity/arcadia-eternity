<!-- src/views/BattleView.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { useBattleStore } from '@/stores/battle'
import { useGameDataStore } from '@/stores/gameData'
import { type petId, type PetMessage } from '@test-battle/const'
import PetStatus from '@/components/PetStatus.vue'
import BattleLogPanel from '@/components/BattleLogPanel.vue'
import i18next from 'i18next'
import type { MarkMessage, PlayerMessage, SkillMessage } from '@test-battle/const'
import type { skillId } from '@test-battle/const'

const store = useBattleStore()
const dataStore = useGameDataStore()

// 安全访问方法
const safePet = (pet?: PetMessage) => pet ?? ({} as PetMessage)

const skillMap = computed(() => {
  const entries =
    store.state?.players
      ?.flatMap(p => p.team ?? [])
      ?.flatMap(pet => pet?.skills?.filter(skill => !skill.isUnknown).map(skill => [skill.id, skill] as const) ?? []) ??
    []
  return new Map<skillId, SkillMessage>(entries)
})

const petMap = computed(() => {
  const entries =
    store.state?.players
      ?.flatMap(p => p.team ?? [])
      .filter(pet => !pet.isUnknown)
      ?.map(pet => [pet.id, pet] as const) ?? []
  return new Map<petId, PetMessage>(entries)
})

const playerMap = computed(() => {
  const entries = store.state?.players?.map(player => [player.id, player] as const) ?? []
  return new Map<string, PlayerMessage>(entries)
})

const markMap = computed(() => {
  const entries = [
    ...(store.state?.marks ?? []),
    ...(store.state?.players
      .flatMap(p => p.team ?? [])
      .filter(pet => !pet.isUnknown)
      .flatMap(pet => pet?.marks ?? []) ?? []),
  ].map(mark => [mark.id, mark] as const)
  return new Map<string, MarkMessage>(entries)
})

const getPlayerStatus = (player: PlayerMessage) => {
  return {
    name: player.name,
    rage: player.rage,
    currentPet: {
      level: player.activePet?.level ?? 0,
      name: player.activePet?.name ?? '未知精灵',
      speciesNum: dataStore.getSpecies(player.activePet?.speciesID)?.num ?? 0,
      currentHp: player.activePet?.currentHp ?? 0,
      maxHp: player.activePet?.maxHp ?? 0,
      element: player.activePet?.element ?? 'normal',
      marks: player.activePet?.marks.map(m => {
        const image = dataStore.getMarkImage(m.id)
        const name = i18next.t(`${m.baseId}.name`, {
          ns: ['mark', 'mark_ability', 'mark_emblem'],
        })
        const description = i18next.t(`${m.baseId}.description`, {
          ns: ['mark', 'mark_ability', 'mark_emblem'],
        })
        return {
          id: m.id,
          name,
          stack: m.stack,
          duration: m.duration,
          description,
          image,
        }
      }),
    },
  }
}

const selfBattleStatus = computed(() => {
  const player = store.state?.players.find(p => p.id === store.playerId)
  if (!player) return null
  return getPlayerStatus(player)
})

const opponentBattleStatus = computed(() => {
  const opponent = store.state?.players.find(p => p.id !== store.playerId)
  if (!opponent) return null
  return getPlayerStatus(opponent)
})

const battleResult = computed(() => {
  if (!store.isBattleEnd) return ''
  const winner = store.state?.players.find(p => p.id === store.victor)
  if (!winner) return '平局'
  return winner.id === store.playerId ? '胜利！🎉' : '失败...💔'
})
</script>

<template>
  <div class="battle-container">
    <!-- 左侧玩家区域 -->
    <div class="left-side">
      <div class="trainer-info player-info">
        <h2 class="trainer-name">{{ store.currentPlayer?.name || '玩家' }}</h2>
        <div class="rage-display">
          <span class="rage-icon">🔥</span>
          {{ store.currentPlayer?.rage ?? 0 }}/100
        </div>
      </div>
      <PetStatus
        :pet="safePet(store.currentPlayer?.activePet)"
        :is-fainted="(store.currentPlayer?.activePet?.currentHp ?? 0) <= 0"
        class="pet-status-left"
      />
    </div>

    <!-- 中央战斗区域 -->
    <div class="center-area">
      <div class="round-number">{{ store.state?.currentTurn || 0 }}</div>
      <div v-if="store.state?.marks?.length" class="field-effects">
        <div v-for="mark in store.state.marks" :key="mark.id" class="field-effect" :title="`剩余${mark.duration}回合`">
          {{ '⭕' }}
          {{
            i18next.t(`${mark.baseId}.name`, {
              ns: ['mark', 'mark_ability', 'mark_emblem'],
            })
          }}
          ×{{ mark.stack }}
        </div>
      </div>
      <div class="battle-message">
        <p>{{ '战斗开始！' }}</p>
      </div>
    </div>

    <!-- 右侧对手区域 -->
    <div class="right-side">
      <div class="trainer-info opponent-info">
        <h2 class="trainer-name">{{ store.opponent?.name || '对手' }}</h2>
        <div class="rage-display">
          <span class="rage-icon">🔥</span>
          {{ store.opponent?.rage ?? 0 }}/100
        </div>
      </div>
      <PetStatus
        :pet="safePet(store.opponent?.activePet)"
        :is-fainted="(store.opponent?.activePet?.currentHp ?? 0) <= 0"
        class="pet-status-right"
        is-opponent
      />
    </div>

    <div class="bottom-panel">
      <!-- 左侧操作面板 -->
      <div class="action-panel">
        <template v-if="store.availableActions.length">
          <button
            v-for="(action, index) in store.availableActions"
            :key="index"
            class="action-btn"
            :class="[`action-${action.type.replace('_', '-')}`]"
            @click="store.sendplayerSelection(action)"
          >
            <template v-if="action.type === 'use-skill'">
              <span class="action-icon">🎯</span>
              <div class="action-info">
                <div class="action-title">
                  {{
                    i18next.t(`${store.getSkillInfo(action.skill)?.baseId}.name`, {
                      ns: 'skill',
                    })
                  }}
                </div>
                <div class="action-cost">消耗 {{ store.getSkillInfo(action.skill)?.rage }} 怒气</div>
              </div>
            </template>

            <template v-else-if="action.type === 'switch-pet'">
              <span class="action-icon">🔄</span>
              <div class="action-info">
                <div class="action-title">
                  {{ store.getPetById(action.pet as petId)?.name || '未知精灵' }}
                </div>
                <div class="action-sub">
                  HP: {{ store.getPetById(action.pet as petId)?.currentHp ?? '?' }}/{{
                    store.getPetById(action.pet as petId)?.maxHp ?? '?'
                  }}
                </div>
              </div>
            </template>

            <template v-else-if="action.type === 'do-nothing'">
              <span class="action-icon">🔄</span>
              <div class="action-info">
                <div class="action-title">什么都不做</div>
              </div>
            </template>

            <template v-else-if="action.type === 'surrender'">
              <span class="action-icon">🏳️</span>
              <div class="action-info">
                <div class="action-title">投降</div>
              </div>
            </template>
          </button>
        </template>
        <div v-else class="action-placeholder">
          <el-icon><Clock /></el-icon>
          <span>等待对手操作...</span>
        </div>
      </div>

      <!-- 右侧日志面板 -->
      <BattleLogPanel
        :messages="store.log"
        :mark-data="markMap"
        :skill-data="skillMap"
        :pet-data="petMap"
        :player-data="playerMap"
      />
    </div>

    <Transition name="fade">
      <div v-if="store.isBattleEnd" class="battle-end-overlay">
        <div class="result-box">
          <h2 class="result-title">{{ battleResult }}</h2>

          <div class="result-actions">
            <button
              class="action-btn"
              @click="
                $router.push({
                  name: 'Lobby',
                  query: { startMatching: 'true' },
                })
              "
            >
              重新匹配
            </button>
            <button class="action-btn" @click="$router.push('/')">返回大厅</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.battle-container {
  display: grid;
  grid-template-columns: 1fr 2fr 1fr;
  grid-template-rows: auto 1fr auto;
  height: 100vh;
  background: #1a1a2e;
  color: #fff;
  padding: 0;
  gap: 0;
}

.left-side,
.right-side {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  padding: 10px;
  width: 100%;
}

.center-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: url('path-to-grassy-background.jpg') no-repeat center center;
  background-size: cover;
  position: relative;
}

.trainer-info {
  background: rgba(0, 0, 0, 0.5);
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 10px;
  width: 100%;
}

.trainer-name {
  color: #81c784;
  font-size: 1.2rem;
  margin: 0;
}

.rage-display {
  font-size: 1rem;
  color: #fff;
  display: flex;
  align-items: center;
  gap: 5px;
}

.pet-status-left,
.pet-status-right {
  width: 100%;
  margin: 0;
  transform: none; /* Remove flip for alignment */
}

.pet-status-left {
  margin-left: 20px;
}

.pet-status-right {
  margin-right: 20px;
}

.round-number {
  font-size: 4rem;
  font-weight: bold;
  color: #fff;
  margin: 20px 0;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
}

.battle-message {
  background: rgba(0, 0, 0, 0.7);
  border-radius: 8px;
  padding: 10px;
  color: #fff;
  font-size: 1rem;
  max-width: 300px;
  text-align: center;
}

.bottom-panel {
  grid-row: 3;
  grid-column: 1 / 4;
  display: grid;
  grid-template-columns: 2fr 1fr; /* 左右等宽分栏 */
  gap: 16px;
  padding: 16px;
  background: rgba(0, 0, 0, 0.9);
  border-top: 2px solid #2c2c4d;
  height: 35vh; /* 增加可视区域 */
  min-height: 240px; /* 添加最小高度限制 */
}

.action-panel {
  padding: 16px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  border-right: none;
  box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.2);
}

.log-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.log-scroll-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 20px 20px;
  /* 调整遮罩范围避免覆盖滚动条 */
  mask-image: linear-gradient(to top, transparent 0, black 24px, black calc(100% - 24px), transparent);
  /* 增加右边距防止滚动条遮挡内容 */
  padding-right: 30px;
  margin-right: -10px;
  scroll-behavior: smooth;
  overflow-anchor: auto; /* 启用滚动锚定 */
}

/* 优化滚动条位置 */
.log-scroll-container::-webkit-scrollbar {
  width: 8px;
}

.log-scroll-container::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.1);
}

.log-scroll-container::-webkit-scrollbar-thumb {
  background: rgba(120, 120, 180, 0.8);
  border-radius: 4px;
}

.action-btn {
  border-radius: 8px;
  margin-bottom: 8px;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
  backdrop-filter: blur(4px);
}

.action-btn:hover {
  transform: translateX(6px);
  box-shadow: 2px 2px 8px rgba(0, 0, 0, 0.3);
}

/* 新增按钮颜色区分 */
.action-use-skill {
  background: linear-gradient(45deg, rgba(76, 175, 80, 0.15) 0%, rgba(76, 175, 80, 0.3) 100%);
  border-left: 4px solid #4caf50;
}

.action-switch-pet {
  background: linear-gradient(45deg, rgba(33, 150, 243, 0.15) 0%, rgba(33, 150, 243, 0.3) 100%);
  border-left: 4px solid #2196f3;
}

.action-surrender {
  background: linear-gradient(45deg, rgba(244, 67, 54, 0.15) 0%, rgba(244, 67, 54, 0.3) 100%);
  border-left: 4px solid #f44336;
}

.action-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #666;
  height: 100%;
}

.battle-end-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.result-box {
  background: linear-gradient(145deg, #2a2a4a, #1a1a2e);
  padding: 2rem 4rem;
  border-radius: 16px;
  text-align: center;
  box-shadow: 0 0 30px rgba(81, 65, 173, 0.4);
}

.result-title {
  font-size: 3rem;
  margin: 1rem 0;
  text-shadow: 0 0 20px #fff;
}

.result-actions {
  margin-top: 2rem;
  display: flex;
  gap: 1rem;
  justify-content: center;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.5s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.battle-result {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  font-size: 3rem;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
  animation: float 2s ease-in-out infinite;
}

@keyframes float {
  0%,
  100% {
    transform: translateY(-50%) translateY(0);
  }
  50% {
    transform: translateY(-50%) translateY(-20px);
  }
}
</style>
