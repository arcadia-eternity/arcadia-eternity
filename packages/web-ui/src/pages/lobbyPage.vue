<template>
  <div class="lobby-container">
    <h1>对战匹配大厅</h1>

    <!-- 导航菜单 -->
    <div class="navigation-menu">
      <router-link to="/team-builder" class="nav-button">
        <el-icon><User /></el-icon>
        队伍编辑
      </router-link>
      <router-link to="/battle-reports" class="nav-button">
        <el-icon><Document /></el-icon>
        战报记录
      </router-link>
      <!-- 排行榜功能暂时禁用 -->
      <!-- <router-link to="/leaderboard" class="nav-button">
        <el-icon><Trophy /></el-icon>
        排行榜
      </router-link> -->
      <router-link to="/local-battle" class="nav-button">
        <el-icon><Monitor /></el-icon>
        本地测试
      </router-link>
    </div>

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

    <!-- 提示信息 -->
    <div class="info-section">
      <el-alert title="使用提示" type="info" :closable="false" class="mb-4">
        <ul class="text-left">
          <li>不要忘了先在队伍编辑里面编辑队伍</li>
          <li>目前正在活跃更新中，可能会有一些bug，尽量谅解</li>
          <li>暂时只能在电脑/平板上游玩 手机版本在计划中……</li>
          <li>尽量精灵出现以后再选择技能，不然动画有时候会卡住</li>
          <li>群号：805146068</li>
        </ul>
      </el-alert>
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
import { User, Document, Monitor } from '@element-plus/icons-vue'

const router = useRouter()
const route = useRoute()
const battleStore = useBattleStore()
const playerStore = usePlayerStore()

// 响应式状态
const isMatching = computed(() => battleClient.currentState.matchmaking === 'searching')
const errorMessage = ref<string | null>(null)

const handleMatchmaking = async () => {
  try {
    // 清除之前的错误信息
    errorMessage.value = null

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

.navigation-menu {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px;
  margin: 2rem 0;
  max-width: 600px;
  margin-left: auto;
  margin-right: auto;
}

.nav-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px;
  background: white;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  text-decoration: none;
  color: #374151;
  transition: all 0.3s ease;
  font-weight: 500;
}

.nav-button:hover {
  border-color: #3b82f6;
  background: #f8fafc;
  color: #3b82f6;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
}

.nav-button.router-link-active {
  border-color: #3b82f6;
  background: #eff6ff;
  color: #3b82f6;
}

.info-section {
  margin-top: 2rem;
  text-align: left;
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
