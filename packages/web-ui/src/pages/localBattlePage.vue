<template>
  <div class="max-w-4xl w-full mx-auto p-6 min-h-[calc(100vh-60px)] flex flex-col justify-start gap-6">
    <h1 class="text-3xl font-bold text-center text-gray-800">本地对战测试</h1>

    <!-- 战斗配置面板 -->
    <div class="bg-gray-50 rounded-lg p-6 shadow-lg border border-gray-200">
      <h2 class="text-xl font-semibold text-center text-gray-700 mb-6">战斗配置</h2>

      <!-- 基础配置 -->
      <div class="mb-6 p-4 bg-white rounded-md border border-gray-200">
        <h3 class="text-lg font-medium text-gray-600 mb-4 pb-2 border-b-2 border-blue-500">基础设置</h3>
        <div class="mb-3 flex items-center">
          <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              v-model="battleConfig.allowFaintSwitch"
              class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
            />
            允许击破奖励切换
          </label>
        </div>
        <div class="mb-3 flex items-center">
          <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              v-model="battleConfig.showHidden"
              class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
            />
            显示隐藏信息
          </label>
        </div>
        <div class="mb-3 flex items-center">
          <label class="flex items-center gap-2 text-sm text-gray-600">
            随机数种子 (可选):
            <input
              type="number"
              v-model.number="battleConfig.rngSeed"
              placeholder="留空使用随机种子"
              class="ml-2 px-3 py-1.5 border border-gray-300 rounded-md text-sm w-32 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </label>
        </div>
      </div>

      <!-- 计时器配置 -->
      <div class="mb-6 p-4 bg-white rounded-md border border-gray-200">
        <h3 class="text-lg font-medium text-gray-600 mb-4 pb-2 border-b-2 border-blue-500">计时器设置</h3>
        <div class="mb-3 flex items-center">
          <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              v-model="timerConfig.enabled"
              class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
            />
            启用计时器系统
          </label>
        </div>

        <template v-if="timerConfig.enabled">
          <div class="mb-3 flex items-center">
            <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                v-model="enableTurnTimeLimit"
                class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
              />
              启用每回合时间限制
            </label>
          </div>
          <div v-if="enableTurnTimeLimit" class="mb-3 flex items-center">
            <label class="flex items-center gap-2 text-sm text-gray-600">
              每回合时间限制 (秒):
              <input
                type="number"
                v-model.number="timerConfig.turnTimeLimit"
                min="5"
                max="300"
                class="ml-2 px-3 py-1.5 border border-gray-300 rounded-md text-sm w-32 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </label>
          </div>
          <div class="mb-3 flex items-center">
            <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                v-model="enableTotalTimeLimit"
                class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
              />
              启用总思考时间限制
            </label>
          </div>
          <div v-if="enableTotalTimeLimit" class="mb-3 flex items-center">
            <label class="flex items-center gap-2 text-sm text-gray-600">
              总思考时间限制 (秒):
              <input
                type="number"
                v-model.number="timerConfig.totalTimeLimit"
                min="60"
                max="3600"
                class="ml-2 px-3 py-1.5 border border-gray-300 rounded-md text-sm w-32 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </label>
          </div>
          <div class="mb-3 flex items-center">
            <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                v-model="timerConfig.animationPauseEnabled"
                class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
              />
              动画期间暂停计时器
            </label>
          </div>
          <div class="mb-3 flex items-center">
            <label class="flex items-center gap-2 text-sm text-gray-600">
              最大动画时长 (毫秒):
              <input
                type="number"
                v-model.number="timerConfig.maxAnimationDuration"
                min="1000"
                max="60000"
                class="ml-2 px-3 py-1.5 border border-gray-300 rounded-md text-sm w-32 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </label>
          </div>
        </template>
      </div>

      <!-- 预设配置按钮 -->
      <div class="flex gap-3 justify-center mt-6 pt-6 border-t border-gray-200">
        <button
          @click="loadPreset('default')"
          class="px-4 py-2 text-sm bg-gray-100 text-gray-700 border border-gray-300 rounded-md cursor-pointer transition-all duration-200 hover:bg-gray-200 hover:border-gray-400"
        >
          默认配置
        </button>
        <button
          @click="loadPreset('fast')"
          class="px-4 py-2 text-sm bg-gray-100 text-gray-700 border border-gray-300 rounded-md cursor-pointer transition-all duration-200 hover:bg-gray-200 hover:border-gray-400"
        >
          快速对战
        </button>
        <button
          @click="loadPreset('competitive')"
          class="px-4 py-2 text-sm bg-gray-100 text-gray-700 border border-gray-300 rounded-md cursor-pointer transition-all duration-200 hover:bg-gray-200 hover:border-gray-400"
        >
          竞技模式
        </button>
      </div>
    </div>

    <!-- 对战控制区域 -->
    <div class="text-center">
      <button
        @click="startLocalBattle"
        :disabled="isLoading"
        class="px-6 py-3 text-lg font-medium text-white bg-blue-500 border-none rounded-md cursor-pointer transition-colors duration-200 hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
      >
        {{ isLoading ? '资源加载中...' : '开始本地对战' }}
      </button>

      <!-- 错误提示 -->
      <div v-if="errorMessage" class="mt-4 p-3 text-red-600 border border-red-400 rounded-md bg-red-50">
        {{ errorMessage }}
      </div>
    </div>

    <p class="text-gray-600">挑战的是队伍的镜像</p>
    <p class="text-gray-600">未来可能会扩展更多玩法……大概吧</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBattleStore } from '@/stores/battle'
