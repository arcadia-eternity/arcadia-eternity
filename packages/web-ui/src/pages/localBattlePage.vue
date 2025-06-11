<template>
  <div class="max-w-4xl w-full mx-auto p-6 min-h-[calc(100vh-60px)] flex flex-col justify-start gap-6">
    <h1 class="text-3xl font-bold text-center text-gray-800">本地对战测试</h1>

    <!-- 战斗配置面板 -->
    <div class="bg-gray-50 rounded-lg p-6 shadow-lg border border-gray-200">
      <h2 class="text-xl font-semibold text-center text-gray-700 mb-6">战斗配置</h2>

      <!-- 队伍选择配置 -->
      <div class="mb-6 p-4 bg-white rounded-md border border-gray-200">
        <h3 class="text-lg font-medium text-gray-600 mb-4 pb-2 border-b-2 border-green-500">队伍选择</h3>

        <!-- 玩家1队伍选择 -->
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-600 mb-2">玩家1队伍:</label>
          <select
            v-model="selectedPlayer1TeamIndex"
            class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option v-for="(team, index) in availableTeams" :key="index" :value="petStorage.teams.indexOf(team)">
              {{ team.name }} ({{ team.pets.length }}只精灵)
            </option>
          </select>
        </div>

        <!-- 玩家2队伍选择 -->
        <div class="mb-3">
          <label class="block text-sm font-medium text-gray-600 mb-2">玩家2队伍:</label>
          <select
            v-model="selectedPlayer2TeamIndex"
            class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option v-for="(team, index) in availableTeams" :key="index" :value="petStorage.teams.indexOf(team)">
              {{ team.name }} ({{ team.pets.length }}只精灵)
            </option>
          </select>
        </div>
      </div>

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
        <!-- 暂时隐藏显示隐藏信息选项 -->
        <!-- <div class="mb-3 flex items-center">
          <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              v-model="battleConfig.showHidden"
              class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
            />
            显示隐藏信息
          </label>
        </div> -->
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useBattleStore } from '@/stores/battle'
import { usePlayerStore } from '@/stores/player'
import { usePetStorageStore } from '@/stores/petStorage'
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
const petStorage = usePetStorageStore()
const dataStore = useGameDataStore()
const errorMessage = ref<string | null>(null)
const isLoading = ref(true)

// 队伍选择
const selectedPlayer1TeamIndex = ref(0)
const selectedPlayer2TeamIndex = ref(0)

// 可用队伍列表（过滤掉空队伍）
const availableTeams = computed(() => {
  return petStorage.teams.filter(team => team.pets.length > 0)
})

// 初始化队伍选择的函数
const initializeTeamSelection = () => {
  // 设置玩家1为当前队伍
  selectedPlayer1TeamIndex.value = petStorage.currentTeamIndex

  // 设置玩家2为不同的队伍（如果有的话）
  const validTeams = availableTeams.value
  if (validTeams.length > 1) {
    // 找到第一个不同于玩家1的队伍
    const differentTeamIndex = petStorage.teams.findIndex(
      (team, index) => index !== selectedPlayer1TeamIndex.value && team.pets.length > 0,
    )
    selectedPlayer2TeamIndex.value = differentTeamIndex >= 0 ? differentTeamIndex : 0
  } else {
    selectedPlayer2TeamIndex.value = selectedPlayer1TeamIndex.value
  }
}

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

// 创建对手队伍数据
const createOpponentTeam = (teamIndex: number) => {
  const selectedTeam = petStorage.teams[teamIndex]
  if (!selectedTeam) {
    throw new Error('选择的队伍不存在')
  }

  return {
    name: `${selectedTeam.name} (AI)`,
    id: nanoid(),
    team: selectedTeam.pets.map(pet => ({
      ...pet,
      name: `${pet.name} (AI)`,
      id: nanoid(),
    })),
  }
}

// 初始化HTTP加载器
onMounted(async () => {
  // 初始化队伍选择
  initializeTeamSelection()

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
  // 防止重复点击
  if (isLoading.value) {
    return
  }

  isLoading.value = true
  errorMessage.value = null

  try {
    // 验证游戏数据是否已加载
    if (!dataStore.gameDataLoaded) {
      throw new Error('游戏数据尚未加载完成，请稍后再试')
    }

    // 验证队伍选择
    if (availableTeams.value.length === 0) {
      throw new Error('没有可用的队伍，请先在队伍编辑器中创建队伍')
    }

    const player1Team = petStorage.teams[selectedPlayer1TeamIndex.value]
    const player2Team = petStorage.teams[selectedPlayer2TeamIndex.value]

    if (!player1Team || player1Team.pets.length === 0) {
      throw new Error('玩家1队伍为空或不存在，请选择有效的队伍')
    }

    if (!player2Team || player2Team.pets.length === 0) {
      throw new Error('玩家2队伍为空或不存在，请选择有效的队伍')
    }

    // 获取玩家1数据
    const rawPlayer1Data = {
      name: playerStore.name,
      id: playerStore.id,
      team: player1Team.pets,
    }

    // 验证玩家1队伍中的精灵数据
    for (const pet of rawPlayer1Data.team) {
      if (!pet.name || !pet.species) {
        throw new Error(`玩家1精灵 "${pet.name || '未命名'}" 的数据不完整，请检查种族配置`)
      }
      if (!pet.skills || pet.skills.length === 0) {
        throw new Error(`玩家1精灵 "${pet.name}" 没有配置技能，请至少配置一个技能`)
      }
    }

    // 验证玩家2队伍中的精灵数据
    for (const pet of player2Team.pets) {
      if (!pet.name || !pet.species) {
        throw new Error(`玩家2精灵 "${pet.name || '未命名'}" 的数据不完整，请检查种族配置`)
      }
      if (!pet.skills || pet.skills.length === 0) {
        throw new Error(`玩家2精灵 "${pet.name}" 没有配置技能，请至少配置一个技能`)
      }
    }

    let player1: Player
    let player2: Player

    try {
      // 解析玩家1数据
      player1 = PlayerParser.parse(rawPlayer1Data)
    } catch (parseError) {
      throw new Error(`玩家1数据解析失败: ${(parseError as Error).message}`)
    }

    try {
      // 创建玩家2队伍数据并解析
      const player2TeamData = createOpponentTeam(selectedPlayer2TeamIndex.value)
      const createAIPlayer = (basePlayer: Player) => new AIPlayer(basePlayer.name, basePlayer.id, basePlayer.team)
      player2 = createAIPlayer(PlayerParser.parse(player2TeamData))
    } catch (parseError) {
      throw new Error(`玩家2队伍数据解析失败: ${(parseError as Error).message}`)
    }

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

    // 创建战斗实例
    let battle: Battle
    try {
      battle = new Battle(player1, player2, battleOptions)
    } catch (battleError) {
      throw new Error(`战斗创建失败: ${(battleError as Error).message}`)
    }

    // 创建本地战斗系统
    const localSystem = new LocalBattleSystem(battle)

    try {
      await battleStore.initBattle(localSystem, player1.id)
    } catch (initError) {
      throw new Error(`战斗初始化失败: ${(initError as Error).message}`)
    }

    // 跳转到战斗页面
    router.push('/battle?dev=true')
  } catch (error) {
    console.error('本地对战启动失败:', error)
    errorMessage.value = (error as Error).message

    // 5秒后清除错误信息
    setTimeout(() => {
      if (errorMessage.value === (error as Error).message) {
        errorMessage.value = null
      }
    }, 5000)
  } finally {
    isLoading.value = false
  }
}
</script>
