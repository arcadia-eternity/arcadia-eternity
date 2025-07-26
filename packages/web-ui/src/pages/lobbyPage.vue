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
        to="/leaderboard"
        class="flex flex-col items-center gap-2 p-4 md:p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] router-link-active:border-blue-500 router-link-active:bg-blue-50 router-link-active:text-blue-500 min-h-[80px] md:min-h-[auto] touch-manipulation"
      >
        <el-icon :size="20"><Trophy /></el-icon>
        <span class="text-sm md:text-base">排行榜</span>
      </router-link>
      <router-link
        to="/local-battle-reports"
        class="flex flex-col items-center gap-2 p-4 md:p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] router-link-active:border-blue-500 router-link-active:bg-blue-50 router-link-active:text-blue-500 min-h-[80px] md:min-h-[auto] touch-manipulation"
      >
        <el-icon :size="20"><FolderOpened /></el-icon>
        <span class="text-sm md:text-base">本地战报</span>
      </router-link>
      <router-link
        v-if="!isTauri"
        to="/download"
        class="flex flex-col items-center gap-2 p-4 md:p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] router-link-active:border-blue-500 router-link-active:bg-blue-50 router-link-active:text-blue-500 min-h-[80px] md:min-h-[auto] touch-manipulation"
      >
        <el-icon :size="20"><Download /></el-icon>
        <span class="text-sm md:text-base">下载客户端</span>
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

    <!-- 匹配配置区域 -->
    <div class="mb-6 md:mb-8 space-y-6">
      <!-- 规则选择 -->
      <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <h3 class="text-lg font-medium text-gray-800 mb-4 flex items-center gap-2">
          <el-icon><Setting /></el-icon>
          选择游戏规则
        </h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div
            v-for="ruleSet in availableRuleSets"
            :key="ruleSet.id"
            @click="selectedRuleSetId = ruleSet.id"
            class="p-3 border-2 rounded-lg cursor-pointer transition-all duration-200 hover:shadow-md"
            :class="{
              'border-blue-500 bg-blue-50': selectedRuleSetId === ruleSet.id,
              'border-gray-200 hover:border-gray-300': selectedRuleSetId !== ruleSet.id,
            }"
          >
            <div class="font-medium text-gray-800">{{ ruleSet.name }}</div>
            <div class="text-sm text-gray-600 mt-1">{{ ruleSet.description }}</div>
            <div class="text-xs text-gray-500 mt-2 flex items-center">
              {{ ruleSet.ruleCount }} 条规则
              <RuleSetTooltip :rule-set-id="ruleSet.id" />
            </div>

            <!-- ELO信息 -->
            <div v-if="isEloEnabled(ruleSet.id) && ruleSetElos[ruleSet.id]" class="mt-3 pt-2 border-t border-gray-200">
              <div class="flex items-center justify-between">
                <div class="text-xs text-gray-600">ELO评分</div>
                <div class="flex items-center gap-1">
                  <span class="font-bold text-sm text-blue-600">
                    {{ ruleSetElos[ruleSet.id].elo_rating }}
                  </span>
                </div>
              </div>
              <div class="flex items-center justify-between mt-1">
                <div class="text-xs text-gray-600">排名</div>
                <div class="text-xs text-gray-700">
                  {{ ruleSetElos[ruleSet.id].rank ? `#${ruleSetElos[ruleSet.id].rank}` : '未排名' }}
                </div>
              </div>
              <div class="flex items-center justify-between mt-1">
                <div class="text-xs text-gray-600">胜率</div>
                <div class="text-xs text-gray-700">
                  {{
                    eloStore.formatWinRate(
                      ruleSetElos[ruleSet.id].wins,
                      ruleSetElos[ruleSet.id].losses,
                      ruleSetElos[ruleSet.id].draws,
                    )
                  }}
                  ({{ ruleSetElos[ruleSet.id].games_played }}场)
                </div>
              </div>
            </div>

            <!-- 无ELO数据时的提示（仅对启用ELO的规则集显示） -->
            <div v-else-if="isEloEnabled(ruleSet.id) && !eloStore.isLoading" class="mt-3 pt-2 border-t border-gray-200">
              <div class="text-xs text-gray-500 text-center">暂无评分记录</div>
            </div>

            <!-- 加载状态（仅对启用ELO的规则集显示） -->
            <div v-else-if="isEloEnabled(ruleSet.id)" class="mt-3 pt-2 border-t border-gray-200">
              <div class="text-xs text-gray-500 text-center">加载中...</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 队伍选择 -->
      <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <h3 class="text-lg font-medium text-gray-800 mb-4 flex items-center gap-2">
          <el-icon><User /></el-icon>
          选择队伍
          <span v-if="selectedRuleSetId" class="text-sm text-gray-500 font-normal">
            ({{ availableTeams.length }}/{{ allTeams.length }} 队伍符合规则)
          </span>
        </h3>
        <!-- 符合规则的队伍 -->
        <div v-if="availableTeams.length > 0" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          <div
            v-for="(team, index) in availableTeams"
            :key="`valid-${index}`"
            @click="selectedTeamIndex = index"
            class="p-3 border-2 rounded-lg cursor-pointer transition-all duration-200 hover:shadow-md"
            :class="{
              'border-blue-500 bg-blue-50': selectedTeamIndex === index,
              'border-gray-200 hover:border-gray-300': selectedTeamIndex !== index,
            }"
          >
            <div class="flex items-center justify-between">
              <div class="font-medium text-gray-800">{{ team.name }}</div>
              <div class="flex items-center gap-1">
                <span class="text-sm text-gray-600">{{ team.pets.length }}只</span>
                <el-icon class="text-green-500" :size="16">
                  <Check />
                </el-icon>
                <el-icon v-if="selectedTeamIndex === index" class="text-blue-500 ml-1" size="20">
                  <Select />
                </el-icon>
              </div>
            </div>
            <div class="text-sm text-gray-600 mt-1">
              {{ team.pets.map(p => p.name).join('、') }}
            </div>
            <div class="text-xs text-green-600 mt-1">✓ 符合规则要求</div>
          </div>
        </div>

        <!-- 没有符合规则的队伍时的提示 -->
        <div v-if="availableTeams.length === 0 && selectedRuleSetId" class="text-center py-8">
          <el-icon class="text-gray-400 text-4xl mb-2"><Warning /></el-icon>
          <p class="text-gray-600 mb-2">没有队伍符合当前规则要求</p>
          <p class="text-sm text-gray-500">请前往队伍编辑器调整队伍配置</p>
          <router-link
            to="/team-builder"
            class="inline-flex items-center gap-1 mt-3 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            <el-icon><Edit /></el-icon>
            前往队伍编辑器
          </router-link>
        </div>

        <!-- 不匹配当前规则集的队伍（折叠显示） -->
        <div v-if="incompatibleTeams.length > 0 && selectedRuleSetId" class="mt-4">
          <el-collapse>
            <el-collapse-item>
              <template #title>
                <span class="text-sm text-gray-600">
                  <el-icon class="text-orange-500"><Warning /></el-icon>
                  {{ incompatibleTeams.length }} 个队伍使用不同规则集 (点击查看)
                </span>
              </template>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div
                  v-for="(team, index) in incompatibleTeams"
                  :key="`incompatible-${index}`"
                  class="p-3 border-2 border-orange-300 bg-orange-50 rounded-lg opacity-60 cursor-not-allowed"
                >
                  <div class="flex items-center justify-between">
                    <div class="font-medium text-gray-800">{{ team.name }}</div>
                    <div class="flex items-center gap-1">
                      <span class="text-sm text-gray-600">{{ team.pets.length }}只</span>
                      <el-icon class="text-orange-500" :size="16">
                        <Warning />
                      </el-icon>
                    </div>
                  </div>
                  <div class="text-sm text-gray-600 mt-1">
                    {{ team.pets.map((p: any) => p.name).join('、') }}
                  </div>
                  <div class="text-xs text-orange-600 mt-1">
                    队伍使用{{ getRuleSetName(team.ruleSetId || 'casual_standard_ruleset') }}规则集
                  </div>
                </div>
              </div>
            </el-collapse-item>
          </el-collapse>
        </div>
      </div>

      <!-- 匹配按钮 -->
      <div class="text-center">
        <button
          @click="handleMatchmaking"
          :disabled="isMatchButtonDisabled && !isMatching"
          class="px-8 py-4 md:px-6 md:py-3 text-lg md:text-lg bg-green-500 text-white border-none rounded-lg cursor-pointer transition-colors duration-300 hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed min-h-[48px] touch-manipulation font-medium shadow-lg hover:shadow-xl"
        >
          {{
            battleClientStore.currentState.status !== 'connected'
              ? '请先连接服务器'
              : !selectedRuleSetId
                ? '请选择游戏规则'
                : selectedTeamIndex === -1
                  ? '请选择队伍'
                  : !isSelectedTeamCompatible
                    ? '队伍规则集不匹配'
                    : !isSelectedTeamValid
                      ? selectedTeamValidationErrors.length > 0
                        ? `队伍不符合规则 (${selectedTeamValidationErrors.length}个问题)`
                        : '所选队伍不符合规则'
                      : battleClientStore.currentState.matchmaking === 'matched'
                        ? '准备进入战斗...'
                        : isMatching
                          ? '取消匹配'
                          : '开始匹配'
          }}
        </button>
      </div>

      <!-- 加载状态 -->
      <div
        v-if="isMatching || battleClientStore.currentState.matchmaking === 'matched'"
        class="mt-6 md:mt-5 flex flex-col items-center gap-3 md:gap-2.5"
      >
        <div
          class="w-10 h-10 md:w-8 md:h-8 border-[3px] border-gray-200 border-t-blue-500 rounded-full animate-spin"
        ></div>
        <p class="text-gray-600 text-base md:text-sm">
          {{ battleClientStore.currentState.matchmaking === 'matched' ? '正在进入战斗...' : '正在寻找对手...' }}
        </p>
      </div>

      <!-- 错误提示 -->
      <div
        v-if="errorMessage"
        class="text-red-500 mt-4 p-3 md:p-2.5 border border-red-500 rounded-lg bg-red-50 text-sm md:text-base"
      >
        {{ errorMessage }}
      </div>

      <!-- 选中队伍验证错误提示 -->
      <div
        v-if="selectedTeamValidationErrors.length > 0 && selectedTeam && selectedRuleSetId"
        class="text-orange-600 mt-4 p-3 md:p-2.5 border border-orange-400 rounded-lg bg-orange-50 text-sm md:text-base"
      >
        <div class="flex items-center gap-2 mb-2">
          <el-icon class="text-orange-500"><Warning /></el-icon>
          <span class="font-medium"
            >队伍 "{{ selectedTeam.name }}" 不符合 {{ getRuleSetName(selectedRuleSetId) }} 要求：</span
          >
        </div>
        <ul class="list-disc list-inside space-y-1">
          <li v-for="error in selectedTeamValidationErrors" :key="error" class="text-sm">
            {{ error }}
          </li>
        </ul>
      </div>
    </div>

    <!-- 提示信息 -->
    <div class="mt-6 md:mt-8 text-left">
      <el-alert title="使用提示" type="info" :closable="false" class="mb-4">
        <ul class="text-left text-sm md:text-base space-y-1">
          <li>不要忘了 先在队伍编辑里面编辑队伍</li>
          <li>目前正在活跃更新中 可能会有一些bug 尽量谅解</li>
          <li>群号：805146068</li>
        </ul>
      </el-alert>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBattleStore } from '@/stores/battle'
