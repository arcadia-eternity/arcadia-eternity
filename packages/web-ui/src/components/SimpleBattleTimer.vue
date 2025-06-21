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
import type { PlayerTimerState, TimerConfig, TimerSnapshot } from '@arcadia-eternity/const'
import { TimerState } from '@arcadia-eternity/const'
import { useBattleStore } from '../stores/battle'
import { LocalTimerCalculator } from '../timer/localTimerCalculator'
import i18next from 'i18next'

interface Props {
  playerId?: string
  type: 'turn' | 'total'
}

const props = defineProps<Props>()
const battleStore = useBattleStore()

// 新架构：使用LocalTimerCalculator
const localTimerCalculator = ref<LocalTimerCalculator | null>(null)
const timerSnapshot = ref<TimerSnapshot | null>(null)
const timerEventUnsubscribers = ref<(() => void)[]>([])

// 计算属性 - 基于TimerSnapshot
const isEnabled = computed(() => timerSnapshot.value?.config.enabled || false)
const timerConfig = computed(() => timerSnapshot.value?.config || null)
const turnTime = computed(() => timerSnapshot.value?.remainingTurnTime || 0)
const totalTime = computed(() => timerSnapshot.value?.remainingTotalTime || 0)
const state = computed(() => timerSnapshot.value?.state || TimerState.Stopped)

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

// 新架构：初始化LocalTimerCalculator
const initializeTimerCalculator = () => {
  if (localTimerCalculator.value) {
    localTimerCalculator.value.cleanup()
  }

  localTimerCalculator.value = new LocalTimerCalculator()

  // 监听指定玩家的Timer更新
  if (props.playerId) {
    const unsubscribe = localTimerCalculator.value.onPlayerTimerUpdate(
      props.playerId as any,
      (snapshot: TimerSnapshot) => {
        timerSnapshot.value = snapshot
      },
    )
    timerEventUnsubscribers.value.push(unsubscribe)
  }
}

// 清理LocalTimerCalculator
const cleanupTimerCalculator = () => {
  if (localTimerCalculator.value) {
    localTimerCalculator.value.cleanup()
    localTimerCalculator.value = null
  }
}

const setupTimerEventListeners = () => {
  if (!battleStore.battleInterface || !localTimerCalculator.value) return

  // 清理之前的监听器（除了LocalTimerCalculator的监听器）
  const calculatorUnsubscribers = timerEventUnsubscribers.value.slice() // 保存LocalTimerCalculator的监听器
  timerEventUnsubscribers.value = calculatorUnsubscribers

  // 新架构：监听Timer快照事件
  const unsubscribeSnapshot = battleStore.battleInterface.onTimerEvent('timerSnapshot', (data: any) => {
    if (data.snapshots && localTimerCalculator.value) {
      localTimerCalculator.value.updateSnapshots(data.snapshots)
    }
  })
  timerEventUnsubscribers.value.push(unsubscribeSnapshot)

  // 保持对传统事件的兼容性监听（用于调试和备用）
  const unsubscribeStart = battleStore.battleInterface.onTimerEvent('timerStart', () => {
    console.debug('Timer started - waiting for snapshot update')
  })
  timerEventUnsubscribers.value.push(unsubscribeStart)

  const unsubscribeTimeout = battleStore.battleInterface.onTimerEvent('timerTimeout', (data: any) => {
    if (data.player === props.playerId) {
      console.debug('Timer timeout for player:', props.playerId)
    }
  })
  timerEventUnsubscribers.value.push(unsubscribeTimeout)
}

// 生命周期
onMounted(() => {
  initializeTimerCalculator()
  setupTimerEventListeners()
})

onUnmounted(() => {
  // 清理所有资源
  cleanupTimerCalculator()
  timerEventUnsubscribers.value.forEach(unsubscribe => unsubscribe())
  timerEventUnsubscribers.value = []
})

// 监听playerId变化
watch(
  () => props.playerId,
  () => {
    // 重新初始化Timer计算器以监听新的玩家
    initializeTimerCalculator()
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
