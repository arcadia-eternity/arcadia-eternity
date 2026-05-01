<script setup lang="ts">
import { computed } from 'vue'
import type { RichFieldContext } from '../types'

const props = defineProps<{ context: RichFieldContext }>()
const emit = defineEmits<{ update: [value: unknown] }>()

const DEFAULT_KEYS = ['power', 'accuracy', 'rage', 'priority'] as const
const DEFAULT_LABELS: Record<string, string> = {
  power: '威力',
  accuracy: '命中',
  rage: '怒气',
  priority: '优先',
}

const statKeys = computed<readonly string[]>(
  () => props.context.hints.statsKeys ?? DEFAULT_KEYS,
)
const statLabels = computed<Record<string, string>>(
  () => props.context.hints.statsLabels ?? DEFAULT_LABELS,
)

const currentStats = computed(() => {
  const v = props.context.value
  if (v && typeof v === 'object') return v as Record<string, number>
  return {} as Record<string, number>
})

const cells = computed(() =>
  statKeys.value.map(k => ({
    key: k,
    label: statLabels.value[k] ?? k,
    value: currentStats.value[k] ?? 0,
  })),
)

function onInput(key: string, event: Event) {
  const raw = (event.target as HTMLInputElement).value
  const num = Number(raw)
  const safe = Number.isFinite(num) ? Math.round(num) : 0
  emit('update', { ...currentStats.value, [key]: safe })
}
</script>

<template>
  <div class="stats-grid-editor">
    <div v-for="cell in cells" :key="cell.key" class="stats-cell">
      <span class="stats-cell-label">{{ cell.label }}</span>
      <input
        type="number"
        class="stats-cell-input"
        :value="cell.value"
        step="1"
        @input="onInput(cell.key, $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.stats-grid-editor {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--ae-space-1);
}

.stats-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--ae-space-2) var(--ae-space-1);
  background-color: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-md);
  gap: 2px;
  transition: background-color 0.12s ease, border-color 0.12s ease;
}

.stats-cell:hover {
  background-color: var(--ae-bg-overlay);
  border-color: var(--ae-border-default);
}

.stats-cell-label {
  font-size: var(--ae-font-xs);
  font-weight: 500;
  color: var(--ae-text-muted);
  text-align: center;
  letter-spacing: 0.03em;
  line-height: 1;
}

.stats-cell-input {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', ui-monospace, monospace;
  font-size: var(--ae-font-md);
  font-weight: 600;
  color: var(--ae-text-primary);
  text-align: center;
  padding: 2px 0;
  font-variant-numeric: tabular-nums;
  border-radius: var(--ae-radius-sm);
  transition: background-color 0.12s ease, color 0.12s ease;
}

.stats-cell-input:hover {
  background-color: var(--ae-hover);
}

.stats-cell-input:focus {
  background-color: var(--ae-active);
  color: var(--ae-accent-primary);
}

.stats-cell-input::-webkit-inner-spin-button,
.stats-cell-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.stats-cell-input[type='number'] {
  -moz-appearance: textfield;
}
</style>
