<template>
  <div
    class="lobby-container w-full mx-auto text-center min-h-screen box-border flex flex-col px-4 py-6 md:px-5 md:py-8 max-w-4xl"
  >
    <h1 class="text-2xl md:text-3xl font-bold mb-6 md:mb-8 text-gray-800">对战匹配大厅</h1>

    <!-- 导航菜单 -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 md:gap-4 my-6 md:my-8 mx-auto max-w-6xl">
      <router-link
        to="/team-builder"
        class="flex flex-col items-center gap-2 p-4 md:p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] router-link-active:border-blue-500 router-link-active:bg-blue-50 router-link-active:text-blue-500 min-h-[80px] md:min-h-[auto] touch-manipulation"
      >
        <el-icon :size="20"><User /></el-icon>
        <span class="text-sm md:text-base">队伍编辑</span>
      </router-link>
      <router-link
        to="/account"
        class="flex flex-col items-center gap-2 p-4 md:p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] router-link-active:border-blue-500 router-link-active:bg-blue-50 router-link-active:text-blue-500 min-h-[80px] md:min-h-[auto] touch-manipulation"
      >
        <el-icon :size="20"><Setting /></el-icon>
        <span class="text-sm md:text-base">账户管理</span>
      </router-link>
      <router-link
        to="/dex"
        class="flex flex-col items-center gap-2 p-4 md:p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] router-link-active:border-blue-500 router-link-active:bg-blue-50 router-link-active:text-blue-500 min-h-[80px] md:min-h-[auto] touch-manipulation"
      >
        <el-icon :size="20"><Collection /></el-icon>
        <span class="text-sm md:text-base">图鉴</span>
      </router-link>
      <router-link
        to="/battle-reports"
        class="flex flex-col items-center gap-2 p-4 md:p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] router-link-active:border-blue-500 router-link-active:bg-blue-50 router-link-active:text-blue-500 min-h-[80px] md:min-h-[auto] touch-manipulation"
      >
        <el-icon :size="20"><Document /></el-icon>
        <span class="text-sm md:text-base">在线战报</span>
      </router-link>
      <router-link
        to="/local-battle-reports"
        class="flex flex-col items-center gap-2 p-4 md:p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] router-link-active:border-blue-500 router-link-active:bg-blue-50 router-link-active:text-blue-500 min-h-[80px] md:min-h-[auto] touch-manipulation"
      >
        <el-icon :size="20"><FolderOpened /></el-icon>
        <span class="text-sm md:text-base">本地战报</span>
      </router-link>
      <!-- 排行榜功能暂时禁用 -->
      <!-- <router-link
        to="/leaderboard"
        class="flex flex-col items-center gap-2 p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] router-link-active:border-blue-500 router-link-active:bg-blue-50 router-link-active:text-blue-500"
      >
        <el-icon><Trophy /></el-icon>
        排行榜
      </router-link> -->
      <router-link
        to="/local-battle"
        class="flex flex-col items-center gap-2 p-4 md:p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] router-link-active:border-blue-500 router-link-active:bg-blue-50 router-link-active:text-blue-500 min-h-[80px] md:min-h-[auto] touch-manipulation"
      >
        <el-icon :size="20"><Monitor /></el-icon>
        <span class="text-sm md:text-base">本地测试</span>
      </router-link>
      <a
        href="https://github.com/arcadia-eternity/arcadia-eternity"
        target="_blank"
        rel="noopener noreferrer"
        class="flex flex-col items-center gap-2 p-4 md:p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] min-h-[80px] md:min-h-[auto] touch-manipulation"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
          />
        </svg>
        <span class="text-sm md:text-base">GitHub</span>
      </a>
    </div>

    <!-- 匹配控制区域 -->
    <div class="mb-6 md:mb-8">
      <button
        @click="handleMatchmaking"
        class="px-8 py-4 md:px-6 md:py-3 text-lg md:text-lg bg-green-500 text-white border-none rounded-lg cursor-pointer transition-colors duration-300 hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed min-h-[48px] touch-manipulation font-medium shadow-lg hover:shadow-xl"
      >
        {{ isMatching ? '取消匹配' : '开始匹配' }}
      </button>

      <!-- 加载状态 -->
      <div v-if="isMatching" class="mt-6 md:mt-5 flex flex-col items-center gap-3 md:gap-2.5">
        <div
          class="w-10 h-10 md:w-8 md:h-8 border-[3px] border-gray-200 border-t-blue-500 rounded-full animate-spin"
        ></div>
        <p class="text-gray-600 text-base md:text-sm">正在寻找对手...</p>
      </div>

      <!-- 错误提示 -->
      <div
        v-if="errorMessage"
        class="text-red-500 mt-4 p-3 md:p-2.5 border border-red-500 rounded-lg bg-red-50 text-sm md:text-base"
      >
        {{ errorMessage }}
      </div>
    </div>

    <!-- 提示信息 -->
    <div class="mt-6 md:mt-8 text-left">
      <el-alert title="使用提示" type="info" :closable="false" class="mb-4">
        <ul class="text-left text-sm md:text-base space-y-1">
          <li>不要忘了先在队伍编辑里面编辑队伍</li>
          <li>目前正在活跃更新中，可能会有一些bug，尽量谅解</li>
          <li>群号：805146068</li>
        </ul>
      </el-alert>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBattleStore } from '@/stores/battle'
