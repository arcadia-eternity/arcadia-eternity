<template>
  <div class="max-w-4xl w-full mx-auto p-6 min-h-[calc(100vh-60px)] flex flex-col justify-start gap-6">
    <h1 class="text-3xl font-bold text-center text-gray-800">本地对战测试</h1>

    <div
      v-if="workbenchLaunchPayload"
      class="bg-blue-50 border border-blue-200 rounded-md px-4 py-3 text-sm text-blue-800"
    >
      已载入组合工作台配置：关联资源 {{ workbenchLaunchPayload.resources.length }} 个。
    </div>

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
          <!-- <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              v-model="useAI"
              class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
            />
            允许AI接管
          </label> -->
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

      <!-- 团队选择配置 -->
      <div class="bg-white p-6 rounded-lg shadow-md">
        <h3 class="text-lg font-semibold text-gray-800 mb-4">团队选择配置</h3>

        <div class="mb-3 flex items-center">
          <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              v-model="battleConfig.teamSelection.enabled"
              class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
            />
            启用团队选择
          </label>
        </div>

        <template v-if="battleConfig.teamSelection.enabled">
          <div class="mb-3">
            <label class="block text-sm text-gray-600 mb-1">选择模式:</label>
            <select
              v-model="battleConfig.teamSelection.mode"
              class="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="VIEW_ONLY">仅查看模式</option>
              <option value="TEAM_SELECTION">团队选择模式</option>
              <option value="FULL_TEAM">全队参战模式</option>
            </select>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-sm text-gray-600 mb-1">最大队伍大小:</label>
              <input
                type="number"
                v-model.number="battleConfig.teamSelection.maxTeamSize"
                min="1"
                max="12"
                class="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label class="block text-sm text-gray-600 mb-1">最小队伍大小:</label>
              <input
                type="number"
                v-model.number="battleConfig.teamSelection.minTeamSize"
                min="1"
                :max="battleConfig.teamSelection.maxTeamSize"
                class="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          <div class="mb-3">
            <label class="block text-sm text-gray-600 mb-1">选择时间限制 (秒):</label>
            <input
              type="number"
              v-model.number="battleConfig.teamSelection.timeLimit"
              min="10"
              max="300"
              class="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div class="mb-3 flex items-center">
            <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                v-model="battleConfig.teamSelection.allowStarterSelection"
                class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
              />
              允许选择首发精灵
            </label>
          </div>

          <div class="mb-3 flex items-center">
            <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                v-model="battleConfig.teamSelection.showOpponentTeam"
                class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
              />
              显示对手队伍
            </label>
          </div>

          <div class="mb-3">
            <label class="block text-sm text-gray-600 mb-1">队伍信息可见性:</label>
            <select
              v-model="battleConfig.teamSelection.teamInfoVisibility"
              class="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="HIDDEN">隐藏</option>
              <option value="BASIC">基础信息</option>
              <option value="FULL">完整信息</option>
            </select>
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
        <button
          @click="loadPreset('teamSelection')"
          class="px-4 py-2 text-sm bg-green-100 text-green-700 border border-green-300 rounded-md cursor-pointer transition-all duration-200 hover:bg-green-200 hover:border-green-400"
        >
          团队选择测试
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
import { ref, onMounted, reactive, watch, computed, toRaw } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBattleStore } from '@/stores/battle'
import { usePlayerStore } from '@/stores/player'
import { usePetStorageStore } from '@/stores/petStorage'
import { LocalBattleSystemV2, createBattleFromConfig, createRepositoryFromRawData } from '@arcadia-eternity/battle'
import type { TeamConfig, BattleConfig as V2BattleConfig } from '@arcadia-eternity/battle'
import { useGameDataStore } from '@/stores/gameData'
import { DEFAULT_TIMER_CONFIG, type TimerConfig } from '@arcadia-eternity/const'
import { readBattleWorkbenchLaunch, type BattleWorkbenchLaunchPayload } from '@/utils/battleWorkbenchLaunch'

const router = useRouter()
const route = useRoute()
const battleStore = useBattleStore()
const playerStore = usePlayerStore()
const petStorage = usePetStorageStore()
const dataStore = useGameDataStore()
const errorMessage = ref<string | null>(null)
const isLoading = ref(true)
const workbenchLaunchPayload = ref<BattleWorkbenchLaunchPayload | null>(null)

