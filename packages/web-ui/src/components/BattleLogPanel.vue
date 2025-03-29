<script setup lang="ts">
import { ref } from 'vue'
import BattleLogEntry from './BattleLogEntry.vue'
import type { FormattedBattleMessage } from './BattleLogEntry.vue'

const props = defineProps<{
  formattedMessages: FormattedBattleMessage[]
  clearMessages: () => void
}>()

const logContainerRef = ref<HTMLDivElement>()
</script>

<template>
  <div class="bg-black/80 rounded-lg p-4 flex flex-col">
    <div class="flex justify-between items-center mb-3 px-2">
      <h3 class="text-gray-50 m-0 text-xl">战斗日志</h3>
      <div class="flex gap-2">
        <button
          class="bg-white/10 border border-white/20 text-gray-50 px-3 py-1 rounded transition-all duration-200 hover:bg-red-500/30"
          @click="clearMessages"
        >
          清空
        </button>
      </div>
    </div>

    <div
      ref="logContainerRef"
      class="flex-1 overflow-y-auto pr-2 scroll-smooth scrollbar-thin scrollbar-track-white/5 scrollbar-thumb-white/20 scrollbar-thumb-rounded"
    >
      <BattleLogEntry v-for="(msg, index) in formattedMessages" :key="index" :message="msg" />
    </div>
  </div>
</template>
