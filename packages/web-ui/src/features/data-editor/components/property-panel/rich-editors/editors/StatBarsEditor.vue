<script setup lang="ts">
import { computed } from 'vue'
import type { RichFieldContext } from '../types'

const props = defineProps<{ context: RichFieldContext }>()

const statKeys = computed<readonly string[]>(
  () => props.context.hints.statKeys ?? [],
)
const statLabels = computed<Record<string, string>>(
  () => props.context.hints.statLabels ?? {},
)

const currentStats = computed(() => {
  const v = props.context.value
  if (v && typeof v === 'object') return v as Record<string, number>
  return {} as Record<string, number>
})

const maxStatValue = computed(() => {
  const vals = statKeys.value.map(k => currentStats.value[k] ?? 0)
  return Math.max(...vals, 1)
})

const statTotal = computed(() =>
  statKeys.value.reduce((sum, k) => sum + (currentStats.value[k] ?? 0), 0),
)

const bars = computed(() =>
  statKeys.value.map(k => {
    const value = currentStats.value[k] ?? 0
    const percent = (value / maxStatValue.value) * 100
    return { key: k, label: statLabels.value[k] ?? k.toUpperCase(), value, percent }
  }),
)

function statBarColor(percent: number): string {
  if (percent <= 33) {
    const t = percent / 33
    const r = Math.round(74 + t * (251 - 74))
    const g = Math.round(222 + t * (191 - 222))
    const b = Math.round(128 + t * (36 - 128))
    return `rgb(${r}, ${g}, ${b})`
  }
  if (percent <= 66) {
    const t = (percent - 33) / 33
    const r = Math.round(251 + t * (248 - 251))
    const g = Math.round(191 + t * (113 - 191))
    const b = Math.round(36 + t * (113 - 36))
    return `rgb(${r}, ${g}, ${b})`
  }
  const t = (percent - 66) / 34
  const r = Math.round(248 + t * (220 - 248))
  const g = Math.round(113 + t * (38 - 113))
  const b = Math.round(113 + t * (38 - 113))
  return `rgb(${r}, ${g}, ${b})`
}

function onStatInput(key: string, event: Event) {
  const raw = (event.target as HTMLInputElement).value
  const num = Number(raw)
  const safe = Number.isFinite(num) ? Math.max(0, Math.round(num)) : 0
  props.context.onUpdate({ ...currentStats.value, [key]: safe })
}
</script>

<template>
  <div class="stat-bars-editor">
    <div v-for="bar in bars" :key="bar.key" class="stat-row">
      <span class="stat-label">{{ bar.label }}</span>
      <input
        type="number"
        class="stat-input"
        :value="bar.value"
        min="0"
        step="1"
        @input="onStatInput(bar.key, $event)"
      />
      <div class="stat-bar-track">
        <div
          class="stat-bar-fill"
          :style="{
            width: bar.percent + '%',
            background: statBarColor(bar.percent),
          }"
        />
      </div>
    </div>

    <div class="stat-total">
      <span class="stat-total-label">Total</span>
      <span class="stat-total-value">{{ statTotal }}</span>
    </div>
  </div>
</template>

<style scoped>
.stat-bars-editor {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.stat-row {
  display: grid;
  grid-template-columns: 32px 38px 1fr;
  align-items: center;
  gap: var(--ae-space-2);
}

.stat-label {
  font-size: var(--ae-font-xs);
  font-weight: 600;
  color: var(--ae-text-secondary);
  text-align: right;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

.stat-input {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', ui-monospace, monospace;
  font-size: var(--ae-font-xs);
  font-weight: 500;
  color: var(--ae-text-primary);
  text-align: right;
  padding: 2px 0;
  font-variant-numeric: tabular-nums;
  border-radius: var(--ae-radius-sm);
  transition: background-color 0.15s ease;
}

.stat-input:hover {
  background-color: var(--ae-hover);
}

.stat-input:focus {
  background-color: var(--ae-active);
}

.stat-input::-webkit-inner-spin-button,
.stat-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.stat-input[type='number'] {
  -moz-appearance: textfield;
}

.stat-bar-track {
  height: 12px;
  background-color: var(--ae-bg-overlay);
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--ae-border-subtle);
}

.stat-bar-fill {
  height: 100%;
  border-radius: 5px;
  transition: width 0.15s ease;
  min-width: 2px;
}

.stat-total {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--ae-space-2);
  margin-top: var(--ae-space-1);
  padding-top: var(--ae-space-1);
  border-top: 1px solid var(--ae-border-subtle);
}

.stat-total-label {
  font-size: var(--ae-font-xs);
  font-weight: 600;
  color: var(--ae-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stat-total-value {
  font-size: var(--ae-font-sm);
  font-weight: 700;
  color: var(--ae-accent-primary);
  font-variant-numeric: tabular-nums;
}
</style>
