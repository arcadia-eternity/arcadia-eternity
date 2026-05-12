<script setup lang="ts">
import { computed } from 'vue'
import DslNode from '../../DslNode.vue'
import type {
  Value,
  SelectorDSL,
  ConditionDSL,
  SelectorChain,
  OperatorDSL,
  ValueView,
  EffectDslFieldTypingRule,
} from '@arcadia-eternity/schema'
import type { StringEnumOption } from '@arcadia-eternity/schema'
import { useGameDataStore } from '@/stores/gameData'

const props = defineProps<{
  modelValue: Value
  label?: string
  allowedTypes?: string[]
  stringEnumOptions?: StringEnumOption[]
  fieldRule?: EffectDslFieldTypingRule
  depth?: number
  maxDepth?: number
}>()

const emit = defineEmits<{ 'update:modelValue': [value: Value] }>()

const gameData = useGameDataStore()

type InferredValueType = ValueView['type'] | 'array' | 'operator'

function inferType(value: Value): InferredValueType {
  if (value === null || value === undefined) return 'raw:number'
  if (typeof value === 'number') return 'raw:number'
  if (typeof value === 'boolean') return 'raw:boolean'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'string') {
    if (value.startsWith('mark_')) return 'entity:baseMark'
    if (value.startsWith('skill_')) return 'entity:baseSkill'
    if (value.startsWith('pet_')) return 'entity:species'
    return 'raw:string'
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && 'type' in value) return value.type
  return 'raw:number'
}

const currentType = computed(() => inferType(props.modelValue))

const VALUE_TYPE_BUTTONS: { key: ValueView['type'] | 'array' | 'operator'; label: string; icon: string }[] = [
  { key: 'raw:number', label: '数字', icon: '123' },
  { key: 'raw:string', label: '字符串', icon: 'abc' },
  { key: 'raw:boolean', label: '布尔值', icon: 'T/F' },
  { key: 'entity:baseMark', label: '标记', icon: '🏷️' },
  { key: 'entity:baseSkill', label: '技能', icon: '🛠️' },
  { key: 'entity:species', label: '物种', icon: '👤' },
  { key: 'entity:effect', label: '效果', icon: '✨' },
  { key: 'dynamic', label: '动态选择', icon: '🎯' },
  { key: 'selectorValue', label: '选择器值', icon: '🔗' },
  { key: 'conditional', label: '条件表达式', icon: '❓' },
  { key: 'array', label: '数组', icon: '📚' },
  { key: 'operator', label: '运算符表达式', icon: '+' },
]

// ── Filtered Type Buttons ─────────────────────────────────────────────────────

const filteredTypes = computed(() => {
  if (!props.allowedTypes || props.allowedTypes.length === 0) return VALUE_TYPE_BUTTONS
  const allowed = new Set(props.allowedTypes)
  return VALUE_TYPE_BUTTONS.filter(b => allowed.has(b.key))
})

// ── Value Shape Helpers ───────────────────────────────────────────────────────

const isObjectValue = computed(() => {
  const v = props.modelValue
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'type' in v
})

