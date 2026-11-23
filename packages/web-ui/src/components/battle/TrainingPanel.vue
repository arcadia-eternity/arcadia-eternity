<template>
  <div
    class="fixed top-5 right-5 w-96 max-h-[80vh] bg-white border border-gray-300 rounded-lg shadow-xl overflow-hidden z-[1000]"
  >
    <div class="bg-gray-100 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
      <h3 class="text-lg font-semibold text-gray-800 m-0">训练面板</h3>
      <button
        aria-label="关闭训练面板"
        @click="$emit('close')"
        class="w-8 h-8 bg-gray-200 hover:bg-gray-300 rounded-full border-none cursor-pointer flex items-center justify-center text-gray-600 text-xl"
      >
        ×
      </button>
    </div>

    <div class="p-4 overflow-y-auto max-h-[calc(80vh-60px)]">
      <p v-if="error" role="alert" class="text-sm text-red-600">{{ error }}</p>
      <fieldset class="m-0 min-w-0 border-0 p-0" :disabled="!training?.editable">
        <!-- 快速操作区 -->
        <div class="mb-6 pb-4 border-b border-gray-200">
          <h4 class="text-base font-semibold text-gray-700 mb-3">快速操作</h4>
          <div class="flex flex-wrap gap-2">
            <button
              @click="currentPet && run({ type: 'set-hp', pet: currentPet.id, value: currentPet.maxHp })"
              class="px-3 py-1.5 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors border-none cursor-pointer"
            >
              满血当前宠物
            </button>
            <button
              @click="
                currentPlayer && run({ type: 'set-rage', player: currentPlayer.id, value: currentPlayer.maxRage })
              "
              class="px-3 py-1.5 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors border-none cursor-pointer"
            >
              满怒气
            </button>
            <button
              @click="battleStore.refreshCurrentPlayerActions()"
              class="px-3 py-1.5 bg-purple-500 text-white text-sm rounded hover:bg-purple-600 transition-colors border-none cursor-pointer"
              title="刷新当前玩家的可用操作"
            >
              刷新己方可选项
            </button>
            <button
              @click="run({ type: 'choose-ai' })"
              :disabled="!training?.choices.length"
              class="px-3 py-1.5 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors border-none cursor-pointer"
            >
              强制刷新AI选择
            </button>
          </div>
        </div>

        <!-- 血量调节区 -->
        <div class="mb-6 pb-4 border-b border-gray-200">
          <h4 class="text-base font-semibold text-gray-700 mb-3">血量调节</h4>
          <div class="space-y-3">
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-gray-600" for="current-pet-hp">当前宠物血量:</label>
              <input
                type="range"
                :min="0"
                id="current-pet-hp"
                :max="currentPet?.maxHp ?? 0"
                :value="currentPet?.currentHp ?? 0"
                @change="currentPet && run({ type: 'set-hp', pet: currentPet.id, value: rangeValue($event) })"
                class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <span class="text-sm text-gray-700 font-mono">{{ currentPet?.currentHp }} / {{ currentPet?.maxHp }}</span>
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-gray-600" for="opponent-pet-hp">对手宠物血量:</label>
              <input
                type="range"
                :min="0"
                id="opponent-pet-hp"
                :max="opponentPet?.maxHp ?? 0"
                :value="opponentPet?.currentHp ?? 0"
                @change="opponentPet && run({ type: 'set-hp', pet: opponentPet.id, value: rangeValue($event) })"
                class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <span class="text-sm text-gray-700 font-mono"
                >{{ opponentPet?.currentHp }} / {{ opponentPet?.maxHp }}</span
              >
            </div>
          </div>
        </div>

        <!-- 怒气调节区 -->
        <div class="mb-6 pb-4 border-b border-gray-200">
          <h4 class="text-base font-semibold text-gray-700 mb-3">怒气调节</h4>
          <div class="space-y-3">
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-gray-600" for="current-rage">当前玩家怒气:</label>
              <input
                type="range"
                :min="0"
                id="current-rage"
                :max="currentPlayer?.maxRage ?? 0"
                :value="currentPlayer?.rage ?? 0"
                @change="
                  currentPlayer && run({ type: 'set-rage', player: currentPlayer.id, value: rangeValue($event) })
                "
                class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <span class="text-sm text-gray-700 font-mono">{{ currentPlayer?.rage }}</span>
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-gray-600" for="opponent-rage">对手怒气:</label>
              <input
                type="range"
                :min="0"
                id="opponent-rage"
                :max="opponentPlayer?.maxRage ?? 0"
                :value="opponentPlayer?.rage ?? 0"
                @change="
                  opponentPlayer && run({ type: 'set-rage', player: opponentPlayer.id, value: rangeValue($event) })
                "
                class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <span class="text-sm text-gray-700 font-mono">{{ opponentPlayer?.rage }}</span>
            </div>
          </div>
        </div>

        <!-- AI控制区 -->
        <div class="mb-6 pb-4 border-b border-gray-200">
          <h4 class="text-base font-semibold text-gray-700 mb-3">AI控制</h4>
          <div class="space-y-3">
            <div class="space-y-2">
              <div class="flex justify-between items-center mb-2">
                <h5 class="text-sm font-medium text-gray-600">强制AI选择:</h5>
                <button
                  @click="run({ type: 'inspect' })"
                  class="px-2 py-1 bg-gray-500 text-white text-xs rounded hover:bg-gray-600 transition-colors border-none cursor-pointer"
                  title="刷新AI可用操作"
                >
                  🔄 刷新
                </button>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="choice in training?.choices"
                  :key="choice.key"
                  :aria-pressed="choice.selected"
                  :class="{ 'ring-2 ring-green-800': choice.selected }"
                  @click="run({ type: 'choose-ai', key: choice.key })"
                  class="px-2 py-1 bg-green-500 text-white text-xs rounded hover:bg-green-600 transition-colors border-none cursor-pointer"
                >
                  {{ getActionDisplayName(choice) }}
                </button>
              </div>
              <div v-if="!training?.choices.length" class="text-xs text-gray-500 italic">当前无可用操作</div>
            </div>
          </div>
        </div>
      </fieldset>
      <!-- 战斗状态信息区 -->
      <div class="mb-0">
        <h4 class="text-base font-semibold text-gray-700 mb-3">战斗状态信息</h4>
        <div class="space-y-2">
          <div class="text-sm text-gray-700">
            <strong class="font-medium">当前回合:</strong> {{ battleStore.battleState?.currentTurn }}
          </div>
          <div class="text-sm text-gray-700">
            <strong class="font-medium">战斗阶段:</strong> {{ battleStore.battleState?.currentPhase }}
          </div>
          <div class="text-sm text-gray-700">
            <strong class="font-medium">随机种子:</strong> {{ training?.seed ?? '未设置' }}
          </div>
          <div class="text-sm text-gray-700">
            <strong class="font-medium">消息数量:</strong> {{ battleStore.log.length }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, shallowRef, ref, watch } from 'vue'
