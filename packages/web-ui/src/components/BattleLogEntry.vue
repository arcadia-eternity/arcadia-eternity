<script setup lang="ts">
import { type BattleMessageType } from '@test-battle/const'

export interface FormattedBattleMessage {
  type: BattleMessageType
  icon: string
  content: string
  timestamp: string
}

const props = defineProps<{
  message: FormattedBattleMessage
}>()
</script>

<template>
  <div
    class="flex gap-3 p-2 my-1 transition-all duration-300"
    :class="{
      'text-red-400': message.type === 'DAMAGE',
      'text-green-500': message.type === 'HEAL',
      'text-yellow-400': message.type === 'SKILL_USE',
      'text-blue-300': message.type === 'PET_SWITCH',
      'text-purple-300': message.type === 'STAT_CHANGE',
      'text-yellow-300 font-bold': message.type === 'BATTLE_START',
    }"
  >
    <div class="text-xl shrink-0">{{ message.icon }}</div>
    <div class="grow">
      <div
        v-html="message.content"
        class="[&_.pet-name]:text-blue-200 [&_.pet-name]:font-medium [&_.skill-name]:text-blue-200 [&_.skill-name]:font-medium [&_.damage-value]:font-bold [&_.crit]:text-red-400 [&_.crit]:font-bold [&_.effective]:text-green-500 [&_.effective]:font-bold [&_.not-effective]:text-gray-500 [&_.not-effective]:font-bold [&_.hp-remaining]:text-gray-400"
      ></div>
      <div class="text-sm text-gray-500 mt-1">{{ message.timestamp }}</div>
    </div>
  </div>
</template>
