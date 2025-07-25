<template>
  <div
    class="w-[1000px] mx-auto bg-gray-900 text-white p-6 rounded-lg shadow-2xl box-border"
    :class="{ 'p-4': isMobile }"
  >
    <!-- Header -->
    <div class="flex justify-between items-center mb-6" :class="{ 'flex-col gap-3': isMobile }">
      <h2 class="text-2xl font-bold text-blue-300">{{ title }}</h2>
      <div v-if="timeLimit && timeLimit > 0" class="flex items-center gap-3">
        <div class="w-32 h-2 bg-gray-600 rounded-full overflow-hidden" :class="{ 'w-full': isMobile }">
          <div
            class="h-full bg-blue-500 transition-all duration-300"
            :style="{ width: `${timerProgress}%` }"
            :class="{
              'bg-yellow-500': timerProgress < 30,
              'bg-red-500': timerProgress < 10,
            }"
          ></div>
        </div>
        <span class="text-lg font-mono">{{ formatTime(remainingTime) }}</span>
      </div>
    </div>

    <!-- Team Selection Area -->
    <div class="flex flex-col gap-6">
      <!-- Full Team Display -->
      <div class="bg-gray-800 p-4 rounded-lg">
        <h3 class="text-lg font-semibold mb-4 text-blue-200">{{ $t('teamSelection.fullTeam', { ns: 'battle' }) }}</h3>
        <div class="flex flex-wrap gap-3 justify-center">
          <div
            v-for="pet in fullTeam"
            :key="pet.id"
            class="relative w-[120px] min-h-[140px] bg-gray-700 p-3 rounded-lg cursor-pointer transition-all duration-200 flex flex-col items-center"
            :class="{
              'bg-blue-600 ring-2 ring-blue-400': isSelected(pet.id),
              'ring-2 ring-yellow-400': pet.id === starterPetId,
              'opacity-50 cursor-not-allowed': !canSelectPet(pet.id),
              'hover:bg-gray-600 hover:shadow-lg': canSelectPet(pet.id),
              'w-[100px] min-h-[120px] p-2': isMobile,
            }"
            @click="togglePetSelection(pet.id)"
          >
            <PetIcon
              :id="getPetSpeciesID(pet)"
              :isUnknown="pet.isUnknown || false"
              class="w-[60px] h-[60px] flex-shrink-0"
              :class="{ 'w-[50px] h-[50px]': isMobile }"
            />
            <div class="mt-2 text-center">
              <div class="text-sm font-medium">{{ pet.name }}</div>
              <div class="text-xs text-gray-300">{{ $t('levelShort', { ns: 'webui' }) }}{{ pet.level }}</div>
              <div class="text-xs text-green-400">{{ pet.currentHp }}/{{ getPetMaxHp(pet) }}</div>
            </div>
            <div class="absolute top-1 right-1 flex gap-1">
              <div
                v-if="isSelected(pet.id)"
                class="w-5 h-5 bg-blue-500 text-white text-xs rounded-full flex items-center justify-center font-bold"
              >
                {{ getSelectionOrder(pet.id) }}
              </div>
              <div
                v-if="pet.id === starterPetId"
                class="w-5 h-5 bg-yellow-500 text-black text-xs rounded-full flex items-center justify-center font-bold"
              >
                ★
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Opponent Team Display (if visible) -->
      <div v-if="showOpponentTeam && opponentTeam" class="bg-gray-800 p-4 rounded-lg border border-red-500/30">
        <h3 class="text-lg font-semibold mb-4 text-red-200">
          {{ $t('teamSelection.opponentTeam', { ns: 'battle' }) }}
        </h3>
        <div class="flex flex-wrap gap-3 justify-center">
          <div
            v-for="pet in getVisibleOpponentPets()"
            :key="pet.id"
            class="relative w-[120px] min-h-[140px] bg-gray-700 p-3 rounded-lg flex flex-col items-center cursor-default"
            :class="{ 'w-[100px] min-h-[120px] p-2': isMobile }"
          >
            <PetIcon
              :id="getPetSpeciesID(pet)"
              :isUnknown="pet.isUnknown || false"
              class="w-[60px] h-[60px] flex-shrink-0"
              :class="{ 'w-[50px] h-[50px]': isMobile }"
            />
            <div v-if="config.teamInfoVisibility !== 'HIDDEN'" class="mt-2 text-center">
              <div class="text-sm font-medium">{{ pet.name }}</div>
              <div v-if="config.teamInfoVisibility === 'FULL'" class="text-xs text-gray-300">
                {{ $t('levelShort', { ns: 'webui' }) }}{{ pet.level }}
              </div>
              <div v-if="config.teamInfoVisibility === 'FULL'" class="text-xs text-green-400">
                {{ pet.currentHp }}/{{ getPetMaxHp(pet) }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="flex gap-4 justify-center" :class="{ 'flex-col': isMobile }">
      <button
        class="px-6 py-3 bg-gray-600 text-white rounded-lg font-medium transition-all duration-200 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
        :class="{ 'min-h-[48px] text-lg': isMobile }"
        @click="resetSelection"
        :disabled="!canReset"
      >
        {{ $t('teamSelection.reset', { ns: 'battle' }) }}
      </button>

      <button
        class="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium transition-all duration-200 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        :class="{ 'min-h-[48px] text-lg': isMobile }"
        @click="confirmSelection"
        :disabled="!canConfirm"
      >
        {{ $t('teamSelection.confirm', { ns: 'battle' }) }}
      </button>
    </div>

    <!-- Selection Status -->
    <div
      v-if="config.mode === 'TEAM_SELECTION'"
      class="flex flex-wrap gap-4 justify-center text-sm"
      :class="{ 'flex-col gap-2': isMobile }"
    >
      <div class="flex items-center gap-2 min-w-[120px]">
        <span class="text-gray-400">{{ $t('teamSelection.selected', { ns: 'battle' }) }}:</span>
        <span class="text-white font-medium">{{ selectedPets.length }}/{{ config.maxTeamSize || 6 }}</span>
      </div>
      <div v-if="config.allowStarterSelection" class="flex items-center gap-2 min-w-[150px]">
        <span class="text-gray-400">{{ $t('teamSelection.starter', { ns: 'battle' }) }}:</span>
        <span class="text-white font-medium truncate max-w-[100px]">{{
          starterPetId ? getPetById(starterPetId)?.name : $t('teamSelection.notSelected', { ns: 'battle' })
        }}</span>
      </div>
      <div v-if="opponentProgress" class="flex items-center gap-2 min-w-[150px]">
        <span class="text-gray-400">{{ $t('teamSelection.opponentStatus', { ns: 'battle' }) }}:</span>
        <span class="font-medium" :class="getOpponentStatusClass()">{{ getOpponentStatusText() }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useMobile } from '@/composition/useMobile'
import { useGameDataStore } from '@/stores/gameData'
import PetIcon from '../PetIcon.vue'
import type { BattleTeamSelection, TeamSelectionConfig, PetMessage } from '@arcadia-eternity/const'
import i18next from 'i18next'

interface Props {
  fullTeam: PetMessage[]
  opponentTeam?: PetMessage[]
  config: TeamSelectionConfig
  timeLimit?: number
  initialSelection?: BattleTeamSelection
  opponentProgress?: 'not_started' | 'in_progress' | 'completed'
  opponentSelection?: BattleTeamSelection
}

interface Emits {
  (e: 'selectionChange', selection: BattleTeamSelection): void
  (e: 'confirm', selection: BattleTeamSelection): void
  (e: 'timeout'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const { isMobile } = useMobile()
const gameDataStore = useGameDataStore()

// 安全获取精灵最大血量的辅助函数
const getPetMaxHp = (pet: PetMessage): number => {
  return pet.maxHp || pet.stats?.maxHp || 100
}

// 安全获取精灵种族ID的辅助函数
const getPetSpeciesID = (pet: PetMessage): number => {
  // 使用 gameDataStore 获取种族数据，然后使用 species.num
  const species = gameDataStore.getSpecies(pet.speciesID)
  if (species && species.num) {
    return species.num
  }
  // 如果找不到种族数据，返回默认值
  return 999
}

// Reactive state
const selectedPets = ref<string[]>(props.initialSelection?.selectedPets || [])
const starterPetId = ref<string>(props.initialSelection?.starterPetId || '')
const remainingTime = ref(props.timeLimit || 0)

// Timer
let timerInterval: ReturnType<typeof setInterval> | null = null

// Computed properties
const title = computed(() => {
  switch (props.config.mode) {
    case 'VIEW_ONLY':
      return i18next.t('battle:teamSelection.titles.viewOnly')
    case 'TEAM_SELECTION':
      return i18next.t('battle:teamSelection.titles.teamSelection')
    case 'FULL_TEAM':
      return props.config.allowStarterSelection
        ? i18next.t('battle:teamSelection.titles.fullTeamWithStarter')
        : i18next.t('battle:teamSelection.titles.fullTeamPreview')
    default:
      return i18next.t('battle:teamSelection.titles.default')
  }
})

const showOpponentTeam = computed(() => {
  return props.config.showOpponentTeam && props.config.teamInfoVisibility !== 'HIDDEN'
})

const timerProgress = computed(() => {
  if (!props.timeLimit) return 100
  return (remainingTime.value / props.timeLimit) * 100
})

const canConfirm = computed(() => {
  if (props.config.mode === 'VIEW_ONLY') return true
  if (props.config.mode === 'FULL_TEAM') {
    return !props.config.allowStarterSelection || starterPetId.value !== ''
  }

  const minSize = props.config.minTeamSize || 1
  const maxSize = props.config.maxTeamSize || 6
  const hasValidSelection = selectedPets.value.length >= minSize && selectedPets.value.length <= maxSize
  const hasValidStarter =
    !props.config.allowStarterSelection || (starterPetId.value && selectedPets.value.includes(starterPetId.value))

  return hasValidSelection && hasValidStarter
})

const canReset = computed(() => {
  return selectedPets.value.length > 0 || starterPetId.value !== ''
})

// Methods
const isSelected = (petId: string): boolean => {
  return selectedPets.value.includes(petId)
}

const canSelectPet = (petId: string): boolean => {
  if (props.config.mode !== 'TEAM_SELECTION') return false

  const pet = getPetById(petId)
  if (!pet || pet.currentHp <= 0) return false

  const maxSize = props.config.maxTeamSize || 6
  return isSelected(petId) || selectedPets.value.length < maxSize
}

const getPetById = (petId: string): PetMessage | undefined => {
  return props.fullTeam.find(pet => pet.id === petId)
}

const getSelectionOrder = (petId: string): number => {
  return selectedPets.value.indexOf(petId) + 1
}

const togglePetSelection = (petId: string): void => {
  if (props.config.mode !== 'TEAM_SELECTION') {
    if (props.config.allowStarterSelection) {
      starterPetId.value = petId
      emitSelectionChange()
    }
    return
  }

  if (!canSelectPet(petId)) return

  if (isSelected(petId)) {
    removePetFromSelection(petId)
  } else {
    selectedPets.value.push(petId)
    if (!starterPetId.value || !selectedPets.value.includes(starterPetId.value)) {
      starterPetId.value = petId
    }
  }

  emitSelectionChange()
}

const removePetFromSelection = (petId: string): void => {
  const index = selectedPets.value.indexOf(petId)
  if (index > -1) {
    selectedPets.value.splice(index, 1)
    if (starterPetId.value === petId) {
      starterPetId.value = selectedPets.value[0] || ''
    }
  }
  emitSelectionChange()
}

const resetSelection = (): void => {
  selectedPets.value = []
  starterPetId.value = ''
  emitSelectionChange()
}

const confirmSelection = (): void => {
  const selection: BattleTeamSelection = {
    selectedPets: props.config.mode === 'TEAM_SELECTION' ? selectedPets.value : props.fullTeam.map(pet => pet.id),
    starterPetId: starterPetId.value || props.fullTeam[0]?.id || '',
  } as BattleTeamSelection

  emit('confirm', selection)
}

const emitSelectionChange = (): void => {
  const selection: BattleTeamSelection = {
    selectedPets: props.config.mode === 'TEAM_SELECTION' ? selectedPets.value : props.fullTeam.map(pet => pet.id),
    starterPetId: starterPetId.value || selectedPets.value[0] || props.fullTeam[0]?.id || '',
  } as BattleTeamSelection

  emit('selectionChange', selection)
}

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

const getVisibleOpponentPets = (): PetMessage[] => {
  if (!props.opponentTeam) return []

  switch (props.config.teamInfoVisibility) {
    case 'HIDDEN':
      return []
    case 'BASIC':
    case 'FULL':
      return props.opponentTeam
    default:
      return []
  }
}

const getOpponentStatusText = (): string => {
  switch (props.opponentProgress) {
    case 'not_started':
      return i18next.t('battle:teamSelection.opponentProgress.not_started')
    case 'in_progress':
      return i18next.t('battle:teamSelection.opponentProgress.in_progress')
    case 'completed':
      return i18next.t('battle:teamSelection.opponentProgress.completed')
    default:
      return i18next.t('battle:teamSelection.opponentProgress.unknown')
  }
}

const getOpponentStatusClass = (): string => {
  switch (props.opponentProgress) {
    case 'not_started':
      return 'text-gray-400'
    case 'in_progress':
      return 'text-yellow-400 animate-pulse'
    case 'completed':
      return 'text-green-400'
    default:
      return 'text-gray-400'
  }
}

// Timer management
const startTimer = (): void => {
  if (!props.timeLimit) return

  remainingTime.value = props.timeLimit
  timerInterval = setInterval(() => {
    remainingTime.value--
    if (remainingTime.value <= 0) {
      stopTimer()
      emit('timeout')
    }
  }, 1000)
}

const stopTimer = (): void => {
  if (timerInterval) {
    clearInterval(timerInterval)
    timerInterval = null
  }
}

// Lifecycle
onMounted(() => {
  if (props.timeLimit && props.timeLimit > 0) {
    startTimer()
  }

  // Initialize selection for full team mode
  if (props.config.mode === 'FULL_TEAM') {
    selectedPets.value = props.fullTeam.map(pet => pet.id)
    if (!starterPetId.value && props.fullTeam.length > 0) {
      starterPetId.value = props.fullTeam[0].id
    }
    emitSelectionChange()
  }
})

onUnmounted(() => {
  stopTimer()
})
</script>

<style scoped>
/* 所有样式已迁移到 TailwindCSS */
</style>
