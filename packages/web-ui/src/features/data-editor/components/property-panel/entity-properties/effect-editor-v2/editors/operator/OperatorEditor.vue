<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  OperatorDSL,
  OperatorDSLView,
  MarkSchemaType,
  EffectDslFieldTypingRule,
  ConditionDSL,
} from '@arcadia-eternity/schema'
import DslNode from '../../DslNode.vue'
import { useNodeTyping } from '../../composables/useNodeTyping'
import { getOperatorFieldHint } from '../../composables/useOperatorFieldHint'
import { getFieldList } from './fieldRegistry'
import { OPERATOR_TYPE_LABELS } from '../../constants/operatorLabels'
import type { FieldConfig } from './fieldRegistry'

defineOptions({ name: 'OperatorEditor' })

const props = defineProps<{
  modelValue: OperatorDSL
  fieldRule?: EffectDslFieldTypingRule
}>()

const emit = defineEmits<{ 'update:modelValue': [value: OperatorDSL] }>()

const typing = useNodeTyping()

// ── Model helpers ────────────────────────────────────────────────────────────

function opField(key: keyof OperatorDSLView): unknown {
  return (props.modelValue as OperatorDSLView)[key]
}

function updateField(field: keyof OperatorDSLView, value: unknown) {
  emit('update:modelValue', { ...props.modelValue, [field]: value } as OperatorDSL)
}

/** Cast manifest field key to OperatorDSLView key. Safe — manifest keys are valid fields. */
function fk(key: string): keyof OperatorDSLView {
  return key as keyof OperatorDSLView
}

// ── Type state ───────────────────────────────────────────────────────────────

const hasType = computed(() => {
  const t = (props.modelValue as OperatorDSLView).type
  return typeof t === 'string' && t.length > 0
})

const selectedType = computed(() => (props.modelValue as OperatorDSLView).type ?? '')

const validTypes = computed(() => typing.operatorTypes.value)

// ── Type picker state ────────────────────────────────────────────────────────

const searchQuery = ref('')
const activeCategory = ref('伤害/治疗')

// ── Categories ───────────────────────────────────────────────────────────────

interface CategoryDef {
  key: string
  label: string
  operators: OperatorDSL['type'][]
}

const categories: CategoryDef[] = [
  {
    key: '伤害/治疗',
    label: '伤害/治疗',
    operators: ['dealDamage', 'heal', 'executeKill', 'preventDamage', 'addModified', 'addThreshold'],
  },
  {
    key: '标记/堆叠',
    label: '标记/堆叠',
    operators: [
      'addMark',
      'destroyMark',
      'transferMark',
      'addStacks',
      'consumeStacks',
      'modifyStackResult',
      'setMarkDuration',
      'setMarkStack',
      'setMarkMaxStack',
      'setMarkPersistent',
      'setMarkStackable',
      'setMarkStackStrategy',
      'setMarkDestroyable',
      'setMarkIsShield',
      'setMarkKeepOnSwitchOut',
      'setMarkTransferOnSwitch',
      'setMarkInheritOnFaint',
      'setStatLevelMarkLevel',
      'overrideMarkConfig',
    ],
  },
  {
    key: '属性修改',
    label: '属性修改',
    operators: [
      'addAttributeModifier',
      'addDynamicAttributeModifier',
      'addClampMaxModifier',
      'addClampMinModifier',
      'addClampModifier',
      'addSkillAttributeModifier',
      'addDynamicSkillAttributeModifier',
      'addSkillClampMaxModifier',
      'addSkillClampMinModifier',
      'addSkillClampModifier',
      'addConfigModifier',
      'addDynamicConfigModifier',
      'addTaggedConfigModifier',
      'addPhaseConfigModifier',
      'addPhaseDynamicConfigModifier',
      'addPhaseTypeConfigModifier',
      'addDynamicPhaseTypeConfigModifier',
      'registerConfig',
      'registerTaggedConfig',
      'setConfig',
    ],
  },
  {
    key: '能力阶段',
    label: '能力阶段',
    operators: ['statStageBuff', 'clearStatStage', 'reverseStatStage', 'transferStatStage'],
  },
  {
    key: '必中/必暴',
    label: '必中/必暴',
    operators: ['setSureHit', 'setSureCrit', 'setSureMiss', 'setSureNoCrit', 'setIgnoreShield'],
  },
  {
    key: '威力/怒气',
    label: '威力/怒气',
    operators: [
      'amplifyPower',
      'addPower',
      'addCritRate',
      'addAccuracy',
      'addRage',
      'setRage',
      'setMultihit',
      'addMultihitResult',
    ],
  },
  {
    key: '特殊效果',
    label: '特殊效果',
    operators: [
      'stun',
      'setSkill',
      'setActualTarget',
      'disableContext',
      'transform',
      'transformWithPreservation',
      'removeTransformation',
      'executeActions',
      'addTemporaryEffect',
      'addValue',
      'setValue',
      'toggle',
      'setIgnoreStageStrategy',
      'setAccuracy',
    ],
  },
]

