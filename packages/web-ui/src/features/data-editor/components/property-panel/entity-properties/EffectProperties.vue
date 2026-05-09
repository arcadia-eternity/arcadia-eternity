<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { OperatorDSL, EvaluatorDSL, ConditionDSL } from '@arcadia-eternity/schema'
import { useGameDataStore } from '@/stores/gameData'
import EffectHeader from './effect-editor/layout/EffectHeader.vue'
import SelectorEditor from './effect-editor/selector/SelectorEditor.vue'
import ValueEditor from './effect-editor/value/ValueEditor.vue'
import ConditionNode from './effect-editor/condition/ConditionNode.vue'
import EvaluatorEditor from './effect-editor/evaluator/EvaluatorEditor.vue'
import SlotSelectorValue from './effect-editor/value/SlotSelectorValue.vue'
import OperatorEditor from './effect-editor/operator/OperatorEditor.vue'
import OperatorListEditor from './effect-editor/operator/OperatorListEditor.vue'
import EffectFooter from './effect-editor/layout/EffectFooter.vue'
import { useEffectTyping, resolveStringEnumOptions } from './effect-editor/composables/useEffectTyping'
import { resolveEvaluatorValueTyping } from './effect-editor/composables/useEffectTyping'
import { useEffectValidation } from './effect-editor/composables/useEffectValidation'
import type { ValidationResult } from './effect-editor/composables/useEffectValidation'

const props = defineProps<{
  record: Record<string, unknown> | null
  draft: Record<string, unknown>
  schema: unknown
}>()

const emit = defineEmits<{
  'update:draft': [draft: Record<string, unknown>]
}>()

const gameData = useGameDataStore()
const typing = useEffectTyping()

const gameDataRef = computed(() => ({
  marks: gameData.marks,
  skills: gameData.skills,
  species: gameData.species,
  effects: gameData.effects,
}))

const validation = useEffectValidation(gameDataRef)

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

const activeTab = ref<'editor' | 'monaco'>('editor')

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

function applyTypingConstraints(
  field: unknown,
  opType: string | undefined,
): {
  selectorFilter?: string[]
  valueFilter?: string[]
  expectedScalarType?: 'number' | 'string' | 'boolean'
  stringEnumOptions?: import('@arcadia-eternity/schema').StringEnumOption[]
  fieldRule?: import('@arcadia-eternity/schema').EffectDslFieldTypingRule
  valueFieldRule?: import('@arcadia-eternity/schema').EffectDslFieldTypingRule
} {
  const fieldName = typeof field === 'string' ? field : undefined
  if (!fieldName || !opType) return {}

  const selRule = typing.getFieldTyping('operator', opType, fieldName, 'selectorFields')
  const valRule = typing.getFieldTyping('operator', opType, fieldName, 'valueFields')

  const selOpts = selRule ? typing.resolveSelectorOptions(selRule) : undefined
  const valOpts = valRule ? typing.resolveValueTypeOptions(valRule).map(o => o.value) : undefined

  let expectedScalarType: 'number' | 'string' | 'boolean' | undefined
  if (valRule) {
    for (const c of valRule.allow) {
      if (c.kind === 'scalar' && c.valueTypes?.length === 1) {
        const vt = c.valueTypes[0]
        if (vt === 'number' || vt === 'string' || vt === 'boolean') expectedScalarType = vt
      }
    }
  }

  const stringEnumOptions = typing.resolveStringEnumOptions(valRule)

  return {
    selectorFilter: selOpts?.map(o => o.value),
    valueFilter: valOpts,
    expectedScalarType,
    stringEnumOptions: stringEnumOptions as import('@arcadia-eternity/schema').StringEnumOption[] | undefined,
    fieldRule: selRule,
    valueFieldRule: valRule,
  }
}

function getOperatorTypeFromModel(opModel: unknown): string | undefined {
  if (!opModel || typeof opModel !== 'object') return undefined
  return (opModel as Record<string, unknown>).type as string | undefined
}

function getEvaluatorTypeFromModel(evModel: unknown): string | undefined {
  if (!evModel || typeof evModel !== 'object') return undefined
  return (evModel as Record<string, unknown>).type as string | undefined
}

function resolveOperatorStringEnum(
  opModel: unknown | undefined,
  opField: string | undefined,
  category: 'selectorFields' | 'valueFields',
): import('@arcadia-eternity/schema').StringEnumOption[] | undefined {
  if (!opModel || !opField) return undefined
  const opType = getOperatorTypeFromModel(opModel)
  if (!opType) return undefined
  const opRule = typing.getFieldTyping('operator', opType, opField, category)
  return resolveStringEnumOptions(opRule)
}

function resolveEvaluatorTyping(
  evModel: unknown,
  fieldName: string | undefined,
  operatorStringEnumOptions?: import('@arcadia-eternity/schema').StringEnumOption[],
): {
  valueFilter?: string[]
  stringEnumOptions?: import('@arcadia-eternity/schema').StringEnumOption[]
} {
  if (!fieldName) return {}
  const evType = getEvaluatorTypeFromModel(evModel)
  if (!evType) return {}
  return resolveEvaluatorValueTyping(evType, fieldName, operatorStringEnumOptions)
}
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
          @update:model-value="v => updateField('apply', v)"
        >
          <template #operator="{ modelValue, update }">
            <OperatorEditor :model-value="modelValue ?? ({ type: 'TODO' } as OperatorDSL)" @update:model-value="update">
              <template #target="{ modelValue: tv, update: tu, field: targetField }">
                <SelectorEditor
                  :model-value="tv"
                  :allowed-bases="
                    applyTypingConstraints(targetField, getOperatorTypeFromModel(modelValue)).selectorFilter
                  "
                  :field-rule="applyTypingConstraints(targetField, getOperatorTypeFromModel(modelValue)).fieldRule"
                  @update:model-value="tu"
                >
                  <template #evaluator="{ modelValue: ev, update: eu }">
                    <EvaluatorEditor :model-value="ev as EvaluatorDSL" @update:model-value="eu">
                      <template #value="{ modelValue: evv, update: evu, field }">
                        <SlotSelectorValue
                          :model-value="evv"
                          :allowed-types="
                            resolveEvaluatorTyping(
                              ev,
                              field,
                              resolveOperatorStringEnum(modelValue, targetField, 'selectorFields'),
                            ).valueFilter
                          "
                          :string-enum-options="
                            resolveEvaluatorTyping(
                              ev,
                              field,
                              resolveOperatorStringEnum(modelValue, targetField, 'selectorFields'),
                            ).stringEnumOptions
                          "
                          @update:model-value="evu"
                        />
                      </template>
                    </EvaluatorEditor>
                  </template>
                  <template #value="{ modelValue: cv, update: cu }">
                    <SlotSelectorValue :model-value="cv" @update:model-value="cu" />
                  </template>
                  <template #condition="{ modelValue: ccv, update: ccu }">
                    <ConditionNode
                      :model-value="ccv as ConditionDSL"
                      @update:model-value="v => ccu(v as ConditionDSL)"
                    />
                  </template>
                  <template #trueValue="{ modelValue: tvv, update: tvu }">
                    <SlotSelectorValue :model-value="tvv" @update:model-value="tvu">
                      <template #condition="{ modelValue: ccv, onUpdate: ccu }">
                        <ConditionNode :model-value="ccv" @update:model-value="v => ccu(v as ConditionDSL)" />
                      </template>
                    </SlotSelectorValue>
                  </template>
                  <template #falseValue="{ modelValue: fvv, update: fvu }">
                    <SlotSelectorValue :model-value="fvv" @update:model-value="fvu">
                      <template #condition="{ modelValue: ccv, onUpdate: ccu }">
                        <ConditionNode :model-value="ccv" @update:model-value="v => ccu(v as ConditionDSL)" />
                      </template>
                    </SlotSelectorValue>
                  </template>
                </SelectorEditor>
              </template>
              <template #value="{ modelValue: vv, update: vu, field: valueField }">
                <ValueEditor
                  :model-value="vv"
                  :allowed-types="applyTypingConstraints(valueField, getOperatorTypeFromModel(modelValue)).valueFilter"
                  :string-enum-options="
                    applyTypingConstraints(valueField, getOperatorTypeFromModel(modelValue)).stringEnumOptions
                  "
                  @update:model-value="vu"
                >
                  <template #selector="{ modelValue: dsv, update: dsu }">
                    <SelectorEditor
                      :model-value="dsv"
                      :expected-value-type="
                        applyTypingConstraints(valueField, getOperatorTypeFromModel(modelValue)).expectedScalarType
                      "
                      :field-rule="
                        applyTypingConstraints(valueField, getOperatorTypeFromModel(modelValue)).valueFieldRule
                      "
                      @update:model-value="dsu"
                    >
                      <template #evaluator="{ modelValue: dev, update: deu }">
                        <EvaluatorEditor :model-value="dev as EvaluatorDSL" @update:model-value="deu">
                          <template #value="{ modelValue: devv, update: devu, field: evField }">
                            <SlotSelectorValue
                              :model-value="devv"
                              :allowed-types="
                                resolveEvaluatorTyping(
                                  dev,
                                  evField,
                                  resolveOperatorStringEnum(modelValue, valueField, 'valueFields'),
                                ).valueFilter
                              "
                              :string-enum-options="
                                resolveEvaluatorTyping(
                                  dev,
                                  evField,
                                  resolveOperatorStringEnum(modelValue, valueField, 'valueFields'),
                                ).stringEnumOptions
                              "
                              @update:model-value="devu"
                            />
                          </template>
                        </EvaluatorEditor>
                      </template>
                      <template #value="{ modelValue: dcv, update: dcu }">
                        <SlotSelectorValue :model-value="dcv" @update:model-value="dcu" />
                      </template>
                    </SelectorEditor>
                  </template>
                  <template #condition="{ modelValue: ccv, onUpdate: ccu }">
                    <ConditionNode
                      :model-value="ccv"
                      :operator-type="getOperatorTypeFromModel(modelValue)"
                      :field="valueField"
                      field-category="valueFields"
                      @update:model-value="v => ccu(v as ConditionDSL)"
                    />
                  </template>
                </ValueEditor>
              </template>
              <template #condition="{ modelValue: cv, update: cu }">
                <ConditionNode
                  :model-value="cv"
                  :operator-type="getOperatorTypeFromModel(modelValue)"
                  @update:model-value="cu"
                />
              </template>
              <template #operator="{ modelValue: ov, update: ou }">
                <OperatorEditor :model-value="ov" @update:model-value="ou">
                  <template #target="{ modelValue: tv2, update: tu2, field: targetField2 }">
                    <SelectorEditor
                      :model-value="tv2"
                      :allowed-bases="applyTypingConstraints(targetField2, getOperatorTypeFromModel(ov)).selectorFilter"
                      :field-rule="applyTypingConstraints(targetField2, getOperatorTypeFromModel(ov)).fieldRule"
                      @update:model-value="tu2"
                    >
                      <template #evaluator="{ modelValue: ev, update: eu }">
                        <EvaluatorEditor :model-value="ev as EvaluatorDSL" @update:model-value="eu">
                          <template #value="{ modelValue: evv, update: evu, field }">
                            <SlotSelectorValue
                              :model-value="evv"
                              :allowed-types="
                                resolveEvaluatorTyping(
                                  ev,
                                  field,
                                  resolveOperatorStringEnum(ov, targetField2, 'selectorFields'),
                                ).valueFilter
                              "
                              :string-enum-options="
                                resolveEvaluatorTyping(
                                  ev,
                                  field,
                                  resolveOperatorStringEnum(ov, targetField2, 'selectorFields'),
                                ).stringEnumOptions
                              "
                              @update:model-value="evu"
                            />
                          </template>
                        </EvaluatorEditor>
                      </template>
                      <template #value="{ modelValue: cv2, update: cu2 }">
                        <SlotSelectorValue :model-value="cv2" @update:model-value="cu2" />
                      </template>
                    </SelectorEditor>
                  </template>
                  <template #value="{ modelValue: vv4, update: vu4, field: nestedValueField }">
                    <SlotSelectorValue :model-value="vv4" @update:model-value="vu4">
                      <template #condition="{ modelValue: ccv, onUpdate: ccu }">
                        <ConditionNode
                          :model-value="ccv"
                          :operator-type="getOperatorTypeFromModel(ov)"
                          :field="nestedValueField"
                          field-category="valueFields"
                          @update:model-value="v => ccu(v as ConditionDSL)"
                        />
                      </template>
                    </SlotSelectorValue>
                  </template>
                </OperatorEditor>
              </template>
            </OperatorEditor>
          </template>
        </OperatorListEditor>
      </div>

      <div class="body-section">
        <div class="section-header">
          <span class="section-title">条件 (Condition)</span>
          <span class="section-hint">— 可选，满足条件时才执行</span>
        </div>
        <ConditionNode
          :model-value="(getField('condition') as ConditionDSL | undefined) ?? undefined"
          @update:model-value="v => updateField('condition', v)"
        />
      </div>

      <EffectFooter
        :model-value="{
          consumesStacks: getField('consumesStacks') as number,
          tags: getField('tags') as string[] | undefined,
        }"
        @update:model-value="
          v => {
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

.section-placeholder {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 24px;
  border: 1px dashed var(--ae-border-subtle);
  border-radius: 6px;
  background: var(--ae-bg-overlay);
}

.placeholder-icon {
  font-size: 20px;
}

.placeholder-text {
  font-size: 12px;
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
