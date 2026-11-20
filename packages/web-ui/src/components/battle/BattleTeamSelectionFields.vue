<script setup lang="ts">
import { ElInputNumber, ElCheckbox, ElSelect, ElOption } from 'element-plus'
import type { TeamSelectionConfig } from '@arcadia-eternity/const'

const selection = defineModel<Required<TeamSelectionConfig>>({ required: true })
</script>
<template>
  <div class="mb-3">
    <label class="block text-sm text-gray-600 mb-1">选择模式:</label>
    <ElSelect
      :model-value="selection.mode"
      @update:model-value="selection = { ...selection, mode: $event }"
      aria-label="选择模式"
    >
      <ElOption value="VIEW_ONLY" label="仅查看模式" />
      <ElOption value="TEAM_SELECTION" label="团队选择模式" />
      <ElOption value="FULL_TEAM" label="全队参战模式" />
    </ElSelect>
  </div>

  <div v-if="selection.mode === 'TEAM_SELECTION'" class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
    <div>
      <label class="block text-sm text-gray-600 mb-1">最多出战数量</label>
      <ElInputNumber
        aria-label="最多出战数量"
        controls-position="right"
        :precision="0"
        :model-value="selection.maxTeamSize"
        @update:model-value="selection = { ...selection, maxTeamSize: $event ?? selection.maxTeamSize }"
        :value-on-clear="'min'"
        :min="selection.minTeamSize"
        :max="6"
      />
    </div>
    <div>
      <label class="block text-sm text-gray-600 mb-1">最少出战数量</label>
      <ElInputNumber
        aria-label="最少出战数量"
        controls-position="right"
        :precision="0"
        :model-value="selection.minTeamSize"
        @update:model-value="selection = { ...selection, minTeamSize: $event ?? selection.minTeamSize }"
        :value-on-clear="'min'"
        :min="1"
        :max="selection.maxTeamSize"
      />
    </div>
  </div>

  <div class="mb-3">
    <label class="block text-sm text-gray-600 mb-1">选择时限（秒，0 为不限）</label>
    <ElInputNumber
      aria-label="选择时间限制"
      controls-position="right"
      :precision="0"
      :model-value="selection.timeLimit"
      @update:model-value="selection = { ...selection, timeLimit: $event ?? selection.timeLimit }"
      :value-on-clear="'min'"
      :min="0"
      :max="86400"
    />
  </div>

  <div class="mb-3 flex items-center">
    <ElCheckbox
      :model-value="selection.allowStarterSelection"
      @update:model-value="selection = { ...selection, allowStarterSelection: $event === true }"
      >允许选择首发精灵</ElCheckbox
    >
  </div>

  <div class="mb-3 flex items-center">
    <ElCheckbox
      :model-value="selection.showOpponentTeam"
      @update:model-value="selection = { ...selection, showOpponentTeam: $event === true }"
      >显示对手队伍</ElCheckbox
    >
  </div>

  <div class="mb-3">
    <label class="block text-sm text-gray-600 mb-1">队伍信息可见性:</label>
    <ElSelect
      :model-value="selection.teamInfoVisibility"
      @update:model-value="selection = { ...selection, teamInfoVisibility: $event }"
      aria-label="队伍信息可见性"
    >
      <ElOption value="HIDDEN" label="隐藏" />
      <ElOption value="BASIC" label="基础信息" />
      <ElOption value="FULL" label="完整信息" />
    </ElSelect>
  </div>
</template>
