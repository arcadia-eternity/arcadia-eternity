<script setup lang="ts">
import { computed } from 'vue'
import type { Value, ValueView, ConditionDSL, SelectorDSL, SelectorChain } from '@arcadia-eternity/schema'
import { useGameDataStore } from '@/stores/gameData'

const props = withDefaults(
  defineProps<{
    modelValue: Value
    allowedTypes?: string[]
    label?: string
    maxDepth?: number
    depth?: number
  }>(),
  { allowedTypes: undefined, label: undefined, maxDepth: 4, depth: 0 },
)

const emit = defineEmits<{ 'update:modelValue': [value: Value] }>()

defineSlots<{
  default(props: { modelValue: Value; update: (v: Value) => void }): unknown
  selector(props: { modelValue: SelectorDSL; update: (v: SelectorDSL) => void }): unknown
  chain(props: { modelValue: SelectorChain[]; onUpdate: (v: SelectorChain[]) => void }): unknown
  condition(props: { modelValue: ConditionDSL; onUpdate: (v: ConditionDSL) => void }): unknown
  operator(props: { modelValue: Value }): unknown
}>()

const gameData = useGameDataStore()

const TYPE_BUTTONS = [
  { key: 'raw:number', label: '数值', icon: '🔢' },
  { key: 'raw:string', label: '文本', icon: '📝' },
  { key: 'raw:boolean', label: '布尔', icon: '✓' },
  { key: 'entity:baseMark', label: '标记', icon: '🏷️' },
  { key: 'entity:baseSkill', label: '技能', icon: '⚔️' },
  { key: 'entity:species', label: '物种', icon: '🧬' },
  { key: 'entity:effect', label: '效果', icon: '✨' },
  { key: 'dynamic', label: '动态值', icon: '🔄' },
  { key: 'selectorValue', label: '管道值', icon: '⛓️' },
  { key: 'conditional', label: '条件值', icon: '🔀' },
  { key: 'array', label: '数组', icon: '📋' },
  { key: 'operator', label: '操作符', icon: '⚙️' },
] as const

function inferType(value: Value): string {
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
  if (value && typeof value === 'object' && value.type) return value.type
  return 'raw:number'
}

const currentType = computed(() => inferType(props.modelValue))

const filteredTypes = computed(() => {
  if (!props.allowedTypes || props.allowedTypes.length === 0) return TYPE_BUTTONS
  const allowed = new Set(props.allowedTypes)
  return TYPE_BUTTONS.filter(b => allowed.has(b.key))
})

const isObjectValue = computed(() => {
  const v = props.modelValue
  return v && typeof v === 'object' && (v as Record<string, unknown>).type
})

const isBarePrimitive = computed(() => {
  const v = props.modelValue
  const ct = currentType.value
  return (
    (ct === 'raw:number' || ct === 'raw:string' || ct === 'raw:boolean') &&
    (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')
  )
})

const typedValue = computed(() => {
  const v = props.modelValue as Record<string, unknown>
  if (!v || typeof v !== 'object' || !v.type) return null
  return v as unknown as ValueView
})

const safeString = computed(() => {
  const v = typedValue.value?.value
  return typeof v === 'string' ? v : ''
})

const safeNumber = computed(() => {
  const v = typedValue.value?.value
  return typeof v === 'number' ? v : 0
})

const safeBoolean = computed(() => {
  const v = typedValue.value?.value
  return typeof v === 'boolean' ? v : false
})

const typedConfigId = computed(() => {
  const v = typedValue.value?.configId
  return typeof v === 'string' ? v : ''
})

const typedTags = computed(() => {
  const v = typedValue.value?.tags
  return Array.isArray(v) ? v.join(', ') : ''
})

const marksOptions = computed(() =>
  gameData.marks.allIds.filter(id => id.startsWith('mark_')).map(id => ({ value: id, label: id })),
)

const skillsOptions = computed(() =>
  gameData.skills.allIds.filter(id => id.startsWith('skill_')).map(id => ({ value: id, label: id })),
)

const speciesOptions = computed(() => gameData.species.allIds.map(id => ({ value: id, label: id })))

const effectsOptions = computed(() => gameData.effects.allIds.map(id => ({ value: id, label: id })))

function emitStructured(type: string, partial: Record<string, unknown>) {
  emit('update:modelValue', { type, ...partial } as Value)
}

function emitBarePrimitive(type: string, value: Value) {
  if (type === 'raw:number') emit('update:modelValue', Number(value))
  else if (type === 'raw:boolean') emit('update:modelValue', Boolean(value))
  else emit('update:modelValue', String(value ?? ''))
}

function emitRawNumber(value: number, configId?: string, tags?: string[]) {
  if (isObjectValue.value) {
    emitStructured('raw:number', { value, configId, tags })
  } else {
    emitBarePrimitive('raw:number', value)
  }
}

function emitRawString(value: string, configId?: string, tags?: string[]) {
  if (isObjectValue.value) {
    emitStructured('raw:string', { value, configId, tags })
  } else {
    emitBarePrimitive('raw:string', value)
  }
}

function emitRawBoolean(value: boolean, configId?: string, tags?: string[]) {
  if (isObjectValue.value) {
    emitStructured('raw:boolean', { value, configId, tags })
  } else {
    emitBarePrimitive('raw:boolean', value)
  }
}

function switchType(typeKey: string) {
  const defaults: Record<string, Value> = {
    'raw:number': 0,
    'raw:string': '',
    'raw:boolean': false,
    'entity:baseMark': { type: 'entity:baseMark', value: '' },
    'entity:baseSkill': { type: 'entity:baseSkill', value: '' },
    'entity:species': { type: 'entity:species', value: '' },
    'entity:effect': { type: 'entity:effect', value: '' },
    dynamic: { type: 'dynamic', selector: '' } as unknown as Value,
    selectorValue: { type: 'selectorValue', value: 0 } as unknown as Value,
    conditional: { type: 'conditional', condition: '', trueValue: 0, falseValue: 0 } as unknown as Value,
    array: [] as unknown as Value,
    operator: { type: 'operator' } as unknown as Value,
  }
  emit('update:modelValue', defaults[typeKey] ?? 0)
}

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
</script>

<template>
  <div class="value-editor" :class="{ 'value-editor--indent': props.depth > 0 }">
    <label v-if="label" class="value-label">{{ label }}</label>
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
    <div class="editor-area">
      <template v-if="currentType === 'raw:number'">
        <div class="editor-row">
          <el-input-number
            :model-value="isBarePrimitive ? (modelValue as unknown as number) : safeNumber"
            @update:model-value="
              (v: number | undefined) =>
                emitRawNumber(
                  v ?? 0,
                  typedConfigId,
                  typedTags
                    ? typedTags
                        .split(',')
                        .map((s: string) => s.trim())
                        .filter(Boolean)
                    : undefined,
                )
            "
          />
          <template v-if="isObjectValue">
            <el-input
              :model-value="typedConfigId"
              placeholder="configId"
              class="config-input"
              @update:model-value="
                (v: string) => emitRawNumber(safeNumber, v || undefined, typedValue?.tags as string[] | undefined)
              "
            />
            <el-input
              :model-value="typedTags"
              placeholder="tags (逗号分隔)"
              class="config-input"
              @update:model-value="
                (v: string) =>
                  emitRawNumber(
                    safeNumber,
                    typedConfigId || undefined,
                    v
                      ? v
                          .split(',')
                          .map((s: string) => s.trim())
                          .filter(Boolean)
                      : undefined,
                  )
              "
            />
          </template>
        </div>
      </template>
      <template v-else-if="currentType === 'raw:string'">
        <div class="editor-row">
          <el-input
            :model-value="isBarePrimitive ? (modelValue as unknown as string) : safeString"
            @update:model-value="
              (v: string) =>
                emitRawString(
                  v,
                  typedConfigId,
                  typedTags
                    ? typedTags
                        .split(',')
                        .map((s: string) => s.trim())
                        .filter(Boolean)
                    : undefined,
                )
            "
          />
          <template v-if="isObjectValue">
            <el-input
              :model-value="typedConfigId"
              placeholder="configId"
              class="config-input"
              @update:model-value="
                (v: string) => emitRawString(safeString, v || undefined, typedValue?.tags as string[] | undefined)
              "
            />
            <el-input
              :model-value="typedTags"
              placeholder="tags (逗号分隔)"
              class="config-input"
              @update:model-value="
                (v: string) =>
                  emitRawString(
                    safeString,
                    typedConfigId || undefined,
                    v
                      ? v
                          .split(',')
                          .map((s: string) => s.trim())
                          .filter(Boolean)
                      : undefined,
                  )
              "
            />
          </template>
        </div>
      </template>
      <template v-else-if="currentType === 'raw:boolean'">
        <div class="editor-row">
          <div class="switch-row">
            <span class="switch-label">{{ (isBarePrimitive ? modelValue : safeBoolean) ? '是' : '否' }}</span>
            <el-switch
              :model-value="isBarePrimitive ? (modelValue as unknown as boolean) : safeBoolean"
              @update:model-value="
                (v: string | number | boolean) =>
                  emitRawBoolean(
                    !!v,
                    typedConfigId,
                    typedTags
                      ? typedTags
                          .split(',')
                          .map((s: string) => s.trim())
                          .filter(Boolean)
                      : undefined,
                  )
              "
            />
          </div>
          <template v-if="isObjectValue">
            <el-input
              :model-value="typedConfigId"
              placeholder="configId"
              class="config-input"
              @update:model-value="
                (v: string) => emitRawBoolean(safeBoolean, v || undefined, typedValue?.tags as string[] | undefined)
              "
            />
            <el-input
              :model-value="typedTags"
              placeholder="tags (逗号分隔)"
              class="config-input"
              @update:model-value="
                (v: string) =>
                  emitRawBoolean(
                    safeBoolean,
                    typedConfigId || undefined,
                    v
                      ? v
                          .split(',')
                          .map((s: string) => s.trim())
                          .filter(Boolean)
                      : undefined,
                  )
              "
            />
          </template>
        </div>
      </template>
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
      <template v-else-if="currentType === 'dynamic'">
        <div class="editor-row">
          <slot
            name="selector"
            :model-value="typedValue?.selector!"
            :update="(v: SelectorDSL) => emitStructured('dynamic', { selector: v })"
          >
            <div class="slot-fallback">
              <span class="fallback-text">{{
                typeof typedValue?.selector === 'object' ? '(SelectorPipeline)' : (typedValue?.selector ?? '(空)')
              }}</span>
            </div>
          </slot>
        </div>
      </template>
      <template v-else-if="currentType === 'selectorValue'">
        <div class="selector-value-editor">
          <ValueEditor
            v-if="props.depth < props.maxDepth"
            :model-value="typedValue?.value ?? 0"
            :allowed-types="props.allowedTypes"
            :max-depth="props.maxDepth"
            :depth="props.depth + 1"
            @update:model-value="v => emitStructured('selectorValue', { value: v as number, chain: typedValue?.chain })"
          />
          <slot
            name="chain"
            :model-value="typedValue?.chain!"
            :on-update="
              (v: SelectorChain[]) =>
                emitStructured('selectorValue', {
                  value: (typedValue?.value as number) ?? 0,
                  chain: v as SelectorChain[],
                })
            "
          />
        </div>
      </template>
      <template v-else-if="currentType === 'conditional'">
        <div class="conditional-editor">
          <div class="conditional-section">
            <label class="conditional-label">条件</label>
            <slot
              name="condition"
              :model-value="typedValue?.condition!"
              :on-update="
                v =>
                  emitStructured('conditional', {
                    condition: v as ConditionDSL,
                    trueValue: typedValue?.trueValue ?? 0,
                    falseValue: typedValue?.falseValue ?? 0,
                  })
              "
            >
              <span class="fallback-text">{{
                typeof typedValue?.condition === 'object' ? '(ConditionTree)' : (typedValue?.condition ?? '(空)')
              }}</span>
            </slot>
          </div>
          <div class="conditional-section">
            <label class="conditional-label">真值</label>
            <ValueEditor
              v-if="props.depth < props.maxDepth"
              :model-value="typedValue?.trueValue ?? 0"
              :allowed-types="props.allowedTypes"
              :max-depth="props.maxDepth"
              :depth="props.depth + 1"
              @update:model-value="
                v =>
                  emitStructured('conditional', {
                    condition: typedValue?.condition,
                    trueValue: v as Value,
                    falseValue: typedValue?.falseValue,
                  })
              "
            />
          </div>
          <div class="conditional-section">
            <label class="conditional-label">假值</label>
            <ValueEditor
              v-if="props.depth < props.maxDepth"
              :model-value="typedValue?.falseValue ?? 0"
              :allowed-types="props.allowedTypes"
              :max-depth="props.maxDepth"
              :depth="props.depth + 1"
              @update:model-value="
                v =>
                  emitStructured('conditional', {
                    condition: typedValue?.condition,
                    trueValue: typedValue?.trueValue,
                    falseValue: v as Value,
                  })
              "
            />
          </div>
        </div>
      </template>
      <template v-else-if="currentType === 'array'">
        <div class="array-editor">
          <div v-for="(item, index) in Array.isArray(modelValue) ? modelValue : []" :key="index" class="array-item">
            <span class="array-index">{{ index }}</span>
            <ValueEditor
              v-if="props.depth < props.maxDepth"
              :model-value="item"
              :allowed-types="props.allowedTypes"
              :max-depth="props.maxDepth"
              :depth="props.depth + 1"
              class="array-value-editor"
              @update:model-value="v => updateArrayItem(index, v as Value)"
            />
            <button class="array-remove-btn" @click="removeArrayItem(index)">×</button>
          </div>
          <button class="array-add-btn" @click="addArrayItem">+ 添加元素</button>
        </div>
      </template>
      <template v-else-if="currentType === 'operator'">
        <slot name="operator" :model-value="modelValue" />
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

.editor-row {
  display: flex;
  gap: var(--ae-space-2);
  align-items: center;
  flex-wrap: wrap;
}

.config-input {
  width: 120px;
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
