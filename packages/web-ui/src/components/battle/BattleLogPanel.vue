<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import BattleLogEntry from './BattleLogEntry.vue'
import BattleFrame from './BattleFrame.vue'
import BattleGlyph from './BattleGlyph.vue'
import { type TimestampedBattleMessage } from '@/symbol/battlelog'
import { useBattleLogFormatter } from '@/composition/useBattleLogFormatter'
import { useGameSettingStore } from '@/stores/gameSetting'
import { useBattleViewStore } from '@/stores/battleView'
import { useBattleStore } from '@/stores/battle'

const gameSettingStore = useGameSettingStore()
const battleViewStore = useBattleViewStore()
const battleStore = useBattleStore()
const { format } = useBattleLogFormatter()

const formattedMessages = computed(() =>
  battleStore.log.filter((msg: TimestampedBattleMessage) => gameSettingStore.visibleLogTypes.has(msg.type)).map(format),
)

const logContainerRef = ref<HTMLElement | null>(null)
watch(
  () => formattedMessages.value.length,
  async () => {
    await nextTick()
    if (logContainerRef.value) {
      logContainerRef.value.scrollTop = logContainerRef.value.scrollHeight
    }
  },
)
</script>

<template>
  <section data-testid="battle-log-panel" class="battle-log">
    <BattleFrame />
    <header class="battle-log__header">
      <span><BattleGlyph name="log" />战斗记录</span>
      <span class="battle-log__count">{{ formattedMessages.length }} 条</span>
      <button
        class="battle-log__expand"
        title="日志详情"
        aria-label="日志详情"
        aria-haspopup="dialog"
        @click="battleViewStore.openLogDetail()"
      >
        <BattleGlyph name="expand" />
      </button>
    </header>
    <div data-testid="battle-log-list" ref="logContainerRef" class="battle-log__list" role="log" aria-label="战斗记录">
      <p v-if="!formattedMessages.length" class="battle-log__empty">等待战斗开始</p>
      <BattleLogEntry v-for="(msg, index) in formattedMessages" :key="msg.receivedAt + index" :message="msg" />
    </div>
  </section>
</template>
<style scoped>
.battle-log {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}
.battle-log__header {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--battle-line);
  flex: none;
}
.battle-log__header > span:first-child {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--battle-cyan);
}
.battle-log__count {
  margin-left: auto;
  font-size: 10px;
  color: var(--battle-muted);
}
.battle-log__expand {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  color: var(--battle-muted);
  cursor: pointer;
}
.battle-log__expand:hover,
.battle-log__expand:focus-visible {
  color: var(--battle-cyan);
  outline: 1px solid currentColor;
}
.battle-log__list {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--battle-line) transparent;
}
.battle-log__empty {
  color: var(--battle-muted);
  font-size: 12px;
  padding: 12px 0;
}
</style>