import { usePlayerStore } from '@/stores/player'
import { LocalBattleSystem } from '@arcadia-eternity/local-adapter'
import { HttpLoader } from '@arcadia-eternity/httploader'
import { AIPlayer, Battle, Player } from '@arcadia-eternity/battle'
import { PlayerParser } from '@arcadia-eternity/parser'
import { nanoid } from 'nanoid'
import { useGameDataStore } from '@/stores/gameData'
import { DEFAULT_TIMER_CONFIG, type TimerConfig } from '@arcadia-eternity/const'

const router = useRouter()
const battleStore = useBattleStore()
const playerStore = usePlayerStore()
const dataStore = useGameDataStore()
const errorMessage = ref<string | null>(null)
const isLoading = ref(true)

// 战斗配置
interface BattleConfig {
  allowFaintSwitch: boolean
  showHidden: boolean
  rngSeed?: number
}

const battleConfig = reactive<BattleConfig>({
  allowFaintSwitch: true,
  showHidden: true,
  rngSeed: undefined,
})

// 计时器配置
const timerConfig = reactive<TimerConfig>({
  ...DEFAULT_TIMER_CONFIG,
})

// 时间限制启用状态
const enableTurnTimeLimit = ref(!!DEFAULT_TIMER_CONFIG.turnTimeLimit)
const enableTotalTimeLimit = ref(!!DEFAULT_TIMER_CONFIG.totalTimeLimit)

// 监听时间限制启用状态变化
watch(enableTurnTimeLimit, enabled => {
  if (!enabled) {
    timerConfig.turnTimeLimit = undefined
  } else if (!timerConfig.turnTimeLimit) {
    timerConfig.turnTimeLimit = 30 // 默认30秒
  }
})

watch(enableTotalTimeLimit, enabled => {
  if (!enabled) {
    timerConfig.totalTimeLimit = undefined
  } else if (!timerConfig.totalTimeLimit) {
    timerConfig.totalTimeLimit = 1500 // 默认25分钟
  }
})

