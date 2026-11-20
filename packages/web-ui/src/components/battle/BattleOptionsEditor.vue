<script setup lang="ts">
import { ElInputNumber, ElCheckbox, ElSelect, ElOption } from 'element-plus'
import { computed } from 'vue'
import type { TimerConfig } from '@arcadia-eternity/const'
import type { BattleConfiguration } from '@/services/battleConfiguration'
const battleConfig = defineModel<BattleConfiguration>('battleConfig', { required: true })
const timerConfig = defineModel<TimerConfig>('timerConfig', { required: true })
const enableTurnTimeLimit = computed({
  get: () => typeof timerConfig.value.turnTimeLimit === 'number',
  set: enabled => {
    timerConfig.value.turnTimeLimit = enabled ? 30 : undefined
  },
})
const enableTotalTimeLimit = computed({
  get: () => typeof timerConfig.value.totalTimeLimit === 'number',
  set: enabled => {
    timerConfig.value.totalTimeLimit = enabled ? 1500 : undefined
  },
})
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
  <div class="mb-6 p-4 bg-white rounded-md border border-gray-200">
    <h3 class="text-lg font-medium text-gray-600 mb-4 pb-2 border-b-2 border-blue-500">计时器设置</h3>
    <div class="mb-3 flex items-center">
      <ElCheckbox v-model="timerConfig.enabled">启用计时器系统</ElCheckbox>
    </div>

    <template v-if="timerConfig.enabled">
      <div class="mb-3 flex items-center">
        <ElCheckbox v-model="enableTurnTimeLimit">启用每回合时间限制</ElCheckbox>
      </div>
      <div v-if="enableTurnTimeLimit" class="mb-3 flex items-center">
        <label class="flex items-center gap-2 text-sm text-gray-600">
          每回合时间限制 (秒):
          <ElInputNumber
            aria-label="每回合时间限制"
            controls-position="right"
            v-model="timerConfig.turnTimeLimit"
            :value-on-clear="30"
            :min="5"
            :max="300"
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
            v-model="timerConfig.totalTimeLimit"
            :value-on-clear="1500"
            :min="60"
            :max="3600"
          />
        </label>
      </div>
      <div class="mb-3 flex items-center">
        <ElCheckbox v-model="timerConfig.animationPauseEnabled">动画期间暂停计时器</ElCheckbox>
      </div>
      <div class="mb-3 flex items-center">
        <label class="flex items-center gap-2 text-sm text-gray-600">
          最大动画时长 (毫秒):
          <ElInputNumber
            aria-label="最大动画时长"
            controls-position="right"
            v-model="timerConfig.maxAnimationDuration"
            :value-on-clear="'min'"
            :min="1000"
            :max="60000"
          />
        </label>
      </div>
    </template>
  </div>

  <!-- 团队选择配置 -->
  <div class="bg-white p-6 rounded-lg shadow-md">
    <h3 class="text-lg font-semibold text-gray-800 mb-4">团队选择配置</h3>

    <div class="mb-3 flex items-center">
      <ElCheckbox v-model="battleConfig.teamSelection.enabled">启用团队选择</ElCheckbox>
    </div>

    <template v-if="battleConfig.teamSelection.enabled">
      <div class="mb-3">
        <label class="block text-sm text-gray-600 mb-1">选择模式:</label>
        <ElSelect v-model="battleConfig.teamSelection.mode" aria-label="选择模式">
          <ElOption value="VIEW_ONLY" label="仅查看模式" />
          <ElOption value="TEAM_SELECTION" label="团队选择模式" />
          <ElOption value="FULL_TEAM" label="全队参战模式" />
        </ElSelect>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label class="block text-sm text-gray-600 mb-1">最大队伍大小:</label>
          <ElInputNumber
            aria-label="最大队伍大小"
            controls-position="right"
            v-model="battleConfig.teamSelection.maxTeamSize"
            :value-on-clear="'min'"
            :min="battleConfig.teamSelection.minTeamSize"
            :max="12"
          />
        </div>
        <div>
          <label class="block text-sm text-gray-600 mb-1">最小队伍大小:</label>
          <ElInputNumber
            aria-label="最小队伍大小"
            controls-position="right"
            v-model="battleConfig.teamSelection.minTeamSize"
            :value-on-clear="'min'"
            :min="1"
            :max="battleConfig.teamSelection.maxTeamSize"
          />
        </div>
      </div>

      <div class="mb-3">
        <label class="block text-sm text-gray-600 mb-1">选择时间限制 (秒):</label>
        <ElInputNumber
          aria-label="选择时间限制"
          controls-position="right"
          v-model="battleConfig.teamSelection.timeLimit"
          :value-on-clear="'min'"
          :min="10"
          :max="300"
        />
      </div>

      <div class="mb-3 flex items-center">
        <ElCheckbox v-model="battleConfig.teamSelection.allowStarterSelection">允许选择首发精灵</ElCheckbox>
      </div>

      <div class="mb-3 flex items-center">
        <ElCheckbox v-model="battleConfig.teamSelection.showOpponentTeam">显示对手队伍</ElCheckbox>
      </div>

      <div class="mb-3">
        <label class="block text-sm text-gray-600 mb-1">队伍信息可见性:</label>
        <ElSelect v-model="battleConfig.teamSelection.teamInfoVisibility" aria-label="队伍信息可见性">
          <ElOption value="HIDDEN" label="隐藏" />
          <ElOption value="BASIC" label="基础信息" />
          <ElOption value="FULL" label="完整信息" />
        </ElSelect>
      </div>
    </template>
  </div>
</template>
