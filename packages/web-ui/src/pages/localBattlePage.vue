<template>
  <div class="max-w-4xl w-full mx-auto p-6 min-h-[calc(100vh-60px)] flex flex-col justify-start gap-6">
    <h1 class="text-3xl font-bold text-center text-gray-800">本地对战</h1>

    <div class="bg-gray-50 rounded-lg p-6 shadow-lg border border-gray-200">
      <div class="mb-6 p-4 bg-white rounded-md border border-gray-200 flex flex-col gap-3">
        <div v-if="showEnvironmentPicker" class="flex flex-wrap items-center gap-3">
          <label class="grid gap-1 flex-1 min-w-48">
            对战环境
            <el-select
              v-model="selectedEnvironmentId"
              aria-label="对战环境"
              placeholder="选择对战环境"
              :disabled="discovering || loadingPhase === 'battle'"
              @change="prepareConfiguration()"
            >
              <el-option
                v-for="choice in environmentChoices"
                :key="choice.id"
                :label="choice.name"
                :value="choice.id"
                :disabled="!choice.available"
              />
            </el-select>
          </label>
          <router-link to="/environments" class="text-blue-600 self-end py-1">查看环境</router-link>
        </div>
        <p v-if="environment?.gameplayRevision" class="text-sm text-gray-600" :title="environment.gameplayRevision">
          {{ usingPreviousVersion ? '上次应用版本' : '环境版本' }} {{ environment.gameplayRevision.slice(0, 8) }}
        </p>
        <div v-if="configurationError" class="flex flex-wrap items-center gap-2">
          <p role="alert" class="text-red-600">{{ configurationError }}</p>
          <el-button link type="primary" @click="prepareConfiguration({ discover: true })">重试</el-button>
        </div>
        <TeamLibrarySelect :delegate="teamSelectors[0]!" label="玩家1队伍" :disabled="!teamsInitialized || launching" />
        <TeamLibrarySelect
          :delegate="teamSelectors[1]!"
          label="玩家2队伍（AI）"
          :disabled="!teamsInitialized || launching"
        />
        <router-link to="/team-builder" class="text-blue-600">管理个人编队</router-link>
      </div>

      <BattleOptionsEditor
        v-if="configurationReady"
        v-model:battle-config="battleConfig"
        v-model:timer-config="timerConfig"
        :environment-timer="environmentTimer"
        :environment-selection="environmentSelection"
      />

      <div
        v-if="configurationReady && (!environmentTimer || !environmentSelection)"
        class="flex flex-wrap gap-2 justify-center mt-6 pt-6 border-t border-gray-200"
      >
        <el-button @click="loadPreset('default')">默认配置</el-button>
        <el-button @click="loadPreset('fast')">快速对战</el-button>
        <el-button @click="loadPreset('competitive')">竞技模式</el-button>
        <el-button v-if="!environmentSelection" @click="loadPreset('teamSelection')">团队选择测试</el-button>
      </div>
    </div>

    <!-- 对战控制区域 -->
    <div class="text-center">
      <el-button
        type="primary"
        size="large"
        :loading="loadingPhase !== null"
        @click="startLocalBattle"
        :disabled="loadingPhase !== null || !configurationReady || matchmaking?.blocksOtherBattles"
        >{{ startLabel }}</el-button
      >

      <!-- 错误提示 -->
      <div v-if="errorMessage" role="alert" class="mt-4 p-3 text-red-600 border border-red-400 rounded-md bg-red-50">
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
import { useMatchmakingStore } from '@/stores/matchmaking'
import { DEFAULT_TIMER_CONFIG, type TimerConfig } from '@arcadia-eternity/const'
import type { ManagedEnvironment, ManagedEnvironmentInstallation } from '@arcadia-eternity/protocol'

import { localEnvironmentRequest } from '@/features/content/localEnvironmentPackages'
import { LocalBattleSession, type LocalBattleEnvironment } from '@/services/localBattleSession'
import { hasPreparedWebEnvironment, readPreparedWebCatalog } from '@/services/preparedWebEnvironment'
import { preloadBattleWorker } from '@/services/sandboxBattleWorkers'
import { getDesktopApi, isStaticMode } from '@/utils/env'

