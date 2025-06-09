<template>
  <div v-if="isDeveloperMode">
    <!-- 开发者面板内容 -->
    <div
      v-if="isPanelOpen"
      class="fixed top-5 right-5 w-96 max-h-[80vh] bg-white border border-gray-300 rounded-lg shadow-xl overflow-hidden z-[1000]"
    >
      <div class="bg-gray-100 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
        <h3 class="text-lg font-semibold text-gray-800 m-0">开发者调试面板</h3>
        <button
          @click="isPanelOpen = false"
          class="w-8 h-8 bg-gray-200 hover:bg-gray-300 rounded-full border-none cursor-pointer flex items-center justify-center text-gray-600 text-xl"
        >
          ×
        </button>
      </div>

      <div class="p-4 overflow-y-auto max-h-[calc(80vh-60px)]">
        <!-- 快速操作区 -->
        <div class="mb-6 pb-4 border-b border-gray-200">
          <h4 class="text-base font-semibold text-gray-700 mb-3">快速操作</h4>
          <div class="flex flex-wrap gap-2">
            <button
              @click="fullHealCurrentPet"
              class="px-3 py-1.5 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors border-none cursor-pointer"
            >
              满血当前宠物
            </button>
            <button
              @click="fullRageCurrentPlayer"
              class="px-3 py-1.5 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors border-none cursor-pointer"
            >
              满怒气
            </button>

            <button
              @click="forceAIAction"
              class="px-3 py-1.5 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors border-none cursor-pointer"
            >
              强制AI行动
            </button>
          </div>
        </div>

        <!-- 血量调节区 -->
        <div class="mb-6 pb-4 border-b border-gray-200">
          <h4 class="text-base font-semibold text-gray-700 mb-3">血量调节</h4>
          <div class="space-y-3">
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-gray-600">当前宠物血量:</label>
              <input
                type="range"
                :min="0"
                :max="currentPetMaxHp"
                v-model.number="currentPetHp"
                @input="updateCurrentPetHp"
                class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <span class="text-sm text-gray-700 font-mono">{{ currentPetHp }} / {{ currentPetMaxHp }}</span>
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-gray-600">对手宠物血量:</label>
              <input
                type="range"
                :min="0"
                :max="opponentPetMaxHp"
                v-model.number="opponentPetHp"
                @input="updateOpponentPetHp"
                class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <span class="text-sm text-gray-700 font-mono">{{ opponentPetHp }} / {{ opponentPetMaxHp }}</span>
            </div>
          </div>
        </div>

        <!-- 怒气调节区 -->
        <div class="mb-6 pb-4 border-b border-gray-200">
          <h4 class="text-base font-semibold text-gray-700 mb-3">怒气调节</h4>
          <div class="space-y-3">
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-gray-600">当前玩家怒气:</label>
              <input
                type="range"
                :min="0"
                :max="150"
                v-model.number="currentPlayerRage"
                @input="updateCurrentPlayerRage"
                class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <span class="text-sm text-gray-700 font-mono">{{ currentPlayerRage }}</span>
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-gray-600">对手怒气:</label>
              <input
                type="range"
                :min="0"
                :max="150"
                v-model.number="opponentPlayerRage"
                @input="updateOpponentPlayerRage"
                class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <span class="text-sm text-gray-700 font-mono">{{ opponentPlayerRage }}</span>
            </div>
          </div>
        </div>

        <!-- AI控制区 -->
        <div class="mb-6 pb-4 border-b border-gray-200">
          <h4 class="text-base font-semibold text-gray-700 mb-3">AI控制</h4>
          <div class="space-y-3">
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-gray-600">
                <input type="checkbox" v-model="aiControlEnabled" class="mr-2" />
                接管AI决策
              </label>
            </div>
            <div v-if="aiControlEnabled" class="space-y-2">
              <div class="flex justify-between items-center mb-2">
                <h5 class="text-sm font-medium text-gray-600">强制AI选择:</h5>
                <button
                  @click="refreshAIActions"
                  class="px-2 py-1 bg-gray-500 text-white text-xs rounded hover:bg-gray-600 transition-colors border-none cursor-pointer"
                  title="刷新AI可用操作"
                >
                  🔄 刷新
                </button>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="action in availableAIActions"
                  :key="getActionKey(action)"
                  @click="forceAISelection(action)"
                  class="px-2 py-1 bg-green-500 text-white text-xs rounded hover:bg-green-600 transition-colors border-none cursor-pointer"
                >
                  {{ getActionDisplayName(action) }}
                </button>
              </div>
              <div v-if="availableAIActions.length === 0" class="text-xs text-gray-500 italic">当前无可用操作</div>
            </div>
          </div>
        </div>

        <!-- 战斗状态信息区 -->
        <div class="mb-0">
          <h4 class="text-base font-semibold text-gray-700 mb-3">战斗状态信息</h4>
          <div class="space-y-2">
            <div class="text-sm text-gray-700"><strong class="font-medium">当前回合:</strong> {{ currentTurn }}</div>
            <div class="text-sm text-gray-700"><strong class="font-medium">战斗阶段:</strong> {{ currentPhase }}</div>
            <div class="text-sm text-gray-700">
              <strong class="font-medium">随机种子:</strong> {{ battleSeed || '未设置' }}
            </div>
            <div class="text-sm text-gray-700"><strong class="font-medium">消息数量:</strong> {{ messageCount }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useBattleStore } from '@/stores/battle'
