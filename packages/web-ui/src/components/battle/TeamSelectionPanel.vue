<template>
  <div class="team-selection-panel" :class="{ mobile: isMobile }">
    <!-- Header -->
    <div class="selection-header">
      <h2 class="selection-title">{{ title }}</h2>
      <div class="selection-timer" v-if="timeLimit && timeLimit > 0">
        <div class="timer-bar">
          <div
            class="timer-progress"
            :style="{ width: `${timerProgress}%` }"
            :class="{ warning: timerProgress < 30, critical: timerProgress < 10 }"
          ></div>
        </div>
        <span class="timer-text">{{ formatTime(remainingTime) }}</span>
      </div>
    </div>

    <!-- Team Selection Area -->
    <div class="selection-content">
      <!-- Full Team Display -->
      <div class="team-section">
        <h3 class="section-title">{{ $t('battle.teamSelection.fullTeam') }}</h3>
        <div class="pet-grid full-team">
          <div
            v-for="pet in fullTeam"
            :key="pet.id"
            class="pet-card"
            :class="{
              selected: isSelected(pet.id),
              starter: pet.id === starterPetId,
              disabled: !canSelectPet(pet.id),
            }"
            @click="togglePetSelection(pet.id)"
            draggable="true"
            @dragstart="onDragStart($event, pet.id)"
            @dragover.prevent
            @drop="onDrop($event, pet.id)"
            @touchstart="onTouchStart($event, pet.id)"
            @touchend="onTouchEnd($event, pet.id)"
          >
            <PetIcon :id="getPetSpeciesID(pet)" :isUnknown="pet.isUnknown || false" class="pet-icon-size" />
            <div class="pet-info">
              <div class="pet-name">{{ pet.name }}</div>
              <div class="pet-level">Lv.{{ pet.level }}</div>
              <div class="pet-hp">{{ pet.currentHp }}/{{ getPetMaxHp(pet) }}</div>
            </div>
            <div class="selection-indicators">
              <div v-if="isSelected(pet.id)" class="selected-indicator">
                {{ getSelectionOrder(pet.id) }}
              </div>
              <div v-if="pet.id === starterPetId" class="starter-indicator">★</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Selected Team Display -->
      <div class="team-section" v-if="config.mode === 'TEAM_SELECTION'">
        <h3 class="section-title">
          {{ $t('battle.teamSelection.selectedTeam') }}
          ({{ selectedPets.length }}/{{ config.maxTeamSize || 6 }})
        </h3>
        <div class="pet-grid selected-team">
          <div
            v-for="(petId, index) in selectedPets"
            :key="petId"
            class="pet-slot"
            :class="{ starter: petId === starterPetId }"
            :data-drop-target="true"
            :data-slot-index="index"
            :data-pet-id="petId"
            @dragover.prevent
            @drop="onDropToSlot($event, index)"
          >
            <div v-if="petId" class="pet-card selected">
              <PetIcon
                :id="getPetById(petId) ? getPetSpeciesID(getPetById(petId)!) : 999"
                :isUnknown="getPetById(petId)?.isUnknown || false"
                class="pet-icon-size"
              />
              <div class="pet-info">
                <div class="pet-name">{{ getPetById(petId)?.name }}</div>
                <div class="slot-number">{{ index + 1 }}</div>
              </div>
              <button
                class="remove-btn"
                @click="removePetFromSelection(petId)"
                :title="$t('battle.teamSelection.removePet')"
              >
                ×
              </button>
            </div>
            <div v-else class="empty-slot">
              <div class="slot-number">{{ index + 1 }}</div>
              <div class="slot-hint">{{ $t('battle.teamSelection.dragHere') }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Opponent Team Display (if visible) -->
      <div class="team-section opponent-section" v-if="showOpponentTeam && opponentTeam">
        <h3 class="section-title">{{ $t('battle.teamSelection.opponentTeam') }}</h3>
        <div class="pet-grid opponent-team">
          <div v-for="pet in getVisibleOpponentPets()" :key="pet.id" class="pet-card opponent">
            <PetIcon :id="getPetSpeciesID(pet)" :isUnknown="pet.isUnknown || false" class="pet-icon-size" />
            <div class="pet-info" v-if="config.teamInfoVisibility !== 'HIDDEN'">
              <div class="pet-name">{{ pet.name }}</div>
              <div class="pet-level" v-if="config.teamInfoVisibility === 'FULL'">Lv.{{ pet.level }}</div>
              <div class="pet-hp" v-if="config.teamInfoVisibility === 'FULL'">
                {{ pet.currentHp }}/{{ getPetMaxHp(pet) }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="selection-actions">
      <button class="btn btn-secondary" @click="resetSelection" :disabled="!canReset">
        {{ $t('battle.teamSelection.reset') }}
      </button>

      <button class="btn btn-primary" @click="confirmSelection" :disabled="!canConfirm">
        {{ $t('battle.teamSelection.confirm') }}
      </button>
    </div>

    <!-- Selection Status -->
    <div class="selection-status" v-if="config.mode === 'TEAM_SELECTION'">
      <div class="status-item">
        <span class="status-label">{{ $t('battle.teamSelection.selected') }}:</span>
        <span class="status-value">{{ selectedPets.length }}/{{ config.maxTeamSize || 6 }}</span>
      </div>
      <div class="status-item" v-if="config.allowStarterSelection">
        <span class="status-label">{{ $t('battle.teamSelection.starter') }}:</span>
        <span class="status-value">{{
          starterPetId ? getPetById(starterPetId)?.name : $t('battle.teamSelection.notSelected')
        }}</span>
      </div>
      <div class="status-item" v-if="opponentProgress">
        <span class="status-label">{{ $t('battle.teamSelection.opponentStatus') }}:</span>
        <span class="status-value" :class="getOpponentStatusClass()">{{ getOpponentStatusText() }}</span>
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
const draggedPetId = ref<string>('')

// Touch interaction state
const touchStartTime = ref(0)
const touchStartPos = ref({ x: 0, y: 0 })
const longPressTimer = ref<NodeJS.Timeout | null>(null)

// Timer
let timerInterval: NodeJS.Timeout | null = null

// Computed properties
const title = computed(() => {
  switch (props.config.mode) {
    case 'VIEW_ONLY':
      return 'Team Preview'
    case 'TEAM_SELECTION':
      return 'Select Your Team'
    case 'FULL_TEAM':
      return props.config.allowStarterSelection ? 'Choose Your Starter' : 'Team Preview'
    default:
      return 'Team Selection'
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
      return '等待中'
    case 'in_progress':
      return '选择中...'
    case 'completed':
      return '已完成'
    default:
      return '未知'
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

// Drag and drop handlers
const onDragStart = (event: DragEvent, petId: string): void => {
  draggedPetId.value = petId
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', petId)
  }
}

const onDrop = (event: DragEvent, targetPetId: string): void => {
  event.preventDefault()
  const sourcePetId = draggedPetId.value

  if (sourcePetId && sourcePetId !== targetPetId) {
    // Swap positions in selected team
    const sourceIndex = selectedPets.value.indexOf(sourcePetId)
    const targetIndex = selectedPets.value.indexOf(targetPetId)

    if (sourceIndex > -1 && targetIndex > -1) {
      selectedPets.value[sourceIndex] = targetPetId
      selectedPets.value[targetIndex] = sourcePetId
      emitSelectionChange()
    }
  }

  draggedPetId.value = ''
}

const onDropToSlot = (event: DragEvent, slotIndex: number): void => {
  event.preventDefault()
  const petId = draggedPetId.value

  if (petId && canSelectPet(petId)) {
    // Remove from current position if already selected
    const currentIndex = selectedPets.value.indexOf(petId)
    if (currentIndex > -1) {
      selectedPets.value.splice(currentIndex, 1)
    }

    // Insert at new position
    selectedPets.value.splice(slotIndex, 0, petId)

    // Ensure we don't exceed max team size
    const maxSize = props.config.maxTeamSize || 6
    if (selectedPets.value.length > maxSize) {
      selectedPets.value = selectedPets.value.slice(0, maxSize)
    }

    emitSelectionChange()
  }

  draggedPetId.value = ''
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

// Touch event handlers for mobile devices
const onTouchStart = (event: TouchEvent, petId: string) => {
  if (!isMobile.value) return

  touchStartTime.value = Date.now()
  const touch = event.touches[0]
  touchStartPos.value = { x: touch.clientX, y: touch.clientY }

  // Set up long press detection for drag-like behavior
  longPressTimer.value = setTimeout(() => {
    draggedPetId.value = petId
    // Add visual feedback for long press
    const target = event.target as HTMLElement
    target.classList.add('long-press-active')
  }, 500) // 500ms for long press
}

const onTouchEnd = (event: TouchEvent, petId: string) => {
  if (!isMobile.value) return

  const touchEndTime = Date.now()
  const touchDuration = touchEndTime - touchStartTime.value

  // Clear long press timer
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value)
    longPressTimer.value = null
  }

  // Remove visual feedback
  const target = event.target as HTMLElement
  target.classList.remove('long-press-active')

  // Handle different touch gestures
  if (touchDuration < 500) {
    // Short tap - toggle selection
    togglePetSelection(petId)
  } else if (draggedPetId.value) {
    // Long press ended - handle drop if over valid target
    const touch = event.changedTouches[0]
    const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY)

    if (elementBelow) {
      const dropTarget = elementBelow.closest('[data-drop-target]')
      if (dropTarget) {
        const targetPetId = dropTarget.getAttribute('data-pet-id')
        const targetSlotIndex = dropTarget.getAttribute('data-slot-index')

        if (targetPetId && targetPetId !== petId) {
          // Swap with another pet
          const sourceIndex = selectedPets.value.indexOf(petId)
          const targetIndex = selectedPets.value.indexOf(targetPetId)

          if (sourceIndex > -1 && targetIndex > -1) {
            selectedPets.value[sourceIndex] = targetPetId
            selectedPets.value[targetIndex] = petId
            emitSelectionChange()
          }
        } else if (targetSlotIndex !== null) {
          // Drop to specific slot
          const slotIndex = parseInt(targetSlotIndex)
          onDropToSlot({ preventDefault: () => {} } as any, slotIndex)
        }
      }
    }

    draggedPetId.value = ''
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

  // Clean up touch timers
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value)
    longPressTimer.value = null
  }
})
</script>

