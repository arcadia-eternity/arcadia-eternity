<template>
  <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
    <h3 class="text-lg font-medium text-gray-800 mb-4 flex items-center gap-2">
      <el-icon><User /></el-icon>
      选择队伍
    </h3>
    <div v-if="!isInitialized" class="text-center py-8 text-gray-500" role="status">正在加载游戏和队伍数据…</div>
    <div v-else-if="teams.length" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
      <button
        v-for="(team, index) in teams"
        :key="index"
        type="button"
        :aria-pressed="selectedTeamIndex === index"
        :data-testid="`team-option-${index}`"
        class="p-3 border-2 rounded-lg text-left cursor-pointer transition-colors hover:shadow-md"
        :class="selectedTeamIndex === index ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'"
        @click="selectTeam(index)"
      >
        <div class="flex items-center justify-between">
          <span class="font-medium text-gray-800">{{ team.name }}</span>
          <span class="text-sm text-gray-600">{{ team.pets.length }}只</span>
        </div>
        <div class="text-sm text-gray-600 mt-1">{{ team.pets.map(pet => pet.name).join('、') }}</div>
      </button>
    </div>
    <div v-else class="text-center py-8 text-gray-600">
      <p>还没有队伍，请先创建一支队伍。</p>
      <router-link to="/team-builder" class="inline-block mt-3 text-blue-600">前往队伍编辑器</router-link>
    </div>
    <ul v-if="validationErrors.length" class="text-sm text-orange-600 space-y-1" role="alert">
      <li v-for="error in validationErrors" :key="error">{{ error }}</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { User } from '@element-plus/icons-vue'
import { usePetStorageStore } from '@/stores/petStorage'
import { useGameDataStore } from '@/stores/gameData'
import { validateBasicTeam } from '@/utils/basicTeamValidation'

type SelectedTeam = { name: string; pets: unknown[]; ruleSetId?: string }
const props = defineProps<{ modelValue: SelectedTeam | null }>()
const emit = defineEmits<{
  'update:modelValue': [team: SelectedTeam | null]
  'update:isValid': [isValid: boolean]
  'update:validationErrors': [errors: string[]]
}>()
const petStorageStore = usePetStorageStore()
const gameDataStore = useGameDataStore()
const teams = computed(() => petStorageStore.teams)
const isInitialized = computed(() => gameDataStore.loaded && petStorageStore.initialized)
const selectedTeamIndex = computed(() =>
  props.modelValue
    ? teams.value.findIndex(
        team =>
          team === props.modelValue || (team.name === props.modelValue?.name && team.pets === props.modelValue?.pets),
      )
    : -1,
)
const validationErrors = computed(() =>
  isInitialized.value && props.modelValue ? validateBasicTeam(props.modelValue.pets, gameDataStore) : [],
)
function selectTeam(index: number) {
  emit('update:modelValue', teams.value[index] ?? null)
}
watch(
  [isInitialized, () => props.modelValue, validationErrors],
  () => {
    emit('update:isValid', isInitialized.value && !!props.modelValue && validationErrors.value.length === 0)
    emit('update:validationErrors', validationErrors.value)
  },
  { immediate: true, deep: true },
)
</script>
