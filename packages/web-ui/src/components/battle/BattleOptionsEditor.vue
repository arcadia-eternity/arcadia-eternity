<script setup lang="ts">
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
      <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
        <input
          type="checkbox"
          v-model="battleConfig.allowFaintSwitch"
          class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
        />
        允许击破奖励切换
      </label>
    </div>
    <!-- 暂时隐藏显示隐藏信息选项 -->
    <!-- <div class="mb-3 flex items-center">
          <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              v-model="battleConfig.showHidden"
              class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
            />
            显示隐藏信息
          </label>
        </div> -->
    <div class="mb-3 flex items-center">
      <label class="flex items-center gap-2 text-sm text-gray-600">
        随机数种子 (可选):
        <input
          type="number"
          v-model.number="battleConfig.rngSeed"
          placeholder="留空使用随机种子"
          class="ml-2 px-3 py-1.5 border border-gray-300 rounded-md text-sm w-32 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </label>
    </div>
  </div>

  <!-- 计时器配置 -->
  <div class="mb-6 p-4 bg-white rounded-md border border-gray-200">
    <h3 class="text-lg font-medium text-gray-600 mb-4 pb-2 border-b-2 border-blue-500">计时器设置</h3>
    <div class="mb-3 flex items-center">
      <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
        <input
          type="checkbox"
          v-model="timerConfig.enabled"
          class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
        />
        启用计时器系统
      </label>
    </div>

    <template v-if="timerConfig.enabled">
      <div class="mb-3 flex items-center">
        <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            v-model="enableTurnTimeLimit"
            class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
          />
          启用每回合时间限制
        </label>
      </div>
      <div v-if="enableTurnTimeLimit" class="mb-3 flex items-center">
        <label class="flex items-center gap-2 text-sm text-gray-600">
          每回合时间限制 (秒):
          <input
            type="number"
            v-model.number="timerConfig.turnTimeLimit"
            min="5"
            max="300"
            class="ml-2 px-3 py-1.5 border border-gray-300 rounded-md text-sm w-32 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </label>
      </div>
      <div class="mb-3 flex items-center">
        <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            v-model="enableTotalTimeLimit"
            class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
          />
          启用总思考时间限制
        </label>
      </div>
      <div v-if="enableTotalTimeLimit" class="mb-3 flex items-center">
        <label class="flex items-center gap-2 text-sm text-gray-600">
          总思考时间限制 (秒):
          <input
            type="number"
            v-model.number="timerConfig.totalTimeLimit"
            min="60"
            max="3600"
            class="ml-2 px-3 py-1.5 border border-gray-300 rounded-md text-sm w-32 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </label>
      </div>
      <div class="mb-3 flex items-center">
        <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            v-model="timerConfig.animationPauseEnabled"
            class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
          />
          动画期间暂停计时器
        </label>
      </div>
      <div class="mb-3 flex items-center">
        <label class="flex items-center gap-2 text-sm text-gray-600">
          最大动画时长 (毫秒):
          <input
            type="number"
            v-model.number="timerConfig.maxAnimationDuration"
            min="1000"
            max="60000"
            class="ml-2 px-3 py-1.5 border border-gray-300 rounded-md text-sm w-32 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </label>
      </div>
    </template>
  </div>

  <!-- 团队选择配置 -->
  <div class="bg-white p-6 rounded-lg shadow-md">
    <h3 class="text-lg font-semibold text-gray-800 mb-4">团队选择配置</h3>

    <div class="mb-3 flex items-center">
      <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
        <input
          type="checkbox"
          v-model="battleConfig.teamSelection.enabled"
          class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
        />
        启用团队选择
      </label>
    </div>

    <template v-if="battleConfig.teamSelection.enabled">
      <div class="mb-3">
        <label class="block text-sm text-gray-600 mb-1">选择模式:</label>
        <select
          v-model="battleConfig.teamSelection.mode"
          class="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="VIEW_ONLY">仅查看模式</option>
          <option value="TEAM_SELECTION">团队选择模式</option>
          <option value="FULL_TEAM">全队参战模式</option>
        </select>
      </div>

      <div class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="block text-sm text-gray-600 mb-1">最大队伍大小:</label>
          <input
            type="number"
            v-model.number="battleConfig.teamSelection.maxTeamSize"
            min="1"
            max="12"
            class="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div>
          <label class="block text-sm text-gray-600 mb-1">最小队伍大小:</label>
          <input
            type="number"
            v-model.number="battleConfig.teamSelection.minTeamSize"
            min="1"
            :max="battleConfig.teamSelection.maxTeamSize"
            class="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      <div class="mb-3">
        <label class="block text-sm text-gray-600 mb-1">选择时间限制 (秒):</label>
        <input
          type="number"
          v-model.number="battleConfig.teamSelection.timeLimit"
          min="10"
          max="300"
          class="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      <div class="mb-3 flex items-center">
        <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            v-model="battleConfig.teamSelection.allowStarterSelection"
            class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
          />
          允许选择首发精灵
        </label>
      </div>

      <div class="mb-3 flex items-center">
        <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            v-model="battleConfig.teamSelection.showOpponentTeam"
            class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
          />
          显示对手队伍
        </label>
      </div>

      <div class="mb-3">
        <label class="block text-sm text-gray-600 mb-1">队伍信息可见性:</label>
        <select
          v-model="battleConfig.teamSelection.teamInfoVisibility"
          class="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="HIDDEN">隐藏</option>
          <option value="BASIC">基础信息</option>
          <option value="FULL">完整信息</option>
        </select>
      </div>
    </template>
  </div>
</template>
