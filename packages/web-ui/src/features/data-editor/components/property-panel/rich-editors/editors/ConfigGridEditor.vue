<script setup lang="ts">
import { computed } from 'vue'
import type { RichFieldContext } from '../types'

const props = defineProps<{ context: RichFieldContext }>()
const emit = defineEmits<{ update: [value: unknown] }>()

const STACK_STRATEGY_OPTIONS = [
  { value: 'stack', label: '叠加 (stack)' },
  { value: 'refresh', label: '刷新 (refresh)' },
  { value: 'extend', label: '延长 (extend)' },
  { value: 'max', label: '取大 (max)' },
  { value: 'replace', label: '替换 (replace)' },
  { value: 'none', label: '无 (none)' },
  { value: 'remove', label: '移除 (remove)' },
]

const EXTRA_LABELS: Record<string, string> = {
  stackStrategy: '叠加策略',
  mutexGroup: '互斥组',
}

const allKeys = computed(() => {
  const hintKeys = props.context.hints.configKeys
  if (hintKeys && hintKeys.length > 0) return [...hintKeys]
  return [...Object.keys(currentConfig.value), 'stackStrategy', 'mutexGroup']
})

const currentConfig = computed(() => {
  const v = props.context.value
  if (v && typeof v === 'object') return v as Record<string, unknown>
  return {} as Record<string, unknown>
})

const labelMap = computed(() => {
  const labels = props.context.hints.configLabels ?? {}
  return {
    ...EXTRA_LABELS,
    ...labels,
  }
})

function getLabel(key: string): string {
  return labelMap.value[key] ?? key
}

function isBooleanField(key: string): boolean {
  return typeof currentConfig.value[key] === 'boolean'
}

function isNumberField(key: string): boolean {
  return typeof currentConfig.value[key] === 'number'
}

function onBooleanToggle(key: string) {
  const current = !!currentConfig.value[key]
  emit('update', { ...currentConfig.value, [key]: !current })
}

function onNumberInput(key: string, event: Event) {
  const raw = (event.target as HTMLInputElement).value
  const num = Number(raw)
  const safe = Number.isFinite(num) ? Math.round(num) : 0
  emit('update', { ...currentConfig.value, [key]: safe })
}

function onSelectInput(key: string, event: Event) {
  const val = (event.target as HTMLSelectElement).value
  emit('update', { ...currentConfig.value, [key]: val })
}

function onTextInput(key: string, event: Event) {
  const val = (event.target as HTMLInputElement).value
  emit('update', { ...currentConfig.value, [key]: val || undefined })
}
</script>

<template>
  <div class="config-grid-editor">
    <div v-for="key in allKeys" :key="key" class="config-row">
      <span class="config-label">{{ getLabel(key) }}</span>

      <label v-if="isBooleanField(key)" class="config-toggle" :class="{ 'config-toggle--on': !!currentConfig[key] }">
        <input
          type="checkbox"
          class="config-toggle-input"
          :checked="!!currentConfig[key]"
          @change="onBooleanToggle(key)"
        />
        <span class="config-toggle-track">
          <span class="config-toggle-thumb" />
        </span>
      </label>

      <input
        v-else-if="isNumberField(key)"
        type="number"
        class="config-number-input"
        :value="currentConfig[key] ?? 0"
        step="1"
        @input="onNumberInput(key, $event)"
      />

      <select
        v-else-if="key === 'stackStrategy'"
        class="config-select"
        :value="currentConfig[key] ?? 'extend'"
        @change="onSelectInput(key, $event)"
      >
        <option v-for="opt in STACK_STRATEGY_OPTIONS" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>

      <input
        v-else
        type="text"
        class="config-text-input"
        :value="currentConfig[key] ?? ''"
        placeholder="—"
        @input="onTextInput(key, $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.config-grid-editor {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background-color: var(--ae-border-subtle);
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-md);
  overflow: hidden;
}

.config-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: var(--ae-space-2);
  padding: var(--ae-space-1) var(--ae-space-2);
  background-color: var(--ae-bg-surface);
  min-height: 28px;
  transition: background-color 0.12s ease;
}

.config-row:hover {
  background-color: var(--ae-bg-elevated);
}

.config-label {
  font-size: var(--ae-font-xs);
  font-weight: 500;
  color: var(--ae-text-secondary);
  user-select: none;
  letter-spacing: 0.01em;
}

/* ── Toggle switch ── */
.config-toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.config-toggle-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.config-toggle-track {
  width: 28px;
  height: 16px;
  border-radius: 8px;
  background-color: var(--ae-border-strong);
  position: relative;
  transition: background-color 0.2s ease;
  flex-shrink: 0;
}

.config-toggle--on .config-toggle-track {
  background-color: var(--ae-accent-primary);
}

.config-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background-color: var(--ae-text-muted);
  transition:
    transform 0.2s ease,
    background-color 0.2s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}

.config-toggle--on .config-toggle-thumb {
  transform: translateX(12px);
  background-color: #fff;
}

.config-toggle:hover .config-toggle-thumb {
  background-color: var(--ae-text-secondary);
}

.config-toggle--on:hover .config-toggle-thumb {
  background-color: #fff;
}

/* ── Number input ── */
.config-number-input {
  width: 60px;
  background-color: var(--ae-bg-overlay);
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-sm);
  padding: 2px 6px;
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', ui-monospace, monospace;
  font-size: var(--ae-font-xs);
  font-weight: 500;
  color: var(--ae-text-primary);
  text-align: right;
  outline: none;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;
  font-variant-numeric: tabular-nums;
}

.config-number-input:hover {
  border-color: var(--ae-border-default);
  background-color: var(--ae-bg-elevated);
}

.config-number-input:focus {
  border-color: var(--ae-accent-primary);
  background-color: var(--ae-bg-elevated);
}

.config-number-input::-webkit-inner-spin-button,
.config-number-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.config-number-input[type='number'] {
  -moz-appearance: textfield;
}

/* ── Select ── */
.config-select {
  background-color: var(--ae-bg-overlay);
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-sm);
  padding: 2px 6px;
  font-size: var(--ae-font-xs);
  font-weight: 500;
  color: var(--ae-text-primary);
  outline: none;
  cursor: pointer;
  min-width: 110px;
  appearance: auto;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;
}

.config-select:hover {
  border-color: var(--ae-border-default);
  background-color: var(--ae-bg-elevated);
}

.config-select:focus {
  border-color: var(--ae-accent-primary);
  background-color: var(--ae-bg-elevated);
}

.config-select option {
  background-color: var(--ae-bg-elevated);
  color: var(--ae-text-primary);
}

/* ── Text input ── */
.config-text-input {
  width: 100%;
  max-width: 140px;
  background-color: var(--ae-bg-overlay);
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-sm);
  padding: 2px 6px;
  font-size: var(--ae-font-xs);
  font-weight: 400;
  color: var(--ae-text-primary);
  outline: none;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;
}

.config-text-input::placeholder {
  color: var(--ae-text-disabled);
}

.config-text-input:hover {
  border-color: var(--ae-border-default);
  background-color: var(--ae-bg-elevated);
}

.config-text-input:focus {
  border-color: var(--ae-accent-primary);
  background-color: var(--ae-bg-elevated);
}
</style>