const router = useRouter()
const route = useRoute()
const battleStore = useBattleStore()
const playerStore = usePlayerStore()
const petStorage = usePetStorageStore()
const dataStore = useGameDataStore()
const matchmaking = isStaticMode ? null : useMatchmakingStore()
const errorMessage = ref<string | null>(null)
const loadingPhase = ref<'configuration' | 'battle' | null>('configuration')
const launching = computed(() => loadingPhase.value === 'battle')
const startLabel = computed(() => {
  if (matchmaking?.blocksOtherBattles) return '取消匹配后可开始本地对战'
  if (loadingPhase.value === 'configuration') return '正在准备本地内容…'
  if (loadingPhase.value === 'battle') return '正在启动对战引擎…'
  return '开始本地对战'
})
const desktop = getDesktopApi()
const bundledWeb = hasPreparedWebEnvironment()
const hasEnvironmentLibrary = !!desktop?.localEnvironment || bundledWeb
interface EnvironmentChoice {
  id: string
  name: string
  available: boolean
  draftRevision?: string
  appliedDraftRevision?: string
}
const environmentChoices = shallowRef<EnvironmentChoice[]>([])
const selectedEnvironmentId = ref<string>()
const configurationReady = ref(false)
const configurationError = ref('')
const discovering = ref(false)
const showEnvironmentPicker = computed(
  () => !!desktop?.localEnvironment || (bundledWeb && (discovering.value || environmentChoices.value.length > 0)),
)
const environment = shallowRef<LocalBattleEnvironment>()
const environmentTimer = computed(() => !!environment.value?.rules?.mechanics?.timer)
const environmentSelection = computed(() => !!environment.value?.rules?.mechanics?.teamSelection)
const usingPreviousVersion = computed(() => {
  const choice = environmentChoices.value.find(choice => choice.id === selectedEnvironmentId.value)
  const capturedDraft = environment.value?.draftRevision
  return !!capturedDraft && capturedDraft === choice?.appliedDraftRevision && capturedDraft !== choice.draftRevision
})
let defaultWebEnvironment: string | undefined
const localSession = shallowRef<LocalBattleSession>()
onBeforeUnmount(() => {
  const session = localSession.value
  localSession.value = undefined
  void session?.releaseConfiguration().catch(error => console.warn('本地对战清理失败', error))
})

const teamsInitialized = ref(false)
const selectedTeams = [ref(''), ref('')] as const
const availableTeams = computed(() => petStorage.teams.filter(team => team.pets.length > 0))
const teamChoices = computed(() =>
  availableTeams.value.map(team => ({
    id: team.id,
    name: team.name,
    size: team.pets.length,
  })),
)
const teamSelectors: TeamLibraryDelegate[] = selectedTeams.map(selected => ({
  entries: teamChoices,
  selected,
}))

