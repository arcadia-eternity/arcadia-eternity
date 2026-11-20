<script setup lang="ts">
import { computed } from 'vue'
import { ElCard } from 'element-plus'
import {
  DEFAULT_TIMER_CONFIG,
  resolveTeamSelectionConfig,
  type IndependentEnvironmentRules,
  type EnvironmentRules,
} from '@arcadia-eternity/const'
import BattleTimerFields from '@/components/battle/BattleTimerFields.vue'
import BattleTeamSelectionFields from '@/components/battle/BattleTeamSelectionFields.vue'
import EnvironmentBooleanField from './EnvironmentBooleanField.vue'

const rules = defineModel<IndependentEnvironmentRules>({ required: true })
const timer = computed(() => ({
  ...DEFAULT_TIMER_CONFIG,
  ...rules.value.mechanics?.timer,
}))
const selection = computed(() => resolveTeamSelectionConfig(rules.value.mechanics?.teamSelection))

type Mechanics = NonNullable<EnvironmentRules['mechanics']>
function setRule<K extends 'timer' | 'teamSelection'>(key: K, value: NonNullable<Mechanics[K]>) {
  rules.value = { ...rules.value, schemaVersion: 2, mechanics: { ...rules.value.mechanics, [key]: value } }
}
</script>

<template>
  <ElCard shadow="never">
    <EnvironmentBooleanField
      label="对战计时器"
      :model-value="rules.mechanics?.timer?.enabled"
      @update:model-value="enabled => setRule('timer', { ...timer, enabled })"
    />
    <BattleTimerFields
      v-if="rules.mechanics?.timer?.enabled"
      :model-value="timer"
      :max-animation-duration="20000"
      @update:model-value="setRule('timer', $event)"
    />
  </ElCard>
  <ElCard shadow="never">
    <EnvironmentBooleanField
      label="团队选择"
      :model-value="rules.mechanics?.teamSelection?.enabled"
      @update:model-value="enabled => setRule('teamSelection', { ...selection, enabled })"
    />
    <BattleTeamSelectionFields
      v-if="rules.mechanics?.teamSelection?.enabled"
      :model-value="selection"
      @update:model-value="value => setRule('teamSelection', { ...value, enabled: true })"
    />
  </ElCard>
</template>