<style scoped>
.team-selection-panel {
  background-color: #111827;
  color: white;
  padding: 1.5rem;
  border-radius: 0.5rem;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  max-width: 1200px;
  margin: 0 auto;
}

.team-selection-panel.mobile {
  padding: 1rem;
}

/* Header */
.selection-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.selection-title {
  font-size: 1.5rem;
  font-weight: bold;
  color: #60a5fa;
}

.selection-timer {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.timer-bar {
  width: 8rem;
  height: 0.5rem;
  background-color: #374151;
  border-radius: 9999px;
  overflow: hidden;
}

.timer-progress {
  height: 100%;
  background-color: #10b981;
  transition: all 1s;
}

.timer-progress.warning {
  background-color: #eab308;
}

.timer-progress.critical {
  background-color: #ef4444;
}

.timer-text {
  font-size: 1.125rem;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
}

/* Content */
.selection-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.team-section {
  background-color: #1f2937;
  padding: 1rem;
  border-radius: 0.5rem;
}

.section-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin-bottom: 1rem;
  color: #93c5fd;
}

.pet-grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
}

.mobile .pet-grid {
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 0.5rem;
}

/* Pet Cards */
.pet-card {
  background-color: #374151;
  padding: 0.75rem;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}

.pet-card:hover {
  background-color: #4b5563;
  transform: scale(1.05);
}