const initializeTeamSelection = () => {
  const currentId = petStorage.teams[petStorage.currentTeamIndex]?.id
  const first = availableTeams.value.find(team => team.id === currentId) ?? availableTeams.value[0]
  const second = availableTeams.value.find(team => team.id !== first?.id) ?? first
  selectedTeams[0].value = first?.id ?? ''
  selectedTeams[1].value = second?.id ?? ''
  teamsInitialized.value = true
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
  },
  fast: {
    battle: {
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
  },
  competitive: {
    battle: {
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
  },
  teamSelection: {
    battle: {
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
  },
}

const loadPreset = (presetName: keyof typeof presets) => {
  const {
    battle: { teamSelection, ...options },
    timer,
  } = presets[presetName]
  Object.assign(battleConfig.value, options)
  if (!environmentSelection.value) battleConfig.value.teamSelection = { ...teamSelection }
  if (!environmentTimer.value) Object.assign(timerConfig.value, timer)
}

async function readEnvironmentChoices(refresh: boolean) {
  if (desktop?.localEnvironment) {
    const snapshot = await localEnvironmentRequest<{
      selectedEnvironmentId?: string
      environments: ManagedEnvironment[]
      installations: ManagedEnvironmentInstallation[]
    }>({ action: 'snapshot' })
    const installations = new Map(
      snapshot.installations.filter(item => item.status === 'ready').map(item => [item.environmentId, item]),
    )
    const choices = snapshot.environments.map(({ document, revision }) => {
      const installed = installations.get(document.id)
      return {
        id: document.id,
        name: installed?.document.name ?? `${document.name}（未准备）`,
        available: !!installed,
        draftRevision: revision,
        appliedDraftRevision: installed?.draftRevision,
      }
    })
    return { choices, defaultId: snapshot.selectedEnvironmentId ?? choices.find(choice => choice.available)?.id }
  }
  if (bundledWeb) {
    const catalog = await readPreparedWebCatalog(refresh)
    return {
      choices: (catalog.builtins ?? []).map(({ id, name }) => ({ id, name, available: true })),
      defaultId: catalog.defaultEnvironment,
    }
  }
  return { choices: [], defaultId: undefined }
}

async function prepareConfiguration({ discover = false, autoStart = false } = {}) {
  const previous = localSession.value
  const session = new LocalBattleSession()
  localSession.value = session
  loadingPhase.value = 'configuration'
  configurationReady.value = false
  configurationError.value = ''
  discovering.value = discover
  environment.value = undefined
  errorMessage.value = null
  const isCurrent = () => localSession.value === session && session.state !== 'disposed'

  if (!previous) dataStore.clearServerEnvironment()
  void previous?.dispose().catch(error => console.warn('本地对战清理失败', error))
  if (!desktop) preloadBattleWorker()
  try {
    if (discover && hasEnvironmentLibrary) {
      const selection = await readEnvironmentChoices(!!previous)
      if (!isCurrent()) return
      environmentChoices.value = selection.choices
      selectedEnvironmentId.value ??= selection.defaultId
      if (bundledWeb) defaultWebEnvironment = selection.defaultId
      discovering.value = false
    }
    const id = selectedEnvironmentId.value
    const choice = environmentChoices.value.find(item => item.id === id)
    if ((id && !choice?.available) || (desktop?.localEnvironment && !id)) {
      throw new Error('所选环境尚未准备')
    }

    // Let bootstrap's default catalog finish before projecting a per-battle catalog.
    if (desktop || bundledWeb) await dataStore.whenReady().catch(() => {})
    else await dataStore.whenReady()
    if (!isCurrent()) return
    const captured = await session.prepareContent(
      dataStore,
      bundledWeb && id === defaultWebEnvironment ? undefined : id,
    )
    if (!isCurrent()) return
    await playerStore.initializePlayer()
    if (!isCurrent()) return
    environment.value = captured
    configurationReady.value = true
  } catch (error) {
    if (isCurrent()) configurationError.value = (error as Error).message
  } finally {
    if (isCurrent()) {
      if (!teamsInitialized.value) initializeTeamSelection()
      loadingPhase.value = null
      discovering.value = false
    }
  }

  if (isCurrent() && autoStart && configurationReady.value) {
    await startLocalBattle()
  }
}

const startLocalBattle = async () => {
  const session = localSession.value
  if (!session || !configurationReady.value || loadingPhase.value || matchmaking?.blocksOtherBattles) return
  loadingPhase.value = 'battle'
  errorMessage.value = null

  try {
    if (availableTeams.value.length === 0) {
      throw new Error('没有可用的队伍，请先在队伍编辑器中创建队伍')
    }

    function requireTeam(id: string, label: string) {
      const team = availableTeams.value.find(item => item.id === id)
      if (!team) throw new Error(`请选择${label}的队伍`)
      for (const pet of team.pets) {
        if (!pet.name || !pet.species) {
          throw new Error(`${label}的精灵「${pet.name || '未命名'}」缺少名称或种族`)
        }
        if (!pet.skills?.length) throw new Error(`${label}的精灵「${pet.name}」未配置技能`)
      }
      return team
    }

    const player1Team = requireTeam(selectedTeams[0].value, '玩家1')
    const player2Team = requireTeam(selectedTeams[1].value, '玩家2')

    await session.start(
      { name: playerStore.name, team: player1Team.pets },
      { name: `${player2Team.name} (AI)`, team: player2Team.pets },
      battleOptions(battleConfig.value, timerConfig.value),
      { data: dataStore, battle: battleStore, navigate: () => router.push('/battle?dev=true') },
    )
  } catch (error) {
    console.error('本地对战启动失败:', error)
    if (localSession.value === session && session.state !== 'disposed') errorMessage.value = (error as Error).message
  } finally {
    if (localSession.value === session) loadingPhase.value = null
  }
}
watch(
  () => route.fullPath,
  () => {
    if (route.name === 'LocalBattle')
      void prepareConfiguration({ discover: true, autoStart: parseQueryBoolean(route.query.autoStart) })
  },
  { immediate: true },
)
</script>