import { usePlayerStore } from '@/stores/player'
import { useBattleClientStore } from '@/stores/battleClient'
import { usePetStorageStore } from '@/stores/petStorage'
import { useEloStore } from '@/stores/elo'
import { useValidationStore } from '@/stores/validation'
import { type BattleClient, RemoteBattleSystem } from '@arcadia-eternity/client'
import {
  User,
  Document,
  Monitor,
  Setting,
  FolderOpened,
  Collection,
  Download,
  Check,
  Warning,
  Edit,
  Select,
  Trophy,
} from '@element-plus/icons-vue'
import { isTauri } from '@/utils/env'
import RuleSetTooltip from '@/components/RuleSetTooltip.vue'

const router = useRouter()
const route = useRoute()
const battleStore = useBattleStore()
const playerStore = usePlayerStore()
const battleClientStore = useBattleClientStore()
const petStorageStore = usePetStorageStore()
const eloStore = useEloStore()
const validationStore = useValidationStore()

// 匹配配置状态
const selectedTeamIndex = ref<number>(-1)

// 计算属性
const availableRuleSets = computed(() => validationStore.availableRuleSets)
const selectedRuleSetId = computed({
  get: () => validationStore.selectedRuleSetId,
  set: (value: string) => validationStore.setSelectedRuleSet(value),
})

// ELO相关计算属性
const ruleSetElos = computed(() => {
  const eloMap: Record<string, any> = {}
  availableRuleSets.value.forEach(ruleSet => {
    eloMap[ruleSet.id] = eloStore.getEloForRuleSet(ruleSet.id)
  })
  return eloMap
})

// 启用ELO的规则集列表
const eloEnabledRuleSets = ref<string[]>([])

// 检查规则集是否启用ELO
const isEloEnabled = (ruleSetId: string) => {
  return eloEnabledRuleSets.value.includes(ruleSetId)
}

// 计算属性 - 只显示与当前选择规则集匹配的队伍
const availableTeams = computed(() => {
  if (!selectedRuleSetId.value) {
    // 如果没有选择规则集，显示所有队伍
    return petStorageStore.teams
  }

  // 过滤出规则集匹配的队伍
  return petStorageStore.teams.filter(team => {
    const teamRuleSetId = team.ruleSetId || 'casual_standard_ruleset' // 默认为休闲规则集
    return teamRuleSetId === selectedRuleSetId.value
  })
})

// 所有队伍（包括不匹配规则集的）
const allTeams = computed(() => {
  return petStorageStore.teams
})

// 不匹配当前规则集的队伍
const incompatibleTeams = computed(() => {
  if (!selectedRuleSetId.value) {
    return []
  }

  return petStorageStore.teams.filter(team => {
    const teamRuleSetId = team.ruleSetId || 'casual_standard_ruleset' // 默认为休闲规则集
    return teamRuleSetId !== selectedRuleSetId.value
  })
})