.pet-icon-size {
  width: 60px;
  height: 60px;
}

.pet-card.selected {
  background-color: #2563eb;
  box-shadow: 0 0 0 2px #60a5fa;
}

.pet-card.starter {
  box-shadow: 0 0 0 2px #fbbf24;
}

.pet-card.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pet-card.opponent {
  cursor: default;
}

.pet-info {
  margin-top: 0.5rem;
  text-align: center;
}

.pet-name {
  font-size: 0.875rem;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pet-level {
  font-size: 0.75rem;
  color: #9ca3af;
}

.pet-hp {
  font-size: 0.75rem;
  color: #34d399;
}

.selection-indicators {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
  display: flex;
  gap: 0.25rem;
}

.selected-indicator {
  background-color: #3b82f6;
  color: white;
  font-size: 0.75rem;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
}

.starter-indicator {
  background-color: #eab308;
  color: black;
  font-size: 0.75rem;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
}

/* Selected Team Slots */
.pet-slot {
  background-color: #374151;
  padding: 0.75rem;
  border-radius: 0.5rem;
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed #4b5563;
  transition: all 0.2s;
}

.pet-slot:hover {
  border-color: #60a5fa;
}

.pet-slot.starter {
  border-color: #fbbf24;
}

.empty-slot {
  text-align: center;
  color: #6b7280;
}

.slot-number {
  font-size: 1.125rem;
  font-weight: bold;
}

.slot-hint {
  font-size: 0.75rem;
  margin-top: 0.25rem;
}

.remove-btn {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
  background-color: #ef4444;
  color: white;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: bold;
  cursor: pointer;
}

.remove-btn:hover {
  background-color: #dc2626;
}

/* Actions */
.selection-actions {
  display: flex;
  justify-content: center;
  gap: 1rem;
  margin-top: 1.5rem;
}

.btn {
  padding: 0.5rem 1.5rem;
  border-radius: 0.5rem;
  font-weight: 500;
  transition: all 0.2s;
  border: none;
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background-color: #2563eb;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background-color: #1d4ed8;
}

.btn-secondary {
  background-color: #4b5563;
  color: white;
}

.btn-secondary:hover {
  background-color: #374151;
}

/* Status */
.selection-status {
  display: flex;
  justify-content: center;
  gap: 1.5rem;
  margin-top: 1rem;
  font-size: 0.875rem;
}

.status-item {
  display: flex;
  gap: 0.5rem;
}

.status-label {
  color: #9ca3af;
}

.status-value {
  color: white;
  font-weight: 500;
}

/* Opponent Section */
.opponent-section {
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.opponent-section .section-title {
  color: #fca5a5;
}

/* Mobile Responsive */
@media (max-width: 768px) {
  .selection-header {
    flex-direction: column;
    gap: 0.75rem;
  }

  .selection-actions {
    flex-direction: column;
  }

  .selection-status {
    flex-direction: column;
    gap: 0.5rem;
  }

  .timer-bar {
    width: 100%;
  }
}

/* Drag and Drop */
.pet-card[draggable='true'] {
  cursor: grab;
}

.pet-card[draggable='true']:active {
  cursor: grabbing;
}

/* Touch interactions */
.pet-card.long-press-active {
  transform: scale(1.05);
  box-shadow:
    0 0 0 4px #60a5fa,
    0 10px 15px -3px rgba(0, 0, 0, 0.1);
  animation: pulse-long-press 1s infinite;
}

@keyframes pulse-long-press {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.8;
  }
}

/* Improved touch targets for mobile */
@media (max-width: 768px) {
  .pet-card {
    min-height: 100px;
    padding: 0.5rem;
    touch-action: manipulation;
  }

  .remove-btn {
    width: 2rem;
    height: 2rem;
    font-size: 1rem;
  }

  .btn {
    min-height: 48px;
    font-size: 1.125rem;
  }
}

/* Animations */
@keyframes pulse-selection {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
}

.pet-card.selected {
  animation: pulse-selection 2s infinite;
}
</style>