const isBarePrimitive = computed(() => {
  const v = props.modelValue
  const ct = currentType.value
  return (
    (ct === 'raw:number' || ct === 'raw:string' || ct === 'raw:boolean') &&
    (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')
  )
})

const typedValue = computed<ValueView | null>(() => {
  const v = props.modelValue
  return isObjectValue.value ? (v as ValueView) : null
})

const safeString = computed(() => {
  const val = typedValue.value?.value
  return typeof val === 'string' ? val : ''
})

const safeNumber = computed(() => {
  const val = typedValue.value?.value
  return typeof val === 'number' ? val : 0
})

const safeBoolean = computed(() => {
  const val = typedValue.value?.value
  return typeof val === 'boolean' ? val : false
})

// ── Entity Option Lists (from gameData store) ─────────────────────────────────

const marksOptions = computed(() =>
  gameData.marks.allIds.filter(id => id.startsWith('mark_')).map(id => ({ value: id, label: id })),
)

const skillsOptions = computed(() =>
  gameData.skills.allIds.filter(id => id.startsWith('skill_')).map(id => ({ value: id, label: id })),
)

const speciesOptions = computed(() => gameData.species.allIds.map(id => ({ value: id, label: id })))

const effectsOptions = computed(() => gameData.effects.allIds.map(id => ({ value: id, label: id })))

// ── Emit Helpers ──────────────────────────────────────────────────────────────

function emitStructured(type: ValueView['type'], partial: Partial<ValueView>) {
  emit('update:modelValue', { ...partial, type } as Value)
}

function emitRawNumber(value: number) {
  if (isObjectValue.value) {
    emitStructured('raw:number', { value })
  } else {
    emit('update:modelValue', value)
  }
}

function emitRawString(value: string) {
  if (isObjectValue.value) {
    emitStructured('raw:string', { value })
  } else {
    emit('update:modelValue', value)
  }
}

function emitRawBoolean(value: boolean) {
  if (isObjectValue.value) {
    emitStructured('raw:boolean', { value })
  } else {
    emit('update:modelValue', value)
  }
}

// ── Type Switching ────────────────────────────────────────────────────────────

function switchType(typeKey: string) {
  const defaults: Record<string, Value> = {
    'raw:number': 0,
    'raw:string': '',
    'raw:boolean': false,
    'entity:baseMark': { type: 'entity:baseMark', value: '' },
    'entity:baseSkill': { type: 'entity:baseSkill', value: '' },
    'entity:species': { type: 'entity:species', value: '' },
    'entity:effect': { type: 'entity:effect', value: '' },
    dynamic: { type: 'dynamic', selector: 'self' as SelectorDSL },
    selectorValue: { type: 'selectorValue', value: 0 as Value },
    conditional: {
      type: 'conditional',
      condition: { type: 'petIsActive' } as ConditionDSL,
      trueValue: 0 as Value,
      falseValue: 0 as Value,
    },
    array: [] as Value[],
    operator: { type: 'TODO' } as OperatorDSL,
  }
  emit('update:modelValue', defaults[typeKey] ?? 0)
}

// ── Array Operations ──────────────────────────────────────────────────────────

function addArrayItem() {
  if (!Array.isArray(props.modelValue)) return
  emit('update:modelValue', [...props.modelValue, 0])
}

function removeArrayItem(index: number) {
  if (!Array.isArray(props.modelValue)) return
  emit('update:modelValue', props.modelValue.filter((_: unknown, i: number) => i !== index) as Value)
}

function updateArrayItem(index: number, value: Value) {
  if (!Array.isArray(props.modelValue)) return
  const next = [...props.modelValue]
  next[index] = value
  emit('update:modelValue', next)
}

// ── Recursion Depth ───────────────────────────────────────────────────────────

const nextDepth = computed(() => (props.depth ?? 0) + 1)
</script>

<template>
  <div class="value-editor" :class="{ 'value-editor--indent': (depth ?? 0) > 0 }">
    <label v-if="label" class="value-label">{{ label }}</label>

    <!-- Type bar -->
    <div class="type-bar">
      <button
        v-for="btn in filteredTypes"
        :key="btn.key"
        :class="['type-btn', { 'type-btn--active': currentType === btn.key }]"
        @click="switchType(btn.key)"
      >
        <span class="type-btn-icon">{{ btn.icon }}</span>
        <span class="type-btn-label">{{ btn.label }}</span>
      </button>
    </div>

    <!-- Editor area -->
    <div class="editor-area">
      <!-- raw:number -->
      <template v-if="currentType === 'raw:number'">
        <el-input-number
          :model-value="isBarePrimitive ? (modelValue as number) : safeNumber"
          @update:model-value="(v: number | undefined) => emitRawNumber(v ?? 0)"
        />
      </template>

      <!-- raw:string -->
      <template v-else-if="currentType === 'raw:string'">
        <el-select
          v-if="stringEnumOptions && stringEnumOptions.length > 0"
          :model-value="isBarePrimitive ? (modelValue as string) : safeString"
          filterable
          placeholder="选择..."
          class="enum-select"
          @update:model-value="(v: string) => emitRawString(v)"
        >
          <el-option v-for="opt in stringEnumOptions" :key="opt.value" :label="opt.label" :value="opt.value">
            <el-tooltip v-if="opt.description" :content="opt.description" placement="right" effect="dark">
              <span>{{ opt.label }}</span>
            </el-tooltip>
            <span v-else>{{ opt.label }}</span>
          </el-option>
        </el-select>
        <el-input
          v-else
          :model-value="isBarePrimitive ? (modelValue as string) : safeString"
          @update:model-value="(v: string) => emitRawString(v)"
        />
      </template>

      <!-- raw:boolean -->
      <template v-else-if="currentType === 'raw:boolean'">
        <div class="switch-row">
          <span class="switch-label">{{ (isBarePrimitive ? modelValue : safeBoolean) ? '是' : '否' }}</span>
          <el-switch
            :model-value="isBarePrimitive ? (modelValue as boolean) : safeBoolean"
            @update:model-value="(v: string | number | boolean) => emitRawBoolean(!!v)"
          />
        </div>
      </template>

      <!-- entity:baseMark -->
      <template v-else-if="currentType === 'entity:baseMark'">
        <el-select
          :model-value="isObjectValue ? (typedValue?.value ?? '') : modelValue"
          filterable
          placeholder="选择标记..."
          @update:model-value="(v: string) => emitStructured('entity:baseMark', { value: v })"
        >
          <el-option v-for="opt in marksOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
      </template>

      <!-- entity:baseSkill -->
      <template v-else-if="currentType === 'entity:baseSkill'">
        <el-select
          :model-value="isObjectValue ? (typedValue?.value ?? '') : modelValue"
          filterable
          placeholder="选择技能..."
          @update:model-value="(v: string) => emitStructured('entity:baseSkill', { value: v })"
        >
          <el-option v-for="opt in skillsOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
      </template>

      <!-- entity:species -->
      <template v-else-if="currentType === 'entity:species'">
        <el-select
          :model-value="isObjectValue ? (typedValue?.value ?? '') : modelValue"
          filterable
          placeholder="选择物种..."
          @update:model-value="(v: string) => emitStructured('entity:species', { value: v })"
        >
          <el-option v-for="opt in speciesOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
      </template>

      <!-- entity:effect -->
      <template v-else-if="currentType === 'entity:effect'">
        <el-select
          :model-value="isObjectValue ? (typedValue?.value ?? '') : modelValue"
          filterable
          placeholder="选择效果..."
          @update:model-value="(v: string) => emitStructured('entity:effect', { value: v })"
        >
          <el-option v-for="opt in effectsOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
      </template>

      <!-- dynamic -->
      <template v-else-if="currentType === 'dynamic'">
        <DslNode
          kind="selector"
          :model-value="typedValue?.selector"
          :field-rule="fieldRule"
          :depth="nextDepth"
          :max-depth="maxDepth"
          @update:model-value="
            (v: unknown) => emit('update:modelValue', { type: 'dynamic' as const, selector: v as SelectorDSL } as Value)
          "
        />
      </template>

      <!-- selectorValue -->
      <template v-else-if="currentType === 'selectorValue'">
        <div class="selector-value-editor">
          <DslNode
            kind="value"
            :model-value="typedValue?.value ?? 0"
            :field-rule="fieldRule"
            :depth="nextDepth"
            :max-depth="maxDepth"
            @update:model-value="
              (v: unknown) =>
                emit('update:modelValue', {
                  type: 'selectorValue' as const,
                  value: v as Value,
                  chain: typedValue?.chain,
                })
            "
          />
          <DslNode
            kind="selector"
            :model-value="{ base: 'self', chain: typedValue?.chain ?? [] }"
            :field-rule="fieldRule"
            :depth="nextDepth"
            :max-depth="maxDepth"
            @update:model-value="
              (v: unknown) => {
                const sv = v as { chain?: SelectorChain[] }
                emit('update:modelValue', {
                  type: 'selectorValue' as const,
                  value: typedValue?.value ?? 0,
                  chain: sv?.chain ?? [],
                })
              }
            "
          />
        </div>
      </template>

      <!-- conditional -->
      <template v-else-if="currentType === 'conditional'">
        <div class="conditional-editor">
          <div class="conditional-section">
            <label class="conditional-label">条件</label>
            <DslNode
              kind="condition"
              :model-value="typedValue?.condition"
              :depth="nextDepth"
              :max-depth="maxDepth"
              @update:model-value="
                (v: unknown) =>
                  emit('update:modelValue', {
                    type: 'conditional' as const,
                    condition: v as ConditionDSL,
                    trueValue: typedValue?.trueValue ?? 0,
                    falseValue: typedValue?.falseValue ?? 0,
                  })
              "
            />
          </div>
          <div class="conditional-section">
            <label class="conditional-label">真值</label>
            <DslNode
              kind="value"
              :model-value="(typedValue?.trueValue as Value) ?? 0"
              :field-rule="fieldRule"
              :depth="nextDepth"
              :max-depth="maxDepth"
              @update:model-value="
                (v: unknown) =>
                  emit('update:modelValue', {
                    type: 'conditional' as const,
                    condition: typedValue!.condition,
                    trueValue: v as Value,
                    falseValue: typedValue?.falseValue,
                  })
              "
            />
          </div>
          <div class="conditional-section">
            <label class="conditional-label">假值</label>
            <DslNode
              kind="value"
              :model-value="typedValue?.falseValue ?? 0"
              :field-rule="fieldRule"
              :depth="nextDepth"
              :max-depth="maxDepth"
              @update:model-value="
                (v: unknown) =>
                  emit('update:modelValue', {
                    type: 'conditional' as const,
                    condition: typedValue!.condition,
                    trueValue: typedValue?.trueValue ?? 0,
                    falseValue: v as Value,
                  })
              "
            />
          </div>
        </div>
      </template>

      <!-- array -->
      <template v-else-if="currentType === 'array'">
        <div class="array-editor">
          <div v-for="(item, index) in Array.isArray(modelValue) ? modelValue : []" :key="index" class="array-item">
            <span class="array-index">{{ index }}</span>
            <DslNode
              kind="value"
              :model-value="item"
              :field-rule="fieldRule"
              :depth="nextDepth"
              :max-depth="maxDepth"
              class="array-value-editor"
              @update:model-value="(v: unknown) => updateArrayItem(index, v as Value)"
            />
            <button class="array-remove-btn" @click="removeArrayItem(index)">×</button>
          </div>
          <button class="array-add-btn" @click="addArrayItem">+ 添加元素</button>
        </div>
      </template>

      <!-- operator -->
      <template v-else-if="currentType === 'operator'">
        <DslNode
          kind="operator"
          :model-value="modelValue"
          :depth="nextDepth"
          :max-depth="maxDepth"
          @update:model-value="(v: unknown) => emit('update:modelValue', v as Value)"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.value-editor {
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-2);
}