import { usePlayerStore } from '@/stores/player'
import { useBattleClientStore } from '@/stores/battleClient'
import { type BattleClient, RemoteBattleSystem } from '@arcadia-eternity/client'
import { User, Document, Monitor, Setting, FolderOpened, Collection } from '@element-plus/icons-vue'

const router = useRouter()
const route = useRoute()
const battleStore = useBattleStore()
const playerStore = usePlayerStore()
const battleClientStore = useBattleClientStore()

// 响应式状态
const isMatching = computed(() => {
  const currentState = battleClientStore.currentState
  const state = currentState.matchmaking === 'searching'
  console.log(
    '🔍 isMatching computed:',
    state,
    'current matchmaking state:',
    currentState.matchmaking,
    'battle state:',
    currentState.battle,
    'full state:',
    currentState,
  )
  return state
})
const errorMessage = ref<string | null>(null)

const handleMatchmaking = async () => {
  try {
    console.log('🎮 handleMatchmaking called, current isMatching:', isMatching.value)
    // 清除之前的错误信息
    errorMessage.value = null

    if (isMatching.value) {
      console.log('❌ Canceling matchmaking')
      try {
        await battleClientStore.cancelMatchmaking()
      } catch (error) {
        console.warn('⚠️ Cancel matchmaking failed (probably already matched):', error)
        // 如果取消失败，可能是因为已经匹配成功了，忽略错误
      }
    } else {
      console.log('🔍 Starting matchmaking for player:', playerStore.player.id)
      await battleClientStore.joinMatchmaking(playerStore.player)
      console.log('✅ Matchmaking request sent, setting up matchSuccess listener')

      battleClientStore.once('matchSuccess', async () => {
        console.log('🎯 matchSuccess event received in lobbyPage')
        if (!battleClientStore._instance) {
          throw new Error('BattleClient instance not available')
        }
        console.log('🏗️ Initializing battle system')
        await battleStore.initBattle(
          new RemoteBattleSystem(battleClientStore._instance as BattleClient),
          playerStore.player.id,
        )
        const currentState = battleClientStore.currentState
        const roomId = currentState.roomId || ''
        console.log('🚀 Navigating to battle page with roomId:', roomId, 'full state:', currentState)
        router.push({
          path: '/battle',
          query: { roomId },
        })
      })
    }
  } catch (error) {
    console.error('💥 Error in handleMatchmaking:', error)
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
      battleClientStore.cancelMatchmaking()
    }
    errorMessage.value = null
  })
})
</script>

<style scoped>
/* 确保页面内容可以正常滚动 */
.lobby-container {
  /* 当内容较少时居中显示，内容较多时允许滚动 */
  justify-content: center;
  /* 在移动端确保有足够的空间 */
  padding-bottom: env(safe-area-inset-bottom, 20px);
}

/* 当内容超出视口时，移除居中对齐 */
@media (max-height: 800px) {
  .lobby-container {
    justify-content: flex-start;
    padding-top: 2rem;
  }
}

/* 移动端触摸优化 */
@media (hover: none) and (pointer: coarse) {
  .touch-manipulation {
    touch-action: manipulation;
  }

  /* 确保触摸目标足够大 */
  .router-link,
  a {
    min-height: 44px;
  }

  button {
    min-height: 44px;
  }
}

/* 移动端特殊优化 */
@media (max-width: 767px) {
  /* 确保在小屏幕上有足够的间距 */
  .grid {
    gap: 12px;
  }

  /* 移动端按钮优化 */
  button {
    font-size: 1rem;
    padding: 16px 32px;
    border-radius: 12px;
  }

  /* 移动端卡片优化 */
  .router-link,
  a {
    border-radius: 12px;
    padding: 16px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .router-link:active,
  a:active {
    transform: scale(0.98);
    transition: transform 0.1s ease;
  }

  /* 移动端提示框优化 */
  .el-alert {
    border-radius: 12px;
  }

  .el-alert ul {
    margin: 0;
    padding-left: 1.2rem;
  }

  .el-alert li {
    margin-bottom: 8px;
    line-height: 1.5;
  }
}

/* 平板端优化 */
@media (min-width: 768px) and (max-width: 1023px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* 确保在所有设备上都有良好的可访问性 */
.router-link:focus,
a:focus,
button:focus {
  outline: 2px solid #409eff;
  outline-offset: 2px;
}

/* 加载动画在移动端的优化 */
@media (max-width: 767px) {
  .animate-spin {
    animation-duration: 1s;
  }

  /* 移动端滚动优化 */
  .lobby-container {
    /* 确保在小屏幕上内容不会被挤压 */
    min-height: auto;
    justify-content: flex-start;
    padding-top: 1rem;
    padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 2rem);
  }
}

/* 修复可能的iOS滚动问题 */
@supports (-webkit-touch-callout: none) {
  .lobby-container {
    -webkit-overflow-scrolling: touch;
  }
}

/* 确保内容不会被固定元素遮挡 */
.lobby-container {
  position: relative;
  z-index: 1;
}
</style>
