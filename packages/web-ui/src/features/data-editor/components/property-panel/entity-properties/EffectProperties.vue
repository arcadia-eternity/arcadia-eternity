<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useGameDataStore } from '@/stores/gameData'
import DslNode from './effect-editor-v2/DslNode.vue'
import OperatorListEditor from './effect-editor-v2/editors/operator/OperatorListEditor.vue'
import EffectHeader from './effect-editor-v2/layout/EffectHeader.vue'
import EffectFooter from './effect-editor-v2/layout/EffectFooter.vue'
import { useProvideDslContext } from './effect-editor-v2/composables/useDslContext'
import { useEffectValidation } from './effect-editor-v2/composables/useEffectValidation'
import type { ValidationResult } from './effect-editor-v2/composables/useEffectValidation'
import type { ConditionDSL, OperatorDSL } from '@arcadia-eternity/schema'

defineOptions({ name: 'EffectProperties' })

const props = defineProps<{
  record: Record<string, unknown> | null
  draft: Record<string, unknown>
  schema: unknown
}>()

const emit = defineEmits<{ 'update:draft': [draft: Record<string, unknown>] }>()

useProvideDslContext()

const gameData = useGameDataStore()

const gameDataRef = computed(() => ({
  marks: gameData.marks,
  skills: gameData.skills,
  species: gameData.species,
  effects: gameData.effects,
}))

const validation = useEffectValidation(gameDataRef)

const activeTab = ref<'editor' | 'monaco'>('editor')

function updateField(path: string, value: unknown) {
  const newDraft = { ...props.draft }
  const parts = path.split('.')
  let current = newDraft as Record<string, unknown>
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {}
    }
    current = current[parts[i]] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
  emit('update:draft', newDraft)
}

function getField(path: string): unknown {
  const parts = path.split('.')
  let current: unknown = props.draft
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

const validationErrors = computed<ValidationResult[]>(() => validation.errors.value)
const validationWarnings = computed<ValidationResult[]>(() => validation.warnings.value)
const validationRefErrors = computed<ValidationResult[]>(() => validation.referenceErrors.value)

let debounceTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => props.draft,
  () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      validation.validate(props.draft)
    }, 300)
  },
  { deep: true, immediate: true },
)
</script>

<template>
  <div v-if="record" class="effect-properties">
    <EffectHeader
      :id="(record.id as string) ?? ''"
      :model-value="(getField('trigger') as string | string[]) ?? []"
      :priority="(getField('priority') as number) ?? 0"
      @update:model-value="(v: string | string[]) => updateField('trigger', v)"
      @update:priority="(v: number) => updateField('priority', v)"
    />

    <div class="effect-tabs">
      <button :class="['tab-btn', { active: activeTab === 'editor' }]" @click="activeTab = 'editor'">可视化编辑</button>
      <button :class="['tab-btn', { active: activeTab === 'monaco' }]" @click="activeTab = 'monaco'">YAML 源码</button>
    </div>

    <div v-if="activeTab === 'editor'" class="effect-body">
      <div class="body-section">
        <div class="section-header">
          <span class="section-title">操作符 (Apply)</span>
          <span class="section-hint">— 触发器触发时执行的操作</span>
        </div>
        <OperatorListEditor
          :model-value="(getField('apply') as OperatorDSL | OperatorDSL[]) ?? {}"
          @update:model-value="(v: unknown) => updateField('apply', v)"
        >
          <template #default="{ modelValue, update }">
            <DslNode
              kind="operator"
              :model-value="modelValue"
              @update:model-value="(v: unknown) => update(v as OperatorDSL)"
            />
          </template>
        </OperatorListEditor>
      </div>

      <div class="body-section">
        <div class="section-header">
          <span class="section-title">条件 (Condition)</span>
          <span class="section-hint">— 可选，满足条件时才执行</span>
        </div>
        <DslNode
          kind="condition"
          :model-value="getField('condition') as ConditionDSL | undefined"
          nullable
          @update:model-value="(v: unknown) => updateField('condition', v)"
        />
      </div>

      <EffectFooter
        :model-value="{
          consumesStacks: getField('consumesStacks') as number,
          tags: getField('tags') as string[] | undefined,
        }"
        @update:model-value="
          (v: { consumesStacks?: number; tags?: string[] }) => {
            updateField('consumesStacks', v.consumesStacks)
            updateField('tags', v.tags)
          }
        "
      />

      <div v-if="validationErrors.length > 0" class="validation-errors">
        <div v-for="(err, i) in validationErrors" :key="i" class="validation-error-item">
          <span class="error-badge L1">L1</span>
          <span>{{ err.message }}</span>
        </div>
      </div>

      <div v-if="validationWarnings.length > 0" class="validation-warnings">
        <div v-for="(warn, i) in validationWarnings" :key="i" class="validation-warn-item">
          <span class="warn-badge">⚠</span>
          <span>{{ warn.message }}</span>
        </div>
      </div>

      <div v-if="validationRefErrors.length > 0" class="validation-ref-errors">
        <div class="ref-errors-header">⚠ 引用完整性检查</div>
        <div v-for="(err, i) in validationRefErrors" :key="i" class="validation-ref-item">
          <span class="error-badge L3">L3</span>
          <span>{{ err.message }}</span>
        </div>
      </div>
    </div>

    <div v-else class="effect-body">
      <pre class="monaco-placeholder">{{ JSON.stringify(draft, null, 2) }}</pre>
    </div>
  </div>
  <div v-else class="empty-state">选择一个效果查看属性</div>
</template>

<style scoped>
.effect-properties {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.effect-tabs {
  display: flex;
  border-bottom: 1px solid var(--ae-border-subtle);
  flex-shrink: 0;
}

.tab-btn {
  padding: 6px 16px;
  font-size: 12px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--ae-text-muted);
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s;
}

.tab-btn.active {
  color: var(--ae-text-primary);
  border-bottom-color: var(--ae-accent, #4a90d9);
}

.tab-btn:hover:not(.active) {
  color: var(--ae-text-secondary);
}

.effect-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 16px;
}

.body-section {
  margin-bottom: 16px;
}

.section-header {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 8px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ae-text-primary);
}

.section-hint {
  font-size: 11px;
  color: var(--ae-text-muted);
}

.validation-errors,
.validation-warnings {
  margin-top: 12px;
  padding: 8px;
  border-radius: 4px;
}

.validation-errors {
  background: rgba(248, 113, 113, 0.08);
}

.validation-warnings {
  background: rgba(251, 191, 36, 0.08);
}

.validation-error-item,
.validation-warn-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  margin-bottom: 4px;
}

.error-badge,
.warn-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 16px;
  border-radius: 2px;
  font-size: 9px;
  font-weight: 700;
  flex-shrink: 0;
}

.error-badge.L1 {
  background: rgba(248, 113, 113, 0.2);
  color: #f87171;
}

.warn-badge {
  background: rgba(251, 191, 36, 0.2);
  color: #fbbf24;
}

.validation-ref-errors {
  margin-top: 12px;
  padding: 8px;
  border-radius: 4px;
  background: rgba(248, 113, 113, 0.08);
  border: 1px solid rgba(248, 113, 113, 0.2);
}

.ref-errors-header {
  font-size: 11px;
  font-weight: 600;
  color: #f87171;
  margin-bottom: 4px;
}

.validation-ref-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  margin-bottom: 4px;
}

.error-badge.L3 {
  background: rgba(248, 113, 113, 0.3);
  color: #f87171;
}

.monaco-placeholder {
  font-family: monospace;
  font-size: 11px;
  color: var(--ae-text-muted);
  background: var(--ae-bg-overlay);
  padding: 12px;
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-all;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 200px;
  font-size: 13px;
  color: var(--ae-text-muted);
}
</style>