import type { PlayerSelection } from '@arcadia-eternity/const'
import i18next from 'i18next'

// Props
interface Props {
  isDeveloperMode?: boolean
  isOpen?: boolean
}

const props = defineProps<Props>()

// Emits
const emit = defineEmits<{
  'update:isOpen': [value: boolean]
}>()

// 计算属性
const isPanelOpen = computed({
  get: () => props.isOpen ?? false,
  set: value => emit('update:isOpen', value),
})

// Store
const battleStore = useBattleStore()

// 面板状态
const aiControlEnabled = ref(false)

// 计算属性
const currentPlayer = computed(() => battleStore.currentPlayer)
const opponentPlayer = computed(() => battleStore.opponent)
const currentTurn = computed(() => battleStore.battleState?.currentTurn ?? 0)
const currentPhase = computed(() => battleStore.battleState?.currentPhase ?? 'Unknown')
const messageCount = computed(() => battleStore.log.length)
const battleSeed = computed(() => (battleStore.battleState as any)?.rngSeed)

// 当前宠物信息
const currentPet = computed(() => {
  if (!currentPlayer.value?.activePet) return null
  return battleStore.getPetById(currentPlayer.value.activePet)
})

const opponentPet = computed(() => {
  if (!opponentPlayer.value?.activePet) return null
  return battleStore.getPetById(opponentPlayer.value.activePet)
})

// 血量相关
const currentPetHp = ref(0)
const currentPetMaxHp = computed(() => currentPet.value?.maxHp ?? 100)
const opponentPetHp = ref(0)
const opponentPetMaxHp = computed(() => opponentPet.value?.maxHp ?? 100)

// 怒气相关
const currentPlayerRage = ref(0)
const opponentPlayerRage = ref(0)

// AI可用操作
const availableAIActions = computed(() => {
  if (!opponentPlayer.value) return []

  // 添加对战斗状态的依赖，确保在状态变化时重新计算
  const battleState = battleStore.battleState
  const currentTurn = battleState?.currentTurn
  const currentPhase = battleState?.currentPhase

  // 触发重新计算（通过访问这些响应式数据）
  if (!battleState || currentTurn === undefined || !currentPhase) {
    return []
  }

  return battleStore.getAvailableActionsForPlayer?.(opponentPlayer.value.id) ?? []
})

// 方法

const updateDisplayValues = () => {
  if (currentPet.value) {
    currentPetHp.value = currentPet.value.currentHp
  }
  if (opponentPet.value) {
    opponentPetHp.value = opponentPet.value.currentHp
  }
  if (currentPlayer.value) {
    currentPlayerRage.value = currentPlayer.value.rage
  }
  if (opponentPlayer.value) {
    opponentPlayerRage.value = opponentPlayer.value.rage
  }
}

// 监听宠物变化，更新血量和怒气显示
watch(
  [currentPet, opponentPet, currentPlayer, opponentPlayer],
  () => {
    updateDisplayValues()
  },
  { immediate: true },
)

// 监听怒气值的具体变化
watch(
  () => currentPlayer.value?.rage,
  newRage => {
    if (newRage !== undefined) {
      currentPlayerRage.value = newRage
    }
  },
)

watch(
  () => opponentPlayer.value?.rage,
  newRage => {
    if (newRage !== undefined) {
      opponentPlayerRage.value = newRage
    }
  },
)

// 监听血量值的具体变化
watch(
  () => currentPet.value?.currentHp,
  newHp => {
    if (newHp !== undefined) {
      currentPetHp.value = newHp
    }
  },
)

watch(
  () => opponentPet.value?.currentHp,
  newHp => {
    if (newHp !== undefined) {
      opponentPetHp.value = newHp
    }
  },
)

