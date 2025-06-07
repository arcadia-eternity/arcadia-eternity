<template>
  <div
    v-if="isEnabled && (shouldShowTurnTime || shouldShowTotalTime)"
    class="bg-black/80 rounded-lg p-4 text-white font-mono min-w-[200px]"
  >
    <div class="flex flex-col gap-3">
      <!-- 回合计时器 -->
      <div v-if="shouldShowTurnTime" class="flex flex-col gap-1">
        <div class="text-xs text-gray-300 uppercase tracking-wide">回合时间</div>
        <div
          class="text-lg font-bold transition-colors duration-300"
          :class="{
            'text-green-400': turnTimePercent > 30,
            'text-yellow-400': turnTimePercent <= 30 && turnTimePercent > 10,
            'text-red-400 animate-pulse': turnTimePercent <= 10,
          }"
        >
          {{ formatTime(turnTime) }}
        </div>
        <div class="h-1 bg-white/20 rounded-full overflow-hidden">
          <div
            class="h-full transition-all duration-500 ease-out"
            :style="{ width: `${turnTimePercent}%` }"
            :class="{
              'bg-green-400': turnTimePercent > 30,
              'bg-yellow-400': turnTimePercent <= 30 && turnTimePercent > 10,
              'bg-red-400': turnTimePercent <= 10,
            }"
          ></div>
        </div>
      </div>

      <!-- 总计时器 -->
      <div v-if="shouldShowTotalTime" class="flex flex-col gap-1">
        <div class="text-xs text-gray-300 uppercase tracking-wide">总时间</div>
        <div
          class="text-lg font-bold transition-colors duration-300"
          :class="{
            'text-green-400': totalTimePercent > 30,
            'text-yellow-400': totalTimePercent <= 30 && totalTimePercent > 10,
            'text-red-400 animate-pulse': totalTimePercent <= 10,
          }"
        >
          {{ formatTime(totalTime) }}
        </div>
        <div class="h-1 bg-white/20 rounded-full overflow-hidden">
          <div
            class="h-full transition-all duration-500 ease-out"
            :style="{ width: `${totalTimePercent}%` }"
            :class="{
              'bg-green-400': totalTimePercent > 30,
              'bg-yellow-400': totalTimePercent <= 30 && totalTimePercent > 10,
              'bg-red-400': totalTimePercent <= 10,
            }"
          ></div>
        </div>
      </div>

      <!-- 计时器状态 -->
      <div class="flex flex-col gap-1 items-center">
        <div
          class="text-xs px-2 py-1 rounded uppercase tracking-wide"
          :class="{
            'bg-green-600 text-white': state === TimerState.Running,
            'bg-yellow-600 text-white': state === TimerState.Paused,
            'bg-gray-600 text-white': state === TimerState.Stopped,
            'bg-red-600 text-white': state === TimerState.Timeout,
          }"
        >
          {{ getStateText(state) }}
        </div>
        <div v-if="isPaused" class="text-xs text-gray-400 italic">
          {{ getPauseReasonText(pauseReason) }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import type { PlayerTimerState, TimerConfig } from '@arcadia-eternity/const'
import { TimerState } from '@arcadia-eternity/const'
import { useBattleStore } from '../stores/battle'

interface Props {
  playerId?: string
}

const props = defineProps<Props>()
const battleStore = useBattleStore()

// 响应式数据
const isEnabled = ref(false)
const timerConfig = ref<TimerConfig | null>(null)
const timerState = ref<PlayerTimerState | null>(null)
const pauseReason = ref<string>('')
const updateInterval = ref<ReturnType<typeof setInterval> | null>(null)

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

const turnTimePercent = computed(() => {
  if (!timerConfig.value || !timerState.value || !timerConfig.value.turnTimeLimit) return 100
  return Math.max(0, (turnTime.value / timerConfig.value.turnTimeLimit) * 100)
})

const totalTimePercent = computed(() => {
  if (!timerConfig.value || !timerState.value || !timerConfig.value.totalTimeLimit) return 100
  return Math.max(0, (totalTime.value / timerConfig.value.totalTimeLimit) * 100)
})

const isPaused = computed(() => state.value === TimerState.Paused)

// 方法
const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

const getStateText = (state: string): string => {
  const stateTexts: Record<string, string> = {
    stopped: '已停止',
    running: '运行中',
    paused: '已暂停',
    timeout: '已超时',
  }
  return stateTexts[state] || state
}

const getPauseReasonText = (reason: string): string => {
  const reasonTexts: Record<string, string> = {
    animation: '动画播放中',
    system: '系统暂停',
  }
  return reasonTexts[reason] || reason
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
  }
}

const startUpdateLoop = () => {
  if (updateInterval.value) return

  updateInterval.value = setInterval(updateTimerState, 1000)
}

const stopUpdateLoop = () => {
  if (updateInterval.value) {
    clearInterval(updateInterval.value)
    updateInterval.value = null
  }
}

// 计时器事件处理器
const timerEventUnsubscribers = ref<(() => void)[]>([])

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
  const unsubscribePause = battleStore.battleInterface.onTimerEvent('timerPause', data => {
    pauseReason.value = data.reason
    if (timerState.value) {
      timerState.value.state = TimerState.Paused
    }
  })
  timerEventUnsubscribers.value.push(unsubscribePause)

  // 监听计时器恢复事件
  const unsubscribeResume = battleStore.battleInterface.onTimerEvent('timerResume', () => {
    if (timerState.value) {
      timerState.value.state = TimerState.Running
    }
  })
  timerEventUnsubscribers.value.push(unsubscribeResume)

  // 监听计时器超时事件
  const unsubscribeTimeout = battleStore.battleInterface.onTimerEvent('timerTimeout', data => {
    if (data.player === props.playerId) {
      if (timerState.value) {
        timerState.value.state = TimerState.Timeout
      }
    }
  })
  timerEventUnsubscribers.value.push(unsubscribeTimeout)
}

// 生命周期
onMounted(() => {
  updateTimerState()
  startUpdateLoop()

  // 设置计时器事件监听器
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