const filteredCategories = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return categories
  return categories
    .map(c => ({
      ...c,
      operators: c.operators.filter(op => op.toLowerCase().includes(q) || typeLabel(op).toLowerCase().includes(q)),
    }))
    .filter(c => c.operators.length > 0)
})

function typeLabel(type: OperatorDSL['type']): string {
  return OPERATOR_TYPE_LABELS[type] ?? type
}

function selectType(type: OperatorDSL['type']) {
  emit('update:modelValue', { type } as OperatorDSL)
}

function goBack() {
  emit('update:modelValue', {} as OperatorDSL)
}

// ── Field form helpers ───────────────────────────────────────────────────────

function fieldHint(fieldName: keyof OperatorDSLView): string | undefined {
  return getOperatorFieldHint(selectedType.value, fieldName)
}

function getFieldTyping(field: FieldConfig): EffectDslFieldTypingRule | undefined {
  return typing.getFieldTyping(
    'operator',
    selectedType.value,
    field.key,
    field.kind === 'selector' ? 'selectorFields' : 'valueFields',
  )
}

const fieldList = computed(() => {
  if (!hasType.value) return []
  return getFieldList(selectedType.value)
})

// ── Special operator detection ───────────────────────────────────────────────

const isConditional = computed(() => selectedType.value === 'conditional')
const isOverrideMarkConfig = computed(() => selectedType.value === 'overrideMarkConfig')

// ── Config sub-fields for overrideMarkConfig ─────────────────────────────────

const configValue = computed(() => (props.modelValue as OperatorDSLView).config ?? {})

function updateConfigField(fieldName: keyof NonNullable<MarkSchemaType['config']>, value: unknown) {
  const currentConfig = (props.modelValue as OperatorDSLView).config ?? {}
  emit('update:modelValue', {
    ...props.modelValue,
    config: { ...currentConfig, [fieldName]: value },
  } as OperatorDSL)
}
</script>

