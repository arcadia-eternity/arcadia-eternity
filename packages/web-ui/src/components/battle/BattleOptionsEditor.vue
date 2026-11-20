<script setup lang="ts">
import { ElInputNumber, ElCheckbox } from 'element-plus'
import BattleTimerFields from './BattleTimerFields.vue'
import BattleTeamSelectionFields from './BattleTeamSelectionFields.vue'
import type { TimerConfig } from '@arcadia-eternity/const'
import type { BattleConfiguration } from '@/services/battleConfiguration'
const battleConfig = defineModel<BattleConfiguration>('battleConfig', { required: true })
const timerConfig = defineModel<TimerConfig>('timerConfig', { required: true })
defineProps<{ environmentTimer?: boolean; environmentSelection?: boolean }>()
</script>
<template>
  <!-- 基础配置 -->
  <div class="mb-6 p-4 bg-white rounded-md border border-gray-200">
    <h3 class="text-lg font-medium text-gray-600 mb-4 pb-2 border-b-2 border-blue-500">基础设置</h3>
    <div class="mb-3 flex items-center">
      <label class="flex items-center gap-2 text-sm text-gray-600">
        随机数种子 (可选):
        <ElInputNumber
          aria-label="随机数种子"
          controls-position="right"
          v-model="battleConfig.rngSeed"
          :value-on-clear="undefined"
          placeholder="留空使用随机种子"
        />
      </label>
    </div>
  </div>

  <!-- 计时器配置 -->
  <div v-if="!environmentTimer" class="mb-6 p-4 bg-white rounded-md border border-gray-200">
    <h3 class="text-lg font-medium text-gray-600 mb-4 pb-2 border-b-2 border-blue-500">计时器设置</h3>
    <div class="mb-3 flex items-center">
      <ElCheckbox v-model="timerConfig.enabled">启用计时器系统</ElCheckbox>
    </div>

    <BattleTimerFields v-if="timerConfig.enabled" v-model="timerConfig" />
  </div>

  <!-- 团队选择配置 -->
  <div v-if="!environmentSelection" class="bg-white p-6 rounded-lg shadow-md">
    <h3 class="text-lg font-semibold text-gray-800 mb-4">团队选择配置</h3>

    <div class="mb-3 flex items-center">
      <ElCheckbox v-model="battleConfig.teamSelection.enabled">启用团队选择</ElCheckbox>
    </div>

    <BattleTeamSelectionFields
      v-if="battleConfig.teamSelection.enabled"
      :model-value="battleConfig.teamSelection"
      @update:model-value="value => Object.assign(battleConfig.teamSelection, value)"
    />
  </div>
</template>
