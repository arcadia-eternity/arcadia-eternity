<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import BattleLogEntry from './BattleLogEntry.vue'
import type { BattleMessage, MarkMessage, PetMessage, PlayerMessage, SkillMessage } from '@test-battle/const'

const props = defineProps<{
  messages: BattleMessage[]
  petData?: Map<string, PetMessage>
  skillData?: Map<string, SkillMessage>
  playerData?: Map<string, PlayerMessage>
  markData?: Map<string, MarkMessage>
}>()

const logContainer = ref<HTMLElement | null>(null)

// 自动滚动到底部
watch(
  () => props.messages.length,
  async () => {
    await nextTick()
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  },
)
</script>

<template>
  <div class="log-panel">
    <div class="panel-header">
      <h3>战斗日志</h3>
      <div class="controls">
        <button class="clear-btn">清空</button>
      </div>
    </div>

    <div ref="logContainer" class="log-list">
      <BattleLogEntry
        v-for="(msg, index) in messages"
        :key="index"
        :message="msg"
        :skill-data="skillData"
        :mark-data="markData"
        :pet-data="petData"
        :player-data="playerData"
      />
    </div>
  </div>
</template>

<style scoped>
.log-panel {
  background: rgba(0, 0, 0, 0.8);
  border-radius: 8px;
  padding: 16px;
  height: 60vh;
  display: flex;
  flex-direction: column;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding: 0 8px;
}

.panel-header h3 {
  color: #f8f9fa;
  margin: 0;
  font-size: 1.2em;
}

.controls {
  display: flex;
  gap: 8px;
}

.clear-btn {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #f8f9fa;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.clear-btn:hover {
  background: rgba(255, 75, 75, 0.3);
}

.log-list {
  flex: 1;
  overflow-y: auto;
  padding-right: 8px;
  scroll-behavior: smooth;
}

/* 滚动条样式 */
.log-list::-webkit-scrollbar {
  width: 6px;
}

.log-list::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
}

.log-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}
</style>