<template>
  <div class="op-editor">
    <!-- ════════════════════════════════════════════════════════════════════ -->
    <!-- Mode 1: Type Picker                                                    -->
    <!-- ════════════════════════════════════════════════════════════════════ -->
    <template v-if="!hasType">
      <div class="op-picker">
        <div class="op-picker-search">
          <input v-model="searchQuery" type="text" placeholder="搜索操作符..." class="op-search-input" />
        </div>
        <div class="op-picker-tabs">
          <button
            v-for="cat in categories"
            :key="cat.key"
            :class="['op-tab', { active: activeCategory === cat.key }]"
            @click="activeCategory = cat.key"
          >
            {{ cat.label }}
          </button>
        </div>
        <div class="op-picker-body">
          <template v-for="cat in filteredCategories" :key="cat.key">
            <div v-if="cat.key === activeCategory || searchQuery" class="op-category">
              <div v-if="searchQuery" class="op-category-label">{{ cat.label }}</div>
              <div class="op-grid">
                <button
                  v-for="op in cat.operators"
                  :key="op"
                  :class="['op-btn', { invalid: !validTypes.includes(op) }]"
                  :disabled="!validTypes.includes(op)"
                  @click="selectType(op as OperatorDSL['type'])"
                >
                  {{ typeLabel(op as OperatorDSL['type']) }}
                </button>
              </div>
            </div>
          </template>
          <div v-if="filteredCategories.length === 0" class="op-no-results">无匹配操作符</div>
        </div>
      </div>
    </template>

    <!-- ════════════════════════════════════════════════════════════════════ -->
    <!-- Mode 2: Field Form                                                    -->
    <!-- ════════════════════════════════════════════════════════════════════ -->
    <template v-else>
      <div class="op-form">
        <div class="op-form-header">
          <span class="op-type-badge">{{ typeLabel(selectedType) }}</span>
          <button class="op-back-btn" @click="goBack">← 更换类型</button>
        </div>

        <div class="op-form-fields">
          <!-- ── Special: conditional operator ──────────────────────────── -->
          <template v-if="isConditional">
            <div class="op-conditional-branch">
              <div class="op-branch-label true">true</div>
              <DslNode
                kind="condition"
                :model-value="opField('condition') as ConditionDSL | undefined"
                @update:model-value="(v: unknown) => updateField('condition', v)"
              />
            </div>
            <div class="op-conditional-branch">
              <DslNode
                kind="operator"
                :model-value="opField('trueOperator') as OperatorDSL | undefined"
                @update:model-value="(v: unknown) => updateField('trueOperator', v)"
              />
            </div>
            <div class="op-conditional-branch">
              <div class="op-branch-label false">false</div>
              <DslNode
                kind="operator"
                :model-value="opField('falseOperator') as OperatorDSL | undefined"
                :nullable="true"
                :clearable="true"
                @update:model-value="(v: unknown) => updateField('falseOperator', v)"
              />
            </div>
          </template>

          <!-- ── Standard fields (all non-conditional operators) ────────── -->
          <template v-else>
            <!-- Regular fields from manifest -->
            <div v-for="field in fieldList" :key="field.key" class="op-field">
              <span class="op-field-label">{{ field.label }}</span>

              <!-- Inline: el-select -->
              <el-select
                v-if="field.component === 'el-select'"
                :model-value="opField(fk(field.key)) ?? ''"
                size="small"
                class="op-inline-select"
                @update:model-value="(v: unknown) => updateField(fk(field.key), v)"
              >
                <el-option
                  v-for="opt in field.componentOptions ?? []"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>

              <!-- DslNode for all other kinds -->
              <div v-else class="op-dsl-field">
                <DslNode
                  :kind="field.kind as 'selector' | 'value' | 'condition' | 'evaluator' | 'operator'"
                  :model-value="opField(fk(field.key)) as any"
                  :label="undefined"
                  :field-rule="getFieldTyping(field)"
                  :nullable="field.optional"
                  :clearable="field.optional"
                  @update:model-value="(v: unknown) => updateField(fk(field.key), v)"
                />
                <span v-if="fieldHint(field.key)" class="op-field-hint">{{ fieldHint(field.key) }}</span>
              </div>
            </div>

            <!-- Special: overrideMarkConfig config sub-fields -->
            <div v-if="isOverrideMarkConfig" class="op-mark-config-inline">
              <span class="op-config-section-label">标记配置</span>
              <div class="op-field">
                <span class="op-field-label">持续回合</span>
                <el-input-number
                  :model-value="(configValue.duration as number | undefined) ?? 0"
                  :min="0"
                  size="small"
                  controls-position="right"
                  @update:model-value="(v: number | undefined) => updateConfigField('duration', v ?? 0)"
                />
              </div>
              <div class="op-field">
                <span class="op-field-label">最大堆叠</span>
                <el-input-number
                  :model-value="(configValue.maxStacks as number | undefined) ?? 0"
                  :min="0"
                  :max="999"
                  size="small"
                  controls-position="right"
                  @update:model-value="(v: number | undefined) => updateConfigField('maxStacks', v ?? 0)"
                />
              </div>
              <div class="op-field">
                <span class="op-field-label">可堆叠</span>
                <el-switch
                  :model-value="!!configValue.stackable"
                  @update:model-value="(v: string | number | boolean) => updateConfigField('stackable', !!v)"
                />
              </div>
              <div class="op-field">
                <span class="op-field-label">护盾</span>
                <el-switch
                  :model-value="!!configValue.isShield"
                  @update:model-value="(v: string | number | boolean) => updateConfigField('isShield', !!v)"
                />
              </div>
            </div>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.op-editor {
  display: flex;
  flex-direction: column;
}

