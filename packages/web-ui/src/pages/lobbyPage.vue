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
        v-if="!isDesktop"
        to="/download"
        class="flex flex-col items-center gap-2 p-4 md:p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] router-link-active:border-blue-500 router-link-active:bg-blue-50 router-link-active:text-blue-500 min-h-[80px] md:min-h-[auto] touch-manipulation"
      >
        <el-icon :size="20"><Download /></el-icon>
        <span class="text-sm md:text-base">下载客户端</span>
      </router-link>
      <router-link
        to="/local-battle"
        class="flex flex-col items-center gap-2 p-4 md:p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] router-link-active:border-blue-500 router-link-active:bg-blue-50 router-link-active:text-blue-500 min-h-[80px] md:min-h-[auto] touch-manipulation"
      >
        <el-icon :size="20"><Monitor /></el-icon>
        <span class="text-sm md:text-base">人机对战</span>
      </router-link>
      <router-link
        v-if="isDesktop"
        to="/pack-editor"
        class="flex flex-col items-center gap-2 p-4 md:p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] router-link-active:border-blue-500 router-link-active:bg-blue-50 router-link-active:text-blue-500 min-h-[80px] md:min-h-[auto] touch-manipulation"
      >
        <el-icon :size="20"><Files /></el-icon>
        <span class="text-sm md:text-base">数据包编辑</span>
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
      <TeamSelector
        v-model="selectedTeam"
        :selected-rule-set-id="selectedRuleSetId"
        @update:is-valid="isSelectedTeamValid = $event"
        @update:validation-errors="selectedTeamValidationErrors = $event"
      />

      <!-- 匹配按钮 -->
      <div class="text-center">
        <button
          @click="handleMatchmaking"
          :disabled="isMatchButtonDisabled"
          class="px-8 py-4 md:px-6 md:py-3 text-lg md:text-lg bg-green-500 text-white border-none rounded-lg cursor-pointer transition-colors duration-300 hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed min-h-[48px] touch-manipulation font-medium shadow-lg hover:shadow-xl"
        >
          {{
            battleClientStore.currentState.status !== 'connected'
              ? '请先连接服务器'
              : !selectedRuleSetId
                ? '请选择游戏规则'
                : !selectedTeam
                  ? '请选择队伍'
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

      <!-- 私人房间区域 -->
      <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <h3 class="text-lg font-medium text-gray-800 mb-4 flex items-center gap-2">
          <el-icon><User /></el-icon>
          私人房间
        </h3>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <!-- 如果已在房间，显示进入房间按钮 -->
          <div v-if="privateRoomStore.currentRoom" class="md:col-span-3">
            <h4 class="text-sm font-medium text-gray-700 mb-3">你已在房间中</h4>
            <el-button type="primary" @click="goToCurrentRoom" class="w-full">
              回到房间 ({{ privateRoomStore.currentRoom.config.roomCode }})
            </el-button>
          </div>

          <!-- 否则，显示创建和加入选项 -->
          <template v-else>
            <!-- 创建房间 -->
            <div class="space-y-3">
              <h4 class="text-sm font-medium text-gray-700">创建房间</h4>
              <el-button
                type="success"
                :disabled="battleClientStore.currentState.status !== 'connected'"
                @click="showCreateRoomDialog = true"
                class="w-full"
                data-testid="create-private-room-button"
              >
                创建私人房间
              </el-button>
            </div>

            <!-- 加入房间 -->
            <div class="space-y-3 col-span-2">
              <h4 class="text-sm font-medium text-gray-700">加入房间</h4>
              <div class="flex gap-2">
                <el-input
                  v-model="joinRoomCode"
                  placeholder="输入房间码"
                  maxlength="6"
                  class="flex-1"
                  @keyup.enter="joinRoom"
                  data-testid="join-room-code-input"
                />
                <el-button
                  type="primary"
                  :disabled="!joinRoomCode || battleClientStore.currentState.status !== 'connected'"
                  @click="joinRoom"
                  data-testid="join-private-room-button"
                >
                  加入
                </el-button>
                <el-button
                  type="info"
                  :disabled="!joinRoomCode || battleClientStore.currentState.status !== 'connected'"
                  @click="joinAsSpectator"
                >
                  观战
                </el-button>
              </div>
            </div>
          </template>
        </div>
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
          <li>如果暂时连不上服务器 可能是因为服务器处于休眠状态 等待一下后重连或者刷新即可</li>
          <li>人机对战可以在没有连接服务器的情况下进行</li>
          <li>群号：805146068</li>
        </ul>
      </el-alert>
    </div>

    <!-- 创建房间对话框 -->
    <el-dialog v-model="showCreateRoomDialog" title="创建私人房间" width="400px">
      <el-form :model="roomConfig" label-width="100px">
        <el-form-item label="房间密码">
          <el-input v-model="roomConfig.password" placeholder="留空为公开房间" show-password />
        </el-form-item>
        <el-form-item label="P2P 传输">
          <el-radio-group v-model="roomConfig.p2pTransport">
            <el-radio value="auto">自动</el-radio>
            <el-radio value="webrtc">WebRTC</el-radio>
            <el-radio value="relay">Relay</el-radio>
          </el-radio-group>
          <div class="text-xs text-gray-500 mt-2">自动模式下，浏览器手测优先 WebRTC，受限环境会回退到 Relay。</div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showCreateRoomDialog = false">取消</el-button>
        <el-button type="primary" data-testid="confirm-create-private-room-button" @click="createRoom">创建</el-button>
      </template>
    </el-dialog>
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
import { usePrivateRoomStore } from '@/stores/privateRoom'
import { type BattleClient, RemoteBattleSystem } from '@arcadia-eternity/client'
import {
  User,
  Document,
  Monitor,
  Setting,
  FolderOpened,
  Collection,
  Download,
  Warning,
  Trophy,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { isDesktop } from '@/utils/env'
import RuleSetTooltip from '@/components/RuleSetTooltip.vue'
import TeamSelector from '@/components/TeamSelector.vue'
import { BattleReportService } from '@/services/battleReportService'

const router = useRouter()
const route = useRoute()
const battleStore = useBattleStore()
const playerStore = usePlayerStore()
const battleClientStore = useBattleClientStore()
const petStorageStore = usePetStorageStore()
const eloStore = useEloStore()
const validationStore = useValidationStore()
const privateRoomStore = usePrivateRoomStore()

// 匹配配置状态
const selectedTeam = ref<any | null>(null)
const isSelectedTeamValid = ref(false)
const selectedTeamValidationErrors = ref<string[]>([])

// 私人房间状态
const showCreateRoomDialog = ref(false)
const joinRoomCode = ref('')
const roomConfig = ref({
  password: '',
  p2pTransport: 'auto' as 'auto' | 'webrtc' | 'relay',
})

// 计算属性
const availableRuleSets = computed(() => validationStore.availableRuleSets)
const selectedRuleSetId = computed({
  get: () => validationStore.selectedRuleSetId,
  set: (value: string) => {
    validationStore.setSelectedRuleSet(value)
    selectedTeam.value = null
  },
})

// ELO相关计算属性
const ruleSetElos = computed(() => {
  const eloMap: Record<string, any> = {}
  availableRuleSets.value.forEach(ruleSet => {
    eloMap[ruleSet.id] = eloStore.getEloForRuleSet(ruleSet.id)
  })
  return eloMap
})

const goToCurrentRoom = () => {
  if (privateRoomStore.currentRoom) {
    router.push(`/room/${privateRoomStore.currentRoom.config.roomCode}`)
  }
}

// 启用ELO的规则集列表
const eloEnabledRuleSets = ref<string[]>([])

// 检查规则集是否启用ELO
const isEloEnabled = (ruleSetId: string) => {
  return eloEnabledRuleSets.value.includes(ruleSetId)
}

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

const isMatchButtonDisabled = computed(() => {
  const state = battleClientStore.currentState

  // If we are currently searching for a match, the button should be ENABLED to allow cancellation.
  if (state.matchmaking === 'searching') {
    return false
  }

  // If we are already matched or not connected, the button should be DISABLED.
  if (state.matchmaking === 'matched' || state.status !== 'connected') {
    return true
  }

  // Otherwise (status is 'waiting'), disable the button if prerequisites are not met.
  return !selectedRuleSetId.value || !selectedTeam.value || !isSelectedTeamValid.value
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
    if (!selectedTeam.value) {
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
      saveLastMatchingConfig()
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

const saveLastMatchingConfig = () => {
  if (!selectedTeam.value) return

  const actualTeamIndex = petStorageStore.teams.findIndex(
    team => team.name === selectedTeam.value.name && team.ruleSetId === selectedTeam.value.ruleSetId,
  )

  if (actualTeamIndex >= 0) {
    petStorageStore.saveLastMatchingConfig(actualTeamIndex, selectedRuleSetId.value)
  }
}

// 私人房间相关方法
const createRoom = async () => {
  try {
    const config = {
      ruleSetId: selectedRuleSetId.value,
      isPrivate: !!roomConfig.value.password,
      password: roomConfig.value.password || undefined,
      p2pTransport: roomConfig.value.p2pTransport,
    }

    const roomCode = await privateRoomStore.createRoom(config)

    showCreateRoomDialog.value = false
    roomConfig.value = {
      password: '',
      p2pTransport: 'auto',
    }
    ElMessage.success(`房间创建成功！房间码: ${roomCode}`)

    // 跳转到房间页面
    router.push(`/room/${roomCode}`)
  } catch (error) {
    ElMessage.error('创建房间失败: ' + (error as Error).message)
  }
}

const joinRoom = async () => {
  try {
    if (!joinRoomCode.value) {
      ElMessage.error('请输入房间码')
      return
    }

    await privateRoomStore.joinRoom(joinRoomCode.value)

    ElMessage.success('成功加入房间')

    // 跳转到房间页面
    router.push(`/room/${joinRoomCode.value}`)
  } catch (error) {
    ElMessage.error('加入房间失败: ' + (error as Error).message)
  }
}

const joinAsSpectator = async () => {
  try {
    if (!joinRoomCode.value) {
      ElMessage.error('请输入房间码')
      return
    }

    await privateRoomStore.joinAsSpectator(joinRoomCode.value)

    ElMessage.success('成功加入观战')

    // 跳转到房间页面
    router.push(`/room/${joinRoomCode.value}`)
  } catch (error) {
    ElMessage.error('加入观战失败: ' + (error as Error).message)
  }
}

const loadLastMatchingConfig = async () => {
  const config = petStorageStore.getLastMatchingConfig()
  if (!config) return false

  const allTeams = petStorageStore.teams
  if (config.teamIndex >= 0 && config.teamIndex < allTeams.length) {
    const targetTeam = allTeams[config.teamIndex]
    const teamRuleSetId = targetTeam.ruleSetId || 'casual_standard_ruleset'

    if (availableRuleSets.value.find(r => r.id === teamRuleSetId)) {
      selectedRuleSetId.value = teamRuleSetId
      await nextTick()
      selectedTeam.value = targetTeam
      return true
    }
  }
  return false
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

  await loadLastMatchingConfig()

  // 现在配置已经完全恢复，检查是否需要开始匹配
  if (route.query.startMatching === 'true') {
    await nextTick()
    handleMatchmaking()
  }
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