// 预设配置
const presets = {
  default: {
    battle: {
      allowFaintSwitch: true,
      showHidden: true,
      rngSeed: undefined,
    },
    timer: {
      ...DEFAULT_TIMER_CONFIG,
    },
    enableTurnTimeLimit: !!DEFAULT_TIMER_CONFIG.turnTimeLimit,
    enableTotalTimeLimit: !!DEFAULT_TIMER_CONFIG.totalTimeLimit,
  },
  fast: {
    battle: {
      allowFaintSwitch: true,
      showHidden: true,
      rngSeed: undefined,
    },
    timer: {
      ...DEFAULT_TIMER_CONFIG,
      enabled: true,
      turnTimeLimit: 15, // 快速模式：15秒每回合
      totalTimeLimit: 300, // 5分钟总时间
      animationPauseEnabled: false, // 不暂停动画
    },
    enableTurnTimeLimit: true,
    enableTotalTimeLimit: true,
  },
  competitive: {
    battle: {
      allowFaintSwitch: true,
      showHidden: false, // 竞技模式不显示隐藏信息
      rngSeed: undefined,
    },
    timer: {
      ...DEFAULT_TIMER_CONFIG,
      enabled: true,
      turnTimeLimit: 30, // 竞技模式：30秒每回合
      totalTimeLimit: 900, // 15分钟总时间
      animationPauseEnabled: true,
    },
    enableTurnTimeLimit: true,
    enableTotalTimeLimit: true,
  },
}

// 加载预设配置
const loadPreset = (presetName: keyof typeof presets) => {
  const preset = presets[presetName]

  // 更新战斗配置
  Object.assign(battleConfig, preset.battle)

  // 更新计时器配置
  Object.assign(timerConfig, preset.timer)

  // 更新时间限制启用状态
  enableTurnTimeLimit.value = preset.enableTurnTimeLimit
  enableTotalTimeLimit.value = preset.enableTotalTimeLimit
}

// 生成镜像队伍
const createMirrorTeam = () => {
  const originalPlayer = playerStore.player
  return {
    ...originalPlayer,
    name: '镜像对手',
    id: nanoid(),
    team: originalPlayer.team.map(pet => ({
      ...pet,
      name: `${pet.name}-镜像`,
      id: nanoid(),
    })),
  }
}

// 初始化HTTP加载器
onMounted(async () => {
  if (dataStore.gameDataLoaded) {
    isLoading.value = false
    return
  }
  try {
    const loader = new HttpLoader({
      baseUrl: import.meta.env.VITE_DATA_API_URL || '/data',
    })
    await loader.loadGameData()
    try {
      console.log('📝 Web端脚本加载功能开发中...')
      console.log('� 当前使用YAML数据，脚本声明功能在服务器端可用')
    } catch (scriptError) {
      console.warn('⚠️ 脚本加载失败，继续使用YAML数据:', scriptError)
    }

    dataStore.gameDataLoaded = true
  } catch (error) {
    errorMessage.value = `资源加载失败: ${(error as Error).message}`
  } finally {
    isLoading.value = false
  }
})

const startLocalBattle = async () => {
  try {
    const createAIPlayer = (basePlayer: Player) => new AIPlayer(basePlayer.name, basePlayer.id, basePlayer.team)
    const player1 = PlayerParser.parse(playerStore.player)
    const player2 = createAIPlayer(PlayerParser.parse(createMirrorTeam()))

    // 构建战斗选项
    const battleOptions: {
      allowFaintSwitch?: boolean
      rngSeed?: number
      showHidden?: boolean
      timerConfig?: Partial<TimerConfig>
    } = {
      allowFaintSwitch: battleConfig.allowFaintSwitch,
      showHidden: battleConfig.showHidden,
    }

    // 添加随机数种子（如果设置了）
    if (battleConfig.rngSeed !== undefined && battleConfig.rngSeed !== null) {
      battleOptions.rngSeed = battleConfig.rngSeed
    }

    // 添加计时器配置
    battleOptions.timerConfig = { ...timerConfig }

    const battle = new Battle(player1, player2, battleOptions)
    const localSystem = new LocalBattleSystem(battle)
    await battleStore.initBattle(localSystem, player1.id)
    router.push('/battle')
  } catch (error) {
    errorMessage.value = (error as Error).message
    setTimeout(() => (errorMessage.value = null), 3000)
  }
}
</script>
