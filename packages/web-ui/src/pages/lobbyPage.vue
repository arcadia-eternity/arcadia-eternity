<template>
  <div class="lobby-container">
    <h1>对战匹配大厅</h1>

    <!-- 匹配控制区域 -->
    <div class="match-control">
      <button @click="handleMatchmaking" class="match-button">
        {{ isMatching ? '取消匹配' : '开始匹配' }}
      </button>

      <!-- 加载状态 -->
      <div v-if="isMatching" class="matching-status">
        <div class="loading-spinner"></div>
        <p>正在寻找对手...</p>
      </div>

      <!-- 错误提示 -->
      <div v-if="errorMessage" class="error-message">
        {{ errorMessage }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted, nextTick, reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBattleStore } from '@/stores/battle'
import { usePlayerStore } from '@/stores/player'
import { battleClient } from '@/utils/battleClient'
import { BattleClient, RemoteBattleSystem } from '@arcadia-eternity/client'

const router = useRouter()
const route = useRoute()
const battleStore = useBattleStore()
const playerStore = usePlayerStore()

// 响应式状态
const isMatching = computed(() => battleClient.currentState.matchmaking === 'searching')
const errorMessage = ref<string | null>(null)

const handleMatchmaking = async () => {
  try {
    if (isMatching.value) {
      await battleClient.cancelMatchmaking()
    } else {
      await battleClient.joinMatchmaking(playerStore.player)
      battleClient.once('matchSuccess', async () => {
        await battleStore.initBattle(new RemoteBattleSystem(battleClient as BattleClient), playerStore.player.id)
        router.push({
          path: '/battle',
          query: { roomId: battleClient.currentState.roomId },
        })
      })
    }
  } catch (error) {
    errorMessage.value = (error as Error).message
    setTimeout(() => (errorMessage.value = null), 3000)
  }
}
onMounted(() => {
  nextTick(() => {
    if (route.query.startMatching === 'true') handleMatchmaking()
  })
})

onBeforeUnmount(async () => {
  nextTick(() => {
    if (isMatching.value) {
      battleClient.cancelMatchmaking()
    }
    errorMessage.value = null
  })
})
</script>

<style scoped>
.lobby-container {
  max-width: 800px;
  margin: 2rem auto;
  padding: 20px;
  text-align: center;
}

.match-button {
  padding: 12px 24px;
  font-size: 1.1rem;
  background-color: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.3s;
}

.match-button:disabled {
  background-color: #cccccc;
  cursor: not-allowed;
}

.match-button:not(:disabled):hover {
  background-color: #45a049;
}

.matching-status {
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.loading-spinner {
  width: 30px;
  height: 30px;
  border: 3px solid #f3f3f3;
  border-top: 3px solid #3498db;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.error-message {
  color: #ff4444;
  margin-top: 15px;
  padding: 10px;
  border: 1px solid #ff4444;
  border-radius: 4px;
  background-color: #ffe6e6;
}
</style>