// 队伍选择
const selectedPlayer1TeamIndex = ref(0)
const selectedPlayer2TeamIndex = ref(0)

// 可用队伍列表（过滤掉空队伍）
const availableTeams = computed(() => {
  return petStorage.teams.filter(team => team.pets.length > 0)
})

const validTeamIndexSet = computed(() => {
  const output = new Set<number>()
  petStorage.teams.forEach((team, index) => {
    if (team.pets.length > 0) {
      output.add(index)
    }
  })
  return output
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

function parseQueryBoolean(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return value === '1' || value.toLowerCase() === 'true'
}

function applyWorkbenchLaunchPayload(payload: BattleWorkbenchLaunchPayload): void {
  workbenchLaunchPayload.value = payload

  if (validTeamIndexSet.value.has(payload.selectedPlayer1TeamIndex)) {
    selectedPlayer1TeamIndex.value = payload.selectedPlayer1TeamIndex
  }
  if (validTeamIndexSet.value.has(payload.selectedPlayer2TeamIndex)) {
    selectedPlayer2TeamIndex.value = payload.selectedPlayer2TeamIndex
  }

  battleConfig.allowFaintSwitch = payload.battleConfig.allowFaintSwitch
  battleConfig.showHidden = payload.battleConfig.showHidden
  battleConfig.rngSeed = payload.battleConfig.rngSeed
  battleConfig.teamSelection = {
    ...payload.battleConfig.teamSelection,
  }

  Object.assign(timerConfig, {
    ...DEFAULT_TIMER_CONFIG,
    ...payload.timerConfig,
  })

  enableTurnTimeLimit.value = typeof timerConfig.turnTimeLimit === 'number'
  enableTotalTimeLimit.value = typeof timerConfig.totalTimeLimit === 'number'
}

// 战斗配置
interface BattleConfig {
  allowFaintSwitch: boolean
  showHidden: boolean
  rngSeed?: number
  teamSelection: {
    enabled: boolean
    mode: 'VIEW_ONLY' | 'TEAM_SELECTION' | 'FULL_TEAM'
    maxTeamSize: number
    minTeamSize: number
    allowStarterSelection: boolean
    showOpponentTeam: boolean
    teamInfoVisibility: 'HIDDEN' | 'BASIC' | 'FULL'
    timeLimit: number
  }
}

const battleConfig = reactive<BattleConfig>({
  allowFaintSwitch: true,
  showHidden: true,
  rngSeed: undefined,
  teamSelection: {
    enabled: false,
    mode: 'TEAM_SELECTION',
    maxTeamSize: 6,
    minTeamSize: 1,
    allowStarterSelection: true,
    showOpponentTeam: false,
    teamInfoVisibility: 'HIDDEN',
    timeLimit: 60,
  },
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
      teamSelection: {
        enabled: false,
        mode: 'TEAM_SELECTION' as const,
        maxTeamSize: 6,
        minTeamSize: 1,
        allowStarterSelection: true,
        showOpponentTeam: false,
        teamInfoVisibility: 'HIDDEN' as const,
        timeLimit: 60,
      },
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
      teamSelection: {
        enabled: true,
        mode: 'TEAM_SELECTION' as const,
        maxTeamSize: 4,
        minTeamSize: 2,
        allowStarterSelection: true,
        showOpponentTeam: false,
        teamInfoVisibility: 'BASIC' as const,
        timeLimit: 30, // 快速模式：30秒选择
      },
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
      teamSelection: {
        enabled: true,
        mode: 'TEAM_SELECTION' as const,
        maxTeamSize: 6,
        minTeamSize: 3,
        allowStarterSelection: true,
        showOpponentTeam: false,
        teamInfoVisibility: 'HIDDEN' as const,
        timeLimit: 90, // 竞技模式：90秒选择
      },
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
  teamSelection: {
    battle: {
      allowFaintSwitch: true,
      showHidden: true,
      rngSeed: undefined,
      teamSelection: {
        enabled: true,
        mode: 'TEAM_SELECTION' as const,
        maxTeamSize: 6,
        minTeamSize: 1,
        allowStarterSelection: true,
        showOpponentTeam: true,
        teamInfoVisibility: 'FULL' as const,
        timeLimit: 120, // 团队选择测试：2分钟选择
      },
    },
    timer: {
      ...DEFAULT_TIMER_CONFIG,
      enabled: false, // 团队选择测试模式不启用战斗计时器
    },
    enableTurnTimeLimit: false,
    enableTotalTimeLimit: false,
  },
}

const asRawRecord = (value: unknown): Record<string, unknown> => value as unknown as Record<string, unknown>

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

onMounted(async () => {
  // 初始化队伍选择
  initializeTeamSelection()

  // 如果从组合工作台跳转，优先套用控制器配置
  const launchKey = typeof route.query.launchKey === 'string' ? route.query.launchKey : ''
  if (parseQueryBoolean(route.query.workbench) && launchKey.length > 0) {
    const payload = readBattleWorkbenchLaunch(launchKey)
    if (payload) {
      applyWorkbenchLaunchPayload(payload)
    } else {
      errorMessage.value = '组合工作台启动参数无效或已过期'
    }
  }

  if (dataStore.loaded || dataStore.gameDataLoaded) {
    dataStore.gameDataLoaded = true
    isLoading.value = false
  } else {
    try {
      await dataStore.initialize()
      dataStore.gameDataLoaded = true
    } catch (error) {
      errorMessage.value = `资源加载失败: ${(error as Error).message}`
    } finally {
      isLoading.value = false
    }
  }

  if (parseQueryBoolean(route.query.autoStart) && !errorMessage.value) {
    await startLocalBattle()
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
    if (!dataStore.loaded && !dataStore.gameDataLoaded) {
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

    // 验证玩家1队伍中的精灵数据
    for (const pet of player1Team.pets) {
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

    const toTeamConfig = (name: string, pets: typeof player1Team.pets): TeamConfig => ({
      name,
      team: pets.map(pet => ({
        name: pet.name,
        species: pet.species,
        level: pet.level,
        evs: pet.evs,
        ivs: pet.ivs,
        nature: pet.nature,
        skills: pet.skills,
        ability: pet.ability || undefined,
        emblem: pet.emblem || undefined,
        gender: pet.gender || undefined,
        weight: pet.weight || undefined,
        height: pet.height || undefined,
      })),
    })

    const player1Config = toTeamConfig(playerStore.name, player1Team.pets)
    const player2Config = toTeamConfig(`${player2Team.name} (AI)`, player2Team.pets)

    const repo = createRepositoryFromRawData({
      effects: dataStore.effects.allIds.map(id => asRawRecord(toRaw(dataStore.effects.byId[id]))),
      marks: dataStore.marks.allIds.map(id => asRawRecord(toRaw(dataStore.marks.byId[id]))),
      skills: dataStore.skills.allIds.map(id => asRawRecord(toRaw(dataStore.skills.byId[id]))),
      species: dataStore.species.allIds.map(id => asRawRecord(toRaw(dataStore.species.byId[id]))),
    })

    // 构建战斗选项
    const battleOptions: V2BattleConfig = {
      allowFaintSwitch: battleConfig.allowFaintSwitch,
      showHidden: battleConfig.showHidden,
      timerConfig: { ...timerConfig },
      ai: {
        enabled: true,
        players: ['playerB'],
        strategy: 'simple',
      },
    }

    // 添加随机数种子（如果设置了）
    if (battleConfig.rngSeed !== undefined && battleConfig.rngSeed !== null) {
      battleOptions.rngSeed = battleConfig.rngSeed
    }

    // 添加团队选择配置
    if (battleConfig.teamSelection.enabled) {
      battleOptions.teamSelection = {
        enabled: true,
        config: {
          mode: battleConfig.teamSelection.mode,
          maxTeamSize: battleConfig.teamSelection.maxTeamSize,
          minTeamSize: battleConfig.teamSelection.minTeamSize,
          allowStarterSelection: battleConfig.teamSelection.allowStarterSelection,
          showOpponentTeam: battleConfig.teamSelection.showOpponentTeam,
          teamInfoVisibility: battleConfig.teamSelection.teamInfoVisibility,
          timeLimit: battleConfig.teamSelection.timeLimit,
        },
      }
    }

    const battle = createBattleFromConfig(player1Config, player2Config, repo, battleOptions)
    const localSystem = new LocalBattleSystemV2(battle)
    const initialState = await localSystem.getState(undefined, true)
    const playerId = initialState.players[0]?.id
    if (!playerId) {
      throw new Error('战斗初始化失败: 无法解析玩家ID')
    }

    try {
      await battleStore.initBattle(localSystem, playerId)
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
