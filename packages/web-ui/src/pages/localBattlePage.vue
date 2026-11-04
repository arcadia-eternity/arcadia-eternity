<template>
  <div class="max-w-4xl w-full mx-auto p-6 min-h-[calc(100vh-60px)] flex flex-col justify-start gap-6">
    <h1 class="text-3xl font-bold text-center text-gray-800">本地对战</h1>

    <!-- 战斗配置面板 -->
    <div class="bg-gray-50 rounded-lg p-6 shadow-lg border border-gray-200">
      <h2 class="text-xl font-semibold text-center text-gray-700 mb-6">战斗配置</h2>

      <div class="mb-6 p-4 bg-white rounded-md border border-gray-200 flex flex-col gap-3">
        <p>对战环境：进入本页时已准备的本地内容（本次配置和对局保持固定）</p>
        <p v-if="contentNotice" class="text-sm text-amber-700">{{ contentNotice }}</p>
        <TeamLibrarySelect :delegate="teamSelectors[0]!" label="玩家1队伍" />
        <TeamLibrarySelect :delegate="teamSelectors[1]!" label="玩家2队伍（AI）" />
        <router-link to="/team-builder" class="text-blue-600">管理个人编队</router-link>
      </div>

      <BattleOptionsEditor v-model:battle-config="battleConfig" v-model:timer-config="timerConfig" />

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
import BattleOptionsEditor from '@/components/battle/BattleOptionsEditor.vue'
import TeamLibrarySelect from '@/components/team/TeamLibrarySelect.vue'
import type { TeamLibraryDelegate } from '@/components/team/library'
import { battleOptions, createBattleConfiguration } from '@/services/battleConfiguration'
import { ref, shallowRef, onBeforeUnmount, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBattleStore } from '@/stores/battle'
import { usePlayerStore } from '@/stores/player'
import { usePetStorageStore } from '@/stores/petStorage'
import { useGameDataStore } from '@/stores/gameData'
import { DEFAULT_TIMER_CONFIG, type TimerConfig } from '@arcadia-eternity/const'

import { LocalBattleSession } from '@/services/localBattleSession'
import { getDesktopApi } from '@/utils/env'

const router = useRouter()
const route = useRoute()
const battleStore = useBattleStore()
const playerStore = usePlayerStore()
const petStorage = usePetStorageStore()
const dataStore = useGameDataStore()
const errorMessage = ref<string | null>(null)
const isLoading = ref(true)
const contentNotice = ref('')

const localSession = shallowRef(new LocalBattleSession())
const battleTeams = computed(() => petStorage.teams)
onBeforeUnmount(() => {
  void localSession.value.releaseConfiguration().catch(error => console.warn('本地对战清理失败', error))
})

// 队伍选择
const selectedPlayer1TeamIndex = ref(0)
const selectedPlayer2TeamIndex = ref(0)

// 可用队伍列表（过滤掉空队伍）
const availableTeams = computed(() => {
  return battleTeams.value.filter(team => team.pets.length > 0)
})

const teamChoices = computed(() =>
  availableTeams.value.map(team => ({
    id: String(battleTeams.value.indexOf(team)),
    name: team.name,
    size: team.pets.length,
  })),
)
const teamSelectors: TeamLibraryDelegate[] = [selectedPlayer1TeamIndex, selectedPlayer2TeamIndex].map(selected => ({
  entries: teamChoices,
  selected: computed({
    get: () => String(selected.value),
    set: value => {
      selected.value = Number(value)
    },
  }),
}))

// 初始化队伍选择的函数
const initializeTeamSelection = () => {
  // 设置玩家1为当前队伍
  selectedPlayer1TeamIndex.value = petStorage.currentTeamIndex

  // 设置玩家2为不同的队伍（如果有的话）
  const validTeams = availableTeams.value
  if (validTeams.length > 1) {
    // 找到第一个不同于玩家1的队伍
    const differentTeamIndex = battleTeams.value.findIndex(
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

// 战斗配置
const battleConfig = ref(createBattleConfiguration())

// 计时器配置
const timerConfig = ref<TimerConfig>({
  ...DEFAULT_TIMER_CONFIG,
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

// 加载预设配置
const loadPreset = (presetName: keyof typeof presets) => {
  const preset = presets[presetName]

  // 更新战斗配置
  Object.assign(battleConfig.value, preset.battle)

  // 更新计时器配置
  Object.assign(timerConfig.value, preset.timer)

  // 更新时间限制启用状态
}

async function initializeLocalBattle() {
  const previous = localSession.value
  const session = new LocalBattleSession()
  localSession.value = session
  isLoading.value = true
  await previous.dispose().catch(error => console.warn('本地对战清理失败', error))
  if (localSession.value !== session || session.state === 'disposed') return
  isLoading.value = true
  errorMessage.value = null
  contentNotice.value = ''
  const owner = localSession.value
  const isCurrent = () => localSession.value === owner && owner.state !== 'disposed'
  dataStore.clearServerEnvironment()
  // 初始化队伍选择
  initializeTeamSelection()

  if (!getDesktopApi() && (dataStore.loaded || dataStore.gameDataLoaded)) {
    dataStore.gameDataLoaded = true
    isLoading.value = false
  } else {
    try {
      if (getDesktopApi()) {
        await session.prepareContent(dataStore)
        const status = await getDesktopApi()!.listContentPackages?.()
        if (status?.selection.status === 'preparing')
          contentNotice.value = '新选择正在准备，本次使用最近可用组合。重新进入本页可使用准备完成后的内容。'
        if (status?.selection.status === 'failed')
          contentNotice.value = `新选择未能启用，本次使用最近可用组合：${status.selection.message ?? ''}`
      } else await dataStore.initialize()
      if (isCurrent()) dataStore.gameDataLoaded = true
    } catch (error) {
      if (isCurrent()) errorMessage.value = `资源加载失败: ${(error as Error).message}`
    } finally {
      if (isCurrent()) isLoading.value = false
    }
  }

  if (!isCurrent()) return
  if (parseQueryBoolean(route.query.autoStart) && !errorMessage.value) {
    await startLocalBattle()
  }
}

const startLocalBattle = async () => {
  // 防止重复点击
  if (isLoading.value) {
    return
  }

  isLoading.value = true
  errorMessage.value = null
  const session = localSession.value

  try {
    // 验证游戏数据是否已加载
    if (!dataStore.loaded && !dataStore.gameDataLoaded) {
      throw new Error('游戏数据尚未加载完成，请稍后再试')
    }

    // 验证队伍选择
    if (availableTeams.value.length === 0) {
      throw new Error('没有可用的队伍，请先在队伍编辑器中创建队伍')
    }

    const player1Team = battleTeams.value[selectedPlayer1TeamIndex.value]
    const player2Team = battleTeams.value[selectedPlayer2TeamIndex.value]

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

    const options = battleOptions(battleConfig.value, timerConfig.value)

    await session.start(
      { name: playerStore.name, team: player1Team.pets },
      { name: `${player2Team.name} (AI)`, team: player2Team.pets },
      options,
      { data: dataStore, battle: battleStore, navigate: () => router.push('/battle?dev=true') },
    )
  } catch (error) {
    console.error('本地对战启动失败:', error)
    if (localSession.value === session && session.state !== 'disposed') errorMessage.value = (error as Error).message
  } finally {
    if (localSession.value === session) isLoading.value = false
  }
}
watch(
  () => route.fullPath,
  () => {
    if (route.name === 'LocalBattle') void initializeLocalBattle()
  },
  { immediate: true },
)
</script>
