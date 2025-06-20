<template>
  <!-- 回合时间部分 -->
  <div
    v-if="type === 'turn' && isEnabled && shouldShowTurnTime"
    class="flex items-center gap-1 text-white font-mono text-sm"
  >
    <span class="text-gray-300">{{ i18next.t('turn-time', { ns: 'battle', defaultValue: '回合:' }) }}</span>
    <span
      class="font-bold transition-colors duration-300"
      :class="{
        'text-green-400': turnTimePercent > 30,
        'text-yellow-400': turnTimePercent <= 30 && turnTimePercent > 10,
        'text-red-400 animate-pulse': turnTimePercent <= 10,
      }"
    >
      {{ formatTime(turnTime) }}
    </span>
    <!-- 状态指示器 -->
    <div
      class="w-2 h-2 rounded-full transition-colors duration-300"
      :class="{
        'bg-green-400': state === TimerState.Running,
        'bg-yellow-400 animate-pulse': state === TimerState.Paused,
        'bg-gray-400': state === TimerState.Stopped,
        'bg-red-400 animate-pulse': state === TimerState.Timeout,
      }"
    ></div>
  </div>

  <!-- 总时间部分 -->
  <div
    v-if="type === 'total' && isEnabled && shouldShowTotalTime"
    class="flex items-center gap-1 text-white font-mono text-sm"
  >
    <div
      class="w-2 h-2 rounded-full transition-colors duration-300"
      :class="{
        'bg-green-400': state === TimerState.Running,
        'bg-yellow-400 animate-pulse': state === TimerState.Paused,
        'bg-gray-400': state === TimerState.Stopped,
        'bg-red-400 animate-pulse': state === TimerState.Timeout,
      }"
    ></div>
    <span class="text-gray-300">{{ i18next.t('total-time', { ns: 'battle', defaultValue: '总计:' }) }}</span>
    <span
      class="font-bold transition-colors duration-300"
      :class="{
        'text-green-400': totalTimePercent > 30,
        'text-yellow-400': totalTimePercent <= 30 && totalTimePercent > 10,
        'text-red-400 animate-pulse': totalTimePercent <= 10,
      }"
    >
      {{ formatTime(totalTime) }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import type { PlayerTimerState, TimerConfig } from '@arcadia-eternity/const'
import { TimerState } from '@arcadia-eternity/const'
import { useBattleStore } from '../stores/battle'
import i18next from 'i18next'

interface Props {
  playerId?: string
  type: 'turn' | 'total'
}

const props = defineProps<Props>()
const battleStore = useBattleStore()

// 响应式数据
const isEnabled = ref(false)
const timerConfig = ref<TimerConfig | null>(null)
const timerState = ref<PlayerTimerState | null>(null)
const updateInterval = ref<ReturnType<typeof setInterval> | null>(null)
const timerEventUnsubscribers = ref<(() => void)[]>([])

// 计算属性
const turnTime = computed(() => timerState.value?.remainingTurnTime || 0)
const totalTime = computed(() => timerState.value?.remainingTotalTime || 0)
const state = computed(() => timerState.value?.state || TimerState.Stopped)

// 判断是否应该显示时间
const shouldShowTurnTime = computed(() => {
  return timerConfig.value?.turnTimeLimit !== undefined
})

const shouldShowTotalTime = computed(() => {
  return timerConfig.value?.totalTimeLimit !== undefined
})

// 计算时间百分比
const turnTimePercent = computed(() => {
  if (!timerConfig.value?.turnTimeLimit) return 100
  return Math.max(0, (turnTime.value / timerConfig.value.turnTimeLimit) * 100)
})

const totalTimePercent = computed(() => {
  if (!timerConfig.value?.totalTimeLimit) return 100
  return Math.max(0, (totalTime.value / timerConfig.value.totalTimeLimit) * 100)
})

// 方法
const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

const updateTimerState = async () => {
  if (!battleStore.battleInterface || !props.playerId) return

  try {
    const enabled = await battleStore.battleInterface.isTimerEnabled()
    isEnabled.value = enabled

    if (!enabled) return

    // 获取配置
    if (!timerConfig.value) {
      timerConfig.value = await battleStore.battleInterface.getTimerConfig()
    }

    // 获取状态
    const state = await battleStore.battleInterface.getPlayerTimerState(props.playerId as any)
    timerState.value = state
  } catch (error) {
    console.warn('Failed to update timer state:', error)
    // 在错误情况下，暂时禁用计时器显示，避免过多的失败请求
    isEnabled.value = false
    timerState.value = null

    // 减少轮询频率
    if (updateInterval.value) {
      clearInterval(updateInterval.value)
      updateInterval.value = setInterval(updateTimerState, 10000) // 增加到10秒
    }
  }
}

const startUpdateLoop = () => {
  if (updateInterval.value) return
  // 减少轮询频率从1秒到2秒，减少服务器负载
  updateInterval.value = setInterval(updateTimerState, 2000)
}

const stopUpdateLoop = () => {
  if (updateInterval.value) {
    clearInterval(updateInterval.value)
    updateInterval.value = null
  }
}

const setupTimerEventListeners = () => {
  if (!battleStore.battleInterface) return

  // 清理之前的监听器
  timerEventUnsubscribers.value.forEach(unsubscribe => unsubscribe())
  timerEventUnsubscribers.value = []

  // 监听计时器开始事件
  const unsubscribeStart = battleStore.battleInterface.onTimerEvent('timerStart', () => {
    updateTimerState()
  })
  timerEventUnsubscribers.value.push(unsubscribeStart)

  // 监听计时器更新事件
  const unsubscribeUpdate = battleStore.battleInterface.onTimerEvent('timerUpdate', data => {
    if (data.player === props.playerId) {
      if (timerState.value) {
        timerState.value.remainingTurnTime = data.remainingTurnTime
        timerState.value.remainingTotalTime = data.remainingTotalTime
      }
    }
  })
  timerEventUnsubscribers.value.push(unsubscribeUpdate)

  // 监听计时器暂停事件
  const unsubscribePause = battleStore.battleInterface.onTimerEvent('timerPause', () => {
    updateTimerState()
  })
  timerEventUnsubscribers.value.push(unsubscribePause)

  // 监听计时器恢复事件
  const unsubscribeResume = battleStore.battleInterface.onTimerEvent('timerResume', () => {
    updateTimerState()
  })
  timerEventUnsubscribers.value.push(unsubscribeResume)

  // 监听计时器超时事件
  const unsubscribeTimeout = battleStore.battleInterface.onTimerEvent('timerTimeout', data => {
    if (data.player === props.playerId) {
      updateTimerState()
    }
  })
  timerEventUnsubscribers.value.push(unsubscribeTimeout)
}

// 生命周期
onMounted(() => {
  updateTimerState()
  startUpdateLoop()
  setupTimerEventListeners()
})

onUnmounted(() => {
  stopUpdateLoop()
  // 清理计时器事件监听器
  timerEventUnsubscribers.value.forEach(unsubscribe => unsubscribe())
  timerEventUnsubscribers.value = []
})

// 监听playerId变化
watch(
  () => props.playerId,
  () => {
    updateTimerState()
  },
)

// 监听battleInterface变化
watch(
  () => battleStore.battleInterface,
  () => {
    setupTimerEventListeners()
  },
)
</script>
