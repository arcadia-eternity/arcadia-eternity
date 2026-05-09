<script setup lang="ts">
import { computed } from 'vue'
import type { OperatorDSL } from '@arcadia-eternity/schema'
import { OPERATOR_TYPE_LABELS } from './constants'

const props = defineProps<{
  modelValue: OperatorDSL | OperatorDSL[]
}>()

const emit = defineEmits<{ 'update:modelValue': [value: OperatorDSL | OperatorDSL[]] }>()

const isArray = computed(() => Array.isArray(props.modelValue))

const items = computed(() => {
  if (Array.isArray(props.modelValue)) return props.modelValue as OperatorDSL[]
  return []
})

const singleItem = computed(() => {
  if (!Array.isArray(props.modelValue)) return props.modelValue as OperatorDSL
  return null
})

function updateSingle(value: OperatorDSL) {
  emit('update:modelValue', value)
}

function updateItem(index: number, value: OperatorDSL) {
  const next = [...(props.modelValue as OperatorDSL[])]
  next[index] = value
  emit('update:modelValue', next)
}

function moveUp(index: number) {
  if (index === 0) return
  const arr = [...(props.modelValue as OperatorDSL[])]
  ;[arr[index - 1], arr[index]] = [arr[index], arr[index - 1]]
  emit('update:modelValue', arr)
}

function moveDown(index: number) {
  const arr = props.modelValue as OperatorDSL[]
  if (index >= arr.length - 1) return
  const next = [...arr]
  ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
  emit('update:modelValue', next)
}

function removeItem(index: number) {
  const next = (props.modelValue as OperatorDSL[]).filter((_, i) => i !== index)
  emit('update:modelValue', next)
}

function addItem() {
  const arr = [...(props.modelValue as OperatorDSL[]), {} as OperatorDSL]
  emit('update:modelValue', arr)
}

function getItemLabel(op: OperatorDSL, index: number): string {
  const t = (op as Record<string, unknown>)?.type
  if (typeof t === 'string' && t.length > 0) {
    return OPERATOR_TYPE_LABELS[t] ?? t
  }
  return `操作符 #${index + 1}`
}
</script>

<template>
  <div class="op-list-editor">
    <template v-if="isArray">
      <div class="op-list">
        <div v-for="(item, index) in items" :key="index" class="op-list-item">
          <div class="op-list-item-header">
            <span class="op-list-item-title">{{ getItemLabel(item, index) }}</span>
            <div class="op-list-item-actions">
              <button class="op-list-action-btn" :disabled="index === 0" title="上移" @click="moveUp(index)">↑</button>
              <button
                class="op-list-action-btn"
                :disabled="index >= items.length - 1"
                title="下移"
                @click="moveDown(index)"
              >
                ↓
              </button>
              <button class="op-list-action-btn op-list-action-btn--danger" title="删除" @click="removeItem(index)">
                ×
              </button>
            </div>
          </div>
          <div class="op-list-item-body">
            <slot name="operator" :modelValue="item" :index="index" :update="(v: OperatorDSL) => updateItem(index, v)">
              <div class="op-list-fallback">请提供 operator 插槽</div>
            </slot>
          </div>
        </div>
      </div>
      <button class="op-list-add-btn" @click="addItem">＋ 添加操作符</button>
    </template>

    <template v-else>
      <slot name="operator" :modelValue="singleItem" :update="(v: OperatorDSL) => updateSingle(v)" />
    </template>
  </div>
</template>

<style scoped>
.op-list-editor {
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-2);
}

.op-list {
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-2);
}

.op-list-item {
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-md);
  overflow: hidden;
}

.op-list-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px var(--ae-space-2);
  background: var(--ae-bg-elevated);
  border-bottom: 1px solid var(--ae-border-subtle);
}

.op-list-item-title {
  font-size: var(--ae-font-xs);
  font-weight: 600;
  color: var(--ae-text-secondary);
}

.op-list-item-actions {
  display: flex;
  gap: 2px;
}

.op-list-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  font-size: 13px;
  font-weight: 600;
  background: transparent;
  border: none;
  border-radius: var(--ae-radius-sm);
  color: var(--ae-text-muted);
  cursor: pointer;
  transition:
    color 0.12s,
    background 0.12s;
}

.op-list-action-btn:hover:not(:disabled) {
  color: var(--ae-text-primary);
  background: var(--ae-hover);
}

.op-list-action-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.op-list-action-btn--danger:hover:not(:disabled) {
  color: var(--ae-error);
  background: var(--ae-error-subtle);
}

.op-list-item-body {
  padding: var(--ae-space-2);
}

.op-list-fallback {
  font-size: var(--ae-font-sm);
  color: var(--ae-text-muted);
  padding: var(--ae-space-2);
}

.op-list-add-btn {
  padding: 6px 0;
  font-size: var(--ae-font-sm);
  font-weight: 500;
  color: var(--ae-accent-primary);
  background: var(--ae-accent-primary-subtle);
  border: 1px dashed var(--ae-accent-primary);
  border-radius: var(--ae-radius-sm);
  cursor: pointer;
  transition: background 0.12s;
}

.op-list-add-btn:hover {
  background: var(--ae-accent-primary-subtle);
  filter: brightness(1.2);
}
</style>