const selectedTeam = computed(() => {
  if (selectedTeamIndex.value >= 0 && selectedTeamIndex.value < availableTeams.value.length) {
    return availableTeams.value[selectedTeamIndex.value]
  }
  return null
})

// 当规则变化时，重置队伍选择并重新验证
watch(selectedRuleSetId, () => {
  selectedTeamIndex.value = -1
  validateSelectedTeam()
})

// 当选中的队伍变化时，重新验证
watch(selectedTeam, () => {
  validateSelectedTeam()
})

// 检查选中的队伍是否与当前规则集匹配
const isSelectedTeamCompatible = computed(() => {
  if (!selectedTeam.value || !selectedRuleSetId.value) return false
  return validationStore.isTeamCompatibleWithRuleSet(selectedTeam.value, selectedRuleSetId.value)
})

// 进入匹配时的额外验证（检查队伍是否真正符合规则要求）
const isSelectedTeamValid = ref<boolean>(false)
const selectedTeamValidationErrors = ref<string[]>([])

// 验证选中的队伍
const validateSelectedTeam = async () => {
  if (!selectedTeam.value || !selectedRuleSetId.value) {
    isSelectedTeamValid.value = false
    selectedTeamValidationErrors.value = []
    return
  }

  if (!isSelectedTeamCompatible.value) {
    isSelectedTeamValid.value = false
    selectedTeamValidationErrors.value = ['队伍规则集不匹配']
    return
  }

  try {
    const result = await validationStore.validateTeam(selectedTeam.value.pets, selectedRuleSetId.value)
    isSelectedTeamValid.value = result.isValid
    selectedTeamValidationErrors.value = result.errors.map(error => error.message)
  } catch (error) {
    console.error('验证队伍时出错:', error)
    isSelectedTeamValid.value = false
    selectedTeamValidationErrors.value = ['验证过程中发生错误']
  }
}

// 根据规则集ID获取规则集名称
const getRuleSetName = (ruleSetId: string): string => {
  return validationStore.getRuleSetName(ruleSetId)
}

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

// 计算是否应该禁用匹配按钮
const isMatchButtonDisabled = computed(() => {
  const currentState = battleClientStore.currentState
  const isNotConnected = currentState.status !== 'connected'
  const isSearching = currentState.matchmaking === 'searching'
  const isMatched = currentState.matchmaking === 'matched'
  const noRuleSelected = !selectedRuleSetId.value
  const noTeamSelected = selectedTeamIndex.value === -1
  const teamInvalid = !isSelectedTeamValid.value
  const teamIncompatible = !isSelectedTeamCompatible.value

  const disabled =
    isNotConnected || isSearching || isMatched || noRuleSelected || noTeamSelected || teamInvalid || teamIncompatible

  console.log(
    '🔒 isMatchButtonDisabled computed:',
    disabled,
    'notConnected:',
    isNotConnected,
    'searching:',
    isSearching,
    'matched:',
    isMatched,
    'noRuleSelected:',
    noRuleSelected,
    'noTeamSelected:',
    noTeamSelected,
    'teamInvalid:',
    teamInvalid,
    'teamIncompatible:',
    teamIncompatible,
  )
  return disabled
})

