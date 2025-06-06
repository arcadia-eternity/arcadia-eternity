<script setup lang="ts">
import { type BattleMessageType } from '@arcadia-eternity/const'

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
    class="flex gap-3 p-2 my-1 transition-all duration-300 text-sm text-amber-50 min-w-0"
    :class="{
      'text-red-400!': message.type === 'DAMAGE',
      'text-green-500!': message.type === 'HEAL',
      'text-yellow-400!': message.type === 'SKILL_USE',
      'text-blue-300!': message.type === 'PET_SWITCH',
      'text-purple-300!': message.type === 'STAT_CHANGE',
      'text-yellow-300! font-bold': message.type === 'BATTLE_START',
      'text-green-400!': message.type === 'PET_REVIVE',
      'text-gray-400!': message.type === 'TURN_END',
      'text-pink-300!': message.type === 'HP_CHANGE',
      'text-orange-400!': message.type === 'SKILL_USE_FAIL',
      'text-blue-400!': message.type === 'EFFECT_APPLY',
      'text-red-300!': message.type === 'MARK_DESTROY',
      'text-purple-400!': message.type === 'MARK_UPDATE',
      'text-gray-300!': message.type === 'INFO',
    }"
  >
    <div class="text-xl shrink-0">{{ message.icon }}</div>
    <div class="grow min-w-0">
      <div
        v-html="message.content"
        class="break-words [&_.pet-name]:text-blue-200 [&_.pet-name]:font-medium [&_.skill-name]:text-blue-200 [&_.skill-name]:font-medium [&_.damage-value]:font-bold [&_.crit]:text-red-400 [&_.crit]:font-bold [&_.effective]:text-green-500 [&_.effective]:font-bold [&_.not-effective]:text-gray-500 [&_.not-effective]:font-bold [&_.hp-remaining]:text-gray-400"
      ></div>
      <div class="text-sm text-gray-500 mt-1">{{ message.timestamp }}</div>
    </div>
  </div>
</template>