/* ── Type Picker ──────────────────────────────────────────────────────────── */

.op-picker {
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-2);
}

.op-picker-search {
  padding: 0 var(--ae-space-2);
}

.op-search-input {
  width: 100%;
  height: 30px;
  padding: 0 var(--ae-space-3);
  font-size: var(--ae-font-sm);
  background: var(--ae-bg-overlay);
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-sm);
  color: var(--ae-text-primary);
  outline: none;
  box-sizing: border-box;
}

.op-search-input::placeholder {
  color: var(--ae-text-muted);
}

.op-search-input:focus {
  border-color: var(--ae-accent-primary);
  box-shadow: 0 0 0 2px var(--ae-accent-primary-subtle);
}

.op-picker-tabs {
  display: flex;
  gap: 1px;
  padding: 0 var(--ae-space-2);
  overflow-x: auto;
}

.op-tab {
  flex-shrink: 0;
  padding: 4px 10px;
  font-size: var(--ae-font-xs);
  font-weight: 500;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--ae-text-muted);
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s;
}

.op-tab.active {
  color: var(--ae-text-primary);
  border-bottom-color: var(--ae-accent-primary);
}

.op-tab:hover:not(.active) {
  color: var(--ae-text-secondary);
}

.op-picker-body {
  padding: 0 var(--ae-space-2) var(--ae-space-2);
  max-height: 320px;
  overflow-y: auto;
}

.op-category-label {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  padding: var(--ae-space-1) 0;
}

.op-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 4px;
}

.op-btn {
  padding: 6px 8px;
  font-size: var(--ae-font-xs);
  text-align: center;
  background: var(--ae-bg-overlay);
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-sm);
  color: var(--ae-text-primary);
  cursor: pointer;
  transition:
    background 0.12s,
    border-color 0.12s;
}

.op-btn:hover:not(:disabled) {
  background: var(--ae-hover);
  border-color: var(--ae-border-default);
}

.op-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.op-no-results {
  text-align: center;
  padding: var(--ae-space-4);
  font-size: var(--ae-font-sm);
  color: var(--ae-text-muted);
}

/* ── Field Form ───────────────────────────────────────────────────────────── */

.op-form {
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-2);
}

.op-form-header {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
  padding-bottom: var(--ae-space-1);
  border-bottom: 1px solid var(--ae-border-subtle);
}

.op-type-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  font-size: var(--ae-font-xs);
  font-weight: 600;
  color: var(--ae-accent-primary);
  background: var(--ae-accent-primary-subtle);
  border-radius: 999px;
}

.op-back-btn {
  padding: 2px 6px;
  font-size: var(--ae-font-xs);
  background: transparent;
  border: none;
  color: var(--ae-text-muted);
  cursor: pointer;
  transition: color 0.12s;
}

.op-back-btn:hover {
  color: var(--ae-text-primary);
}

.op-form-fields {
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-2);
}

/* ── Field row ────────────────────────────────────────────────────────────── */

.op-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.op-field-label {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  font-weight: 500;
}

.op-dsl-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.op-field-hint {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-disabled);
  font-style: italic;
}

.op-inline-select {
  width: 100%;
}

/* ── Conditional branches ─────────────────────────────────────────────────── */

.op-conditional-branch {
  padding: var(--ae-space-2);
  background: var(--ae-bg-overlay);
  border-radius: var(--ae-radius-sm);
  border: 1px solid var(--ae-border-subtle);
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-1);
}

.op-branch-label {
  font-size: var(--ae-font-xs);
  font-weight: 700;
  font-family: monospace;
}

.op-branch-label.true {
  color: var(--ae-success);
}

.op-branch-label.false {
  color: var(--ae-error);
}

/* ── Mark config inline section ───────────────────────────────────────────── */

.op-mark-config-inline {
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-2);
  padding: var(--ae-space-2);
  background: var(--ae-bg-overlay);
  border-radius: var(--ae-radius-sm);
  border: 1px solid var(--ae-border-subtle);
}

.op-config-section-label {
  font-size: var(--ae-font-xs);
  font-weight: 600;
  color: var(--ae-text-secondary);
}
</style>
