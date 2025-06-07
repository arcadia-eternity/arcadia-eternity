<template>
  <div
    class="max-w-4xl w-full mx-auto p-5 text-center min-h-[calc(100vh-60px)] box-border flex flex-col justify-center"
  >
    <h1 class="text-3xl font-bold mb-8 text-gray-800">对战匹配大厅</h1>

    <!-- 导航菜单 -->
    <div class="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4 my-8 mx-auto max-w-2xl">
      <router-link
        to="/team-builder"
        class="flex flex-col items-center gap-2 p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] router-link-active:border-blue-500 router-link-active:bg-blue-50 router-link-active:text-blue-500"
      >
        <el-icon><User /></el-icon>
        队伍编辑
      </router-link>
      <router-link
        to="/battle-reports"
        class="flex flex-col items-center gap-2 p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] router-link-active:border-blue-500 router-link-active:bg-blue-50 router-link-active:text-blue-500"
      >
        <el-icon><Document /></el-icon>
        战报记录
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
        class="flex flex-col items-center gap-2 p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] router-link-active:border-blue-500 router-link-active:bg-blue-50 router-link-active:text-blue-500"
      >
        <el-icon><Monitor /></el-icon>
        本地测试
      </router-link>
    </div>

    <!-- 匹配控制区域 -->
    <div class="mb-8">
      <button
        @click="handleMatchmaking"
        class="px-6 py-3 text-lg bg-green-500 text-white border-none rounded cursor-pointer transition-colors duration-300 hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
      >
        {{ isMatching ? '取消匹配' : '开始匹配' }}
      </button>

      <!-- 加载状态 -->
      <div v-if="isMatching" class="mt-5 flex flex-col items-center gap-2.5">
        <div class="w-8 h-8 border-[3px] border-gray-200 border-t-blue-500 rounded-full animate-spin"></div>
        <p class="text-gray-600">正在寻找对手...</p>
      </div>

      <!-- 错误提示 -->
      <div v-if="errorMessage" class="text-red-500 mt-4 p-2.5 border border-red-500 rounded bg-red-50">
        {{ errorMessage }}
      </div>
    </div>

    <!-- 提示信息 -->
    <div class="mt-8 text-left">
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
import { ref, computed, onBeforeUnmount, onMounted, nextTick } from 'vue'
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
