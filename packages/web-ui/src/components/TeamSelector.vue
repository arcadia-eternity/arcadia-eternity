<template>
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
        @click="selectTeam(index)"
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
            <el-icon class="text-green-500" :size="16"><Check /></el-icon>
            <el-icon v-if="selectedTeamIndex === index" class="text-blue-500 ml-1" size="20"><Select /></el-icon>
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
                  <el-icon class="text-orange-500" :size="16"><Warning /></el-icon>
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
</template>

<script setup lang="ts">
import { ref, computed, watch, defineProps, defineEmits } from 'vue'
import { usePetStorageStore } from '@/stores/petStorage'
import { useValidationStore } from '@/stores/validation'
import { User, Check, Warning, Edit, Select } from '@element-plus/icons-vue'

const props = defineProps<{
  selectedRuleSetId: string | null
  modelValue: any | null
}>()

const emit = defineEmits(['update:modelValue', 'update:isValid', 'update:validationErrors'])

const petStorageStore = usePetStorageStore()
const validationStore = useValidationStore()

const selectedTeamIndex = ref<number>(-1)

const availableTeams = computed(() => {
  if (!props.selectedRuleSetId) {
    return petStorageStore.teams
  }
  return petStorageStore.teams.filter(team => {
    const teamRuleSetId = team.ruleSetId || 'casual_standard_ruleset'
    return teamRuleSetId === props.selectedRuleSetId
  })
})

const allTeams = computed(() => petStorageStore.teams)

const incompatibleTeams = computed(() => {
  if (!props.selectedRuleSetId) {
    return []
  }
  return petStorageStore.teams.filter(team => {
    const teamRuleSetId = team.ruleSetId || 'casual_standard_ruleset'
    return teamRuleSetId !== props.selectedRuleSetId
  })
})

const selectedTeam = computed(() => {
  if (selectedTeamIndex.value >= 0 && selectedTeamIndex.value < availableTeams.value.length) {
    return availableTeams.value[selectedTeamIndex.value]
  }
  return null
})

function selectTeam(index: number) {
  selectedTeamIndex.value = index
  emit('update:modelValue', selectedTeam.value)
}

watch(() => props.modelValue, (newTeam) => {
  if (newTeam) {
    const index = availableTeams.value.findIndex(t => t.name === newTeam.name && t.ruleSetId === newTeam.ruleSetId)
    if (index !== -1) {
      selectedTeamIndex.value = index
    } else {
      selectedTeamIndex.value = -1
    }
  } else {
    selectedTeamIndex.value = -1
  }
}, { immediate: true, deep: true })
watch(() => props.selectedRuleSetId, () => {
  if (selectedTeamIndex.value !== -1) {
    selectedTeamIndex.value = -1
    emit('update:modelValue', null)
  }
})

watch(selectedTeam, () => {
  validateSelectedTeam()
})

const isSelectedTeamCompatible = computed(() => {
  if (!selectedTeam.value || !props.selectedRuleSetId) return false
  return validationStore.isTeamCompatibleWithRuleSet(selectedTeam.value, props.selectedRuleSetId)
})

const validateSelectedTeam = async () => {
  if (!selectedTeam.value || !props.selectedRuleSetId) {
    emit('update:isValid', false)
    emit('update:validationErrors', [])
    return
  }

  if (!isSelectedTeamCompatible.value) {
    emit('update:isValid', false)
    emit('update:validationErrors', ['队伍规则集不匹配'])
    return
  }

  try {
    const result = await validationStore.validateTeam(selectedTeam.value.pets, props.selectedRuleSetId)
    emit('update:isValid', result.isValid)
    emit('update:validationErrors', result.errors.map(error => error.message))
  } catch (error) {
    console.error('验证队伍时出错:', error)
    emit('update:isValid', false)
    emit('update:validationErrors', ['验证过程中发生错误'])
  }
}

const getRuleSetName = (ruleSetId: string): string => {
  return validationStore.getRuleSetName(ruleSetId)
}
</script>