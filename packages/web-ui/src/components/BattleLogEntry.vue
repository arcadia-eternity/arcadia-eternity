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
  <div class="log-entry" :class="[message.type.toLowerCase()]">
    <div class="log-icon">{{ message.icon }}</div>
    <div class="log-content">
      <div v-html="message.content"></div>
      <div class="timestamp">{{ message.timestamp }}</div>
    </div>
  </div>
</template>

<style scoped>
.log-entry {
  display: flex;
  gap: 12px;
  padding: 8px 12px;
  margin: 4px 0;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  transition: all 0.3s ease;
}

.log-icon {
  font-size: 1.2em;
  flex-shrink: 0;
}

.log-content {
  flex-grow: 1;
}

/* 不同类型消息的样式 */
.damage {
  color: #ff6b6b;
}

.heal {
  color: #51cf66;
}

.skill-use {
  color: #fcc419;
}

.pet-switch {
  color: #74c0fc;
}

.stat-change {
  color: #b197fc;
}

.battle-start {
  color: #ffd43b;
  font-weight: bold;
}

.timestamp {
  font-size: 0.8em;
  color: #868e96;
  margin-top: 4px;
}

.pet-name,
.skill-name {
  font-weight: 500;
  color: #a5d8ff;
}

.damage-value {
  font-weight: bold;
}

.crit {
  color: #ff6b6b;
  font-weight: bold;
}

.effective {
  color: #51cf66;
  font-weight: bold;
}

.not-effective {
  color: #868e96;
  font-weight: bold;
}

.hp-remaining {
  color: #adb5bd;
}
</style>