.value-editor--indent {
  margin-left: var(--ae-space-4);
  padding-left: var(--ae-space-3);
  border-left: 2px solid var(--ae-border-subtle);
}

.value-label {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  text-transform: uppercase;
  font-weight: 500;
}

.type-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}

.type-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  background: var(--ae-bg-surface);
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-sm);
  cursor: pointer;
  transition: all 0.15s;
  line-height: 1.4;
}

.type-btn:hover {
  color: var(--ae-text-secondary);
  border-color: var(--ae-border-default);
  background: var(--ae-bg-elevated);
}

.type-btn--active {
  color: var(--ae-text-primary);
  border-color: var(--ae-accent-primary);
  background: var(--ae-accent-primary-subtle);
}

.type-btn--active .type-btn-label {
  font-weight: 600;
}

.type-btn-icon {
  font-size: 10px;
  line-height: 1;
}

.type-btn-label {
  font-size: var(--ae-font-xs);
  font-weight: 500;
}

.editor-area {
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-2);
}

.enum-select {
  min-width: 120px;
  max-width: 280px;
}

.switch-row {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
}

.switch-label {
  font-size: var(--ae-font-sm);
  color: var(--ae-text-secondary);
  min-width: 20px;
}

.selector-value-editor {
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-2);
}

.conditional-editor {
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-2);
  padding: var(--ae-space-2);
  background: var(--ae-bg-surface);
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-md);
}

.conditional-section {
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-1);
}

.conditional-label {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  font-weight: 500;
}

.array-editor {
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-2);
}

.array-item {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
}

.array-index {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  font-family: monospace;
  min-width: 16px;
}

.array-value-editor {
  flex: 1;
  min-width: 0;
}

.array-remove-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  font-size: var(--ae-font-sm);
  color: var(--ae-error);
  background: transparent;
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-sm);
  cursor: pointer;
  line-height: 1;
  padding: 0;
  flex-shrink: 0;
}

.array-remove-btn:hover {
  background: var(--ae-error-subtle);
  border-color: var(--ae-error);
}

.array-add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 10px;
  font-size: var(--ae-font-xs);
  color: var(--ae-text-secondary);
  background: var(--ae-bg-surface);
  border: 1px dashed var(--ae-border-default);
  border-radius: var(--ae-radius-sm);
  cursor: pointer;
}

.array-add-btn:hover {
  color: var(--ae-accent-primary);
  border-color: var(--ae-accent-primary);
  background: var(--ae-accent-primary-subtle);
}
</style>