import type { TrainingCommand, TrainingState } from '@arcadia-eternity/battle/host'
import { useBattleStore } from '@/stores/battle'
import i18next from 'i18next'

defineEmits<{ close: [] }>()
const battleStore = useBattleStore()
const currentPlayer = computed(() => battleStore.currentPlayer)
const opponentPlayer = computed(() => battleStore.opponent)
const currentPet = computed(() => currentPlayer.value && battleStore.getPetById(currentPlayer.value.activePet))
const opponentPet = computed(() => opponentPlayer.value && battleStore.getPetById(opponentPlayer.value.activePet))
const training = shallowRef<TrainingState>()
const error = ref('')
let request = 0

function rangeValue(event: Event) {
  return (event.currentTarget as HTMLInputElement).valueAsNumber
}

async function run(command: TrainingCommand) {
  const system = battleStore.trainingSystem
  if (!system) return
  const id = ++request
  try {
    const state = await system.runTrainingCommand(command)
    if (battleStore.trainingSystem !== system) return
    if (id === request) {
      training.value = state
      error.value = ''
    }
    if (command.type === 'set-rage' || command.type === 'set-hp') await battleStore.refreshCurrentPlayerActions()
  } catch (cause) {
    if (id === request) error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

watch(
  [
    () => battleStore.trainingSystem,
    () => battleStore.battleState?.currentTurn,
    () => battleStore.battleState?.currentPhase,
    () => battleStore.battleState?.status,
    () => opponentPlayer.value?.activePet,
    () => opponentPlayer.value?.rage,
  ],
  () => void run({ type: 'inspect' }),
  { immediate: true },
)

function getActionDisplayName(choice: TrainingState['choices'][number]) {
  switch (choice.type) {
    case 'use-skill':
      return `使用技能: ${i18next.t(`${choice.skillId}.name`, { ns: 'skill', defaultValue: choice.skillId })}`
    case 'switch-pet':
      return `切换宠物: ${choice.petName}`
    case 'surrender':
      return '投降'
    case 'do-nothing':
      return '什么都不做'
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