// 监听战斗状态变化，自动刷新AI可用操作
watch(
  [
    () => battleStore.battleState?.currentTurn,
    () => battleStore.battleState?.currentPhase,
    () => opponentPlayer.value?.rage,
    () => opponentPlayer.value?.activePet,
  ],
  () => {
    if (aiControlEnabled.value && opponentPlayer.value) {
      console.debug('战斗状态变化，AI可用操作已自动更新')
    }
  },
  { deep: true },
)

// 快速操作方法
const fullHealCurrentPet = () => {
  if (currentPet.value) {
    battleStore.setDevPetHp(currentPet.value.id, currentPetMaxHp.value)
    currentPetHp.value = currentPetMaxHp.value
  }
}

const fullRageCurrentPlayer = () => {
  if (currentPlayer.value) {
    battleStore.setDevPlayerRage(currentPlayer.value.id, 150)
    currentPlayerRage.value = 150
  }
}

const forceAIAction = () => {
  if (availableAIActions.value.length > 0) {
    const randomAction = availableAIActions.value[Math.floor(Math.random() * availableAIActions.value.length)]
    battleStore.forceAISelection(randomAction)
  }
}

// 血量和怒气更新方法
const updateCurrentPetHp = () => {
  if (currentPet.value) {
    battleStore.setDevPetHp(currentPet.value.id, currentPetHp.value)
  }
}

const updateOpponentPetHp = () => {
  if (opponentPet.value) {
    battleStore.setDevPetHp(opponentPet.value.id, opponentPetHp.value)
  }
}

const updateCurrentPlayerRage = () => {
  if (currentPlayer.value) {
    battleStore.setDevPlayerRage(currentPlayer.value.id, currentPlayerRage.value)
  }
}

const updateOpponentPlayerRage = () => {
  if (opponentPlayer.value) {
    battleStore.setDevPlayerRage(opponentPlayer.value.id, opponentPlayerRage.value)
  }
}

// AI控制方法
const forceAISelection = (action: PlayerSelection) => {
  battleStore.forceAISelection(action)
}

const refreshAIActions = () => {
  // 强制触发计算属性重新计算
  // 通过访问battleStore的状态来触发响应式更新
  console.debug('刷新AI可用操作，当前对手:', opponentPlayer.value?.id)
  console.debug('当前可用操作数量:', availableAIActions.value.length)
}

// 获取技能名称的i18n翻译
const getSkillName = (skillId: string): string => {
  try {
    return i18next.t(`${skillId}.name`, { ns: 'skill' }) || skillId
  } catch {
    return skillId.replace(/^skill_/, '').replace(/_/g, ' ')
  }
}

// 生成操作的唯一key
const getActionKey = (action: PlayerSelection): string => {
  switch (action.type) {
    case 'use-skill':
      return `${action.type}-${action.skill}`
    case 'switch-pet':
      return `${action.type}-${action.pet}`
    case 'surrender':
    case 'do-nothing':
      return action.type
    default:
      return `unknown-${Math.random()}`
  }
}

const getActionDisplayName = (action: PlayerSelection) => {
  switch (action.type) {
    case 'use-skill':
      const skill = battleStore.skillMap.get(action.skill)
      if (skill) {
        // 尝试获取技能的基础ID，如果没有则使用实例ID
        const skillId = skill.baseId || action.skill
        // 使用i18n翻译获取技能名称
        const displayName = getSkillName(skillId)
        return `使用技能: ${displayName}`
      }
      return `使用技能: ${action.skill}`
    case 'switch-pet':
      const pet = battleStore.getPetById(action.pet)
      return `切换宠物: ${pet?.name || action.pet}`
    case 'surrender':
      return '投降'
    case 'do-nothing':
      return '什么都不做'
    default:
      return '未知操作'
  }
}
</script>

<style scoped>
/* 滑块样式 */
input[type='range']::-webkit-slider-thumb {
  appearance: none;
  width: 1rem;
  height: 1rem;
  background-color: #3b82f6;
  border-radius: 50%;
  cursor: pointer;
}

input[type='range']::-moz-range-thumb {
  width: 1rem;
  height: 1rem;
  background-color: #3b82f6;
  border-radius: 50%;
  cursor: pointer;
  border: none;
}

/* 响应式调整 */
@media (max-width: 768px) {
  .dev-panel-content {
    width: 350px;
    max-height: 70vh;
  }

  .developer-panel {
    top: 10px;
    right: 10px;
  }
}

@media (max-width: 480px) {
  .dev-panel-content {
    width: calc(100vw - 40px);
    right: -10px;
  }
}
</style>
