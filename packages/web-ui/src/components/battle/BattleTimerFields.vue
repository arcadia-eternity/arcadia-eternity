<script setup lang="ts">
import { computed } from 'vue'
import { ElInputNumber, ElCheckbox } from 'element-plus'
import type { TimerConfig } from '@arcadia-eternity/const'

const timerConfig = defineModel<TimerConfig>({ required: true })
withDefaults(defineProps<{ maxAnimationDuration?: number }>(), { maxAnimationDuration: 60000 })
const enableTurnTimeLimit = computed({
  get: () => !!timerConfig.value.turnTimeLimit,
  set: enabled => {
    timerConfig.value = { ...timerConfig.value, turnTimeLimit: enabled ? 30 : 0 }
  },
})
const enableTotalTimeLimit = computed({
  get: () => !!timerConfig.value.totalTimeLimit,
  set: enabled => {
    timerConfig.value = { ...timerConfig.value, totalTimeLimit: enabled ? 1500 : 0 }
  },
})
</script>
<template>
  <div class="mb-3 flex items-center">
    <ElCheckbox v-model="enableTurnTimeLimit">启用每回合时间限制</ElCheckbox>
  </div>
  <div v-if="enableTurnTimeLimit" class="mb-3 flex items-center">
    <label class="flex items-center gap-2 text-sm text-gray-600">
      每回合时间限制 (秒):
      <ElInputNumber
        aria-label="每回合时间限制"
        controls-position="right"
        :precision="0"
        :model-value="timerConfig.turnTimeLimit"
        @update:model-value="timerConfig = { ...timerConfig, turnTimeLimit: $event ?? timerConfig.turnTimeLimit }"
        :value-on-clear="30"
        :min="1"
        :max="86400"
      />
    </label>
  </div>
  <div class="mb-3 flex items-center">
    <ElCheckbox v-model="enableTotalTimeLimit">启用总思考时间限制</ElCheckbox>
  </div>
  <div v-if="enableTotalTimeLimit" class="mb-3 flex items-center">
    <label class="flex items-center gap-2 text-sm text-gray-600">
      总思考时间限制 (秒):
      <ElInputNumber
        aria-label="总思考时间限制"
        controls-position="right"
        :precision="0"
        :model-value="timerConfig.totalTimeLimit"
        @update:model-value="timerConfig = { ...timerConfig, totalTimeLimit: $event ?? timerConfig.totalTimeLimit }"
        :value-on-clear="1500"
        :min="1"
        :max="86400"
      />
    </label>
  </div>
  <div class="mb-3 flex items-center">
    <ElCheckbox
      :model-value="timerConfig.animationPauseEnabled"
      @update:model-value="timerConfig = { ...timerConfig, animationPauseEnabled: $event === true }"
      >动画期间暂停计时器</ElCheckbox
    >
  </div>
  <div class="mb-3 flex items-center">
    <label class="flex items-center gap-2 text-sm text-gray-600">
      最大动画时长 (毫秒):
      <ElInputNumber
        aria-label="最大动画时长"
        controls-position="right"
        :precision="0"
        :model-value="timerConfig.maxAnimationDuration"
        @update:model-value="
          timerConfig = { ...timerConfig, maxAnimationDuration: $event ?? timerConfig.maxAnimationDuration }
        "
        :value-on-clear="'min'"
        :min="1"
        :max="maxAnimationDuration"
      />
    </label>
  </div>
</template>