const errorMessage = ref<string | null>(null)

const handleMatchmaking = async () => {
  try {
    console.log('🎮 handleMatchmaking called, current isMatching:', isMatching.value)
    // 清除之前的错误信息
    errorMessage.value = null

    // 检查连接状态
    if (battleClientStore.currentState.status !== 'connected') {
      errorMessage.value = '请先连接到服务器'
      return
    }

    // 检查规则选择
    if (!selectedRuleSetId.value) {
      errorMessage.value = '请选择游戏规则'
      return
    }

    // 检查队伍选择
    if (selectedTeamIndex.value === -1 || !selectedTeam.value) {
      errorMessage.value = '请选择队伍'
      return
    }

    // 检查队伍是否符合规则
    if (!isSelectedTeamValid.value) {
      // 使用已经计算好的验证错误信息
      if (selectedTeamValidationErrors.value.length > 0) {
        errorMessage.value = `队伍不符合规则要求：${selectedTeamValidationErrors.value[0]}`
      } else {
        errorMessage.value = '所选队伍不符合规则要求'
      }
      return
    }

    if (isMatching.value) {
      console.log('❌ Canceling matchmaking')
      try {
        await battleClientStore.cancelMatchmaking()
      } catch (error) {
        console.warn('⚠️ Cancel matchmaking failed (probably already matched):', error)
        // 如果取消失败，可能是因为已经匹配成功了，忽略错误
      }
    } else {
      console.log(
        '🔍 Starting matchmaking for player:',
        playerStore.player.id,
        'with rule:',
        selectedRuleSetId.value,
        'team:',
        selectedTeam.value.name,
      )

      // 构建玩家数据，使用选定的队伍
      const playerData = {
        ...playerStore.player,
        team: selectedTeam.value.pets,
      }

      // 发送匹配请求，包含规则集信息
      await battleClientStore.joinMatchmaking({
        playerSchema: playerData,
        ruleSetId: selectedRuleSetId.value,
      })
      console.log('✅ Matchmaking request sent with ruleSetId:', selectedRuleSetId.value)

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
// 监听路由变化，从战斗页面返回时刷新ELO
watch(
  () => route.path,
  async (newPath, oldPath) => {
    if (newPath === '/' && oldPath === '/battle' && playerStore.id) {
      console.log('🔄 Returned from battle, refreshing ELO data')
      try {
        await eloStore.refreshAllElos(playerStore.id)
      } catch (error) {
        console.warn('Failed to refresh ELO data after returning from battle:', error)
      }
    }
  },
)

onMounted(async () => {
  // 初始化验证系统
  await validationStore.initialize()

  // 获取启用ELO的规则集列表
  try {
    const { BattleReportService } = await import('@/services/battleReportService')
    const battleReportService = new BattleReportService()
    const eloRuleSets = await battleReportService.getEloEnabledRuleSets()
    eloEnabledRuleSets.value = eloRuleSets.map(rs => rs.id)
  } catch (error) {
    console.warn('Failed to fetch ELO-enabled rule sets:', error)
  }

  // 获取玩家ELO数据
  if (playerStore.id) {
    try {
      await eloStore.fetchPlayerAllElos(playerStore.id)
    } catch (error) {
      console.warn('Failed to fetch player ELO data:', error)
    }
  }

  // 初始验证选中的队伍
  validateSelectedTeam()

  nextTick(() => {
    if (route.query.startMatching === 'true') handleMatchmaking()
  })
})

onBeforeUnmount(async () => {
  nextTick(() => {
    // 只有在真正搜索匹配时才取消匹配，匹配成功准备跳转时不取消
    const currentState = battleClientStore.currentState
    if (currentState.matchmaking === 'searching') {
      console.log('🚪 Leaving lobby page while searching, canceling matchmaking')
      battleClientStore.cancelMatchmaking()
    } else if (currentState.matchmaking === 'matched') {
      console.log('🚪 Leaving lobby page after match success, not canceling')
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
