<script setup lang="ts">
import { type BattleMessageType } from '@arcadia-eternity/const'

export interface FormattedBattleMessage {
  type: BattleMessageType
  icon: string
  content: string
  timestamp: string
}

defineProps<{
  message: FormattedBattleMessage
}>()
</script>

<template>
  <article data-testid="battle-log-entry" :data-log-type="message.type" class="battle-log-entry">
    <span class="battle-log-entry__dot" aria-hidden="true"></span>
    <p>{{ message.content }}</p>
    <time>{{ message.timestamp }}</time>
  </article>
</template>
<style scoped>
.battle-log-entry {
  --entry-accent: var(--battle-cyan);
  display: grid;
  grid-template-columns: 5px minmax(0, 1fr);
  column-gap: 8px;
  row-gap: 3px;
  padding: 9px 0;
  border-bottom: 1px solid #36536855;
  color: var(--battle-text);
  font-size: 12px;
  line-height: 1.45;
}
.battle-log-entry__dot {
  width: 4px;
  height: 4px;
  margin-top: 6px;
  background: var(--entry-accent);
}
.battle-log-entry p {
  margin: 0;
  overflow-wrap: anywhere;
}
.battle-log-entry time {
  grid-column: 2;
  color: var(--battle-muted);
  font-size: 10px;
  letter-spacing: 0.04em;
}
.battle-log-entry[data-log-type='DAMAGE'],
.battle-log-entry[data-log-type='PET_DEFEATED'] {
  --entry-accent: var(--battle-danger);
}
.battle-log-entry[data-log-type='HEAL'],
.battle-log-entry[data-log-type='PET_REVIVE'] {
  --entry-accent: var(--battle-hp);
}
.battle-log-entry[data-log-type='SKILL_USE'],
.battle-log-entry[data-log-type='BATTLE_END'] {
  --entry-accent: var(--battle-gold);
}
</style>
