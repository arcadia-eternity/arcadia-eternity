<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EvaluatorDSL, EvaluatorDSLView, Value } from '@arcadia-eternity/schema'
import { useEffectTyping } from '../composables/useEffectTyping'
import { CATEGORY_TAG_COLORS } from '../constants'

const { resolveEvaluatorOptions } = useEffectTyping()

const evaluatorOptions = computed(() => resolveEvaluatorOptions())

const props = defineProps<{
  modelValue: EvaluatorDSL
}>()

const emit = defineEmits<{
  'update:modelValue': [value: EvaluatorDSL]
}>()

defineSlots<{
  value(props: { modelValue: Value; update: (v: Value) => void; field?: string }): unknown
}>()

type EvaluatorCategory = 'compare' | 'same' | 'notSame' | 'value' | 'children' | 'singleChild' | 'input' | 'leaf'

function categorizeEvaluator(type: string): EvaluatorCategory {
  switch (type) {
    case 'compare':
      return 'compare'
    case 'same':
      return 'same'
    case 'notSame':
      return 'notSame'
    case 'probability':
    case 'anyOf':
      return 'value'
    case 'any':
    case 'all':
      return 'children'
    case 'not':
      return 'singleChild'
    case 'contain':
      return 'input'
    case 'exist':
      return 'leaf'
    default:
      return 'leaf'
  }
}

const evaluatorTypeLabel: Record<string, string> = {
  compare: '比较',
  same: '相同',
  notSame: '不同',
  any: '任一',
  all: '全部',
  not: '取反',
  probability: '概率',
  contain: '包含标签',
  exist: '存在',
  anyOf: '值匹配',
}

const compareOperatorOptions = [
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '>=' },
  { value: '<=', label: '<=' },
  { value: '==', label: '==' },
]

function emitUpdate(val: EvaluatorDSL) {
  emit('update:modelValue', val)
}

function updateField<K extends string>(field: K, value: unknown) {
  emitUpdate({ ...props.modelValue, [field]: value } as EvaluatorDSL)
}

function updateChildCondition(index: number, child: EvaluatorDSL | undefined) {
  const cond = props.modelValue as { conditions: EvaluatorDSL[] }
  const children = [...(cond.conditions || [])]
  if (child === undefined) {
    children.splice(index, 1)
  } else {
    children[index] = child
  }
  emitUpdate({ ...cond, conditions: children } as EvaluatorDSL)
}

function addChildCondition() {
  const cond = props.modelValue as { conditions: EvaluatorDSL[] }
  const children = [...(cond.conditions || [])]
  children.push({ type: 'exist' })
  emitUpdate({ ...cond, conditions: children } as EvaluatorDSL)
}

function updateInnerChild(child: EvaluatorDSL | undefined) {
  if (!child) return
  emitUpdate({ ...props.modelValue, condition: child } as EvaluatorDSL)
}

const showingPicker = ref(false)
const pickerType = ref('')

function changeType() {
  if (!pickerType.value) {
    showingPicker.value = false
    return
  }
  const cat = categorizeEvaluator(pickerType.value)
  let evaluator: EvaluatorDSL

  switch (cat) {
    case 'compare':
      evaluator = { type: 'compare', operator: '==', value: { type: 'raw:number', value: 0 } }
      break
    case 'same':
      evaluator = { type: pickerType.value as 'same' | 'notSame', value: { type: 'raw:number', value: 0 } }
      break
    case 'notSame':
      evaluator = { type: pickerType.value as 'same' | 'notSame', value: { type: 'raw:number', value: 0 } }
      break
    case 'value':
      if (pickerType.value === 'probability') {
        evaluator = { type: 'probability', percent: { type: 'raw:number', value: 50 } }
      } else if (pickerType.value === 'anyOf') {
        evaluator = { type: 'anyOf', value: { type: 'raw:string', value: '' } }
      } else {
        evaluator = {
          type: pickerType.value as EvaluatorDSL['type'],
          value: { type: 'raw:number', value: 0 },
        } as EvaluatorDSL
      }
      break
    case 'children':
      evaluator = { type: pickerType.value as 'any' | 'all', conditions: [] }
      break
    case 'singleChild':
      evaluator = { type: 'not', condition: { type: 'exist' } }
      break
    case 'input':
      evaluator = { type: 'contain', tag: '' }
      break
    case 'leaf':
    default:
      evaluator = { type: 'exist' }
  }

  showingPicker.value = false
  pickerType.value = ''
  emitUpdate(evaluator)
}

const evaluator = computed(() => props.modelValue)
const e = computed(() => (evaluator.value ?? {}) as EvaluatorDSLView)
const category = computed(() => categorizeEvaluator(evaluator.value.type))
</script>

<template>
  <div class="evaluator-node">
    <div class="evaluator-simple" v-if="category !== 'children' && category !== 'singleChild'">
      <div class="evaluator-header">
        <span class="evaluator-type-tag" :style="{ backgroundColor: CATEGORY_TAG_COLORS[category] }">
          {{ evaluatorTypeLabel[e.type as string] || (e.type as string) }}
        </span>

        <el-popover :visible="showingPicker" placement="bottom-start" :width="200" trigger="click">
          <template #reference>
            <el-button size="small" text class="evaluator-type-switch-btn" @click="showingPicker = !showingPicker">
              ⇄
            </el-button>
          </template>
          <div class="type-switch-inner">
            <el-select
              v-model="pickerType"
              placeholder="切换类型..."
              size="small"
              class="type-select"
              @change="changeType"
            >
              <el-option
                v-for="opt in evaluatorOptions"
                :key="opt"
                :label="evaluatorTypeLabel[opt] || opt"
                :value="opt"
              />
            </el-select>
            <el-button size="small" text @click="showingPicker = false"> 取消 </el-button>
          </div>
        </el-popover>
      </div>

      <div class="evaluator-fields">
        <template v-if="category === 'compare'">
          <el-select
            :model-value="e.operator"
            size="small"
            class="operator-select"
            @update:model-value="(v: string) => updateField('operator', v)"
          >
            <el-option v-for="opt in compareOperatorOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
          <slot
            name="value"
            :model-value="e.value as Value"
            :field="'value'"
            :update="(v: unknown) => updateField('value', v as Value)"
          />
        </template>

        <template v-else-if="category === 'same' || category === 'notSame'">
          <slot
            name="value"
            :model-value="e.value as Value"
            :field="'value'"
            :update="(v: unknown) => updateField('value', v as Value)"
          />
        </template>

        <template v-else-if="category === 'value'">
          <slot
            name="value"
            :model-value="e.percent ?? e.value"
            :field="e.type === 'probability' ? 'percent' : 'value'"
            :update="(v: unknown) => updateField(e.type === 'probability' ? 'percent' : 'value', v as Value)"
          />
        </template>

        <template v-else-if="category === 'input'">
          <el-input
            :model-value="e.tag"
            size="small"
            class="tag-input"
            placeholder="标签名"
            @update:model-value="(v: string) => updateField('tag', v)"
          />
        </template>

        <template v-else-if="category === 'leaf'">
          <span class="field-hint">无额外参数</span>
        </template>
      </div>
    </div>

    <div v-if="category === 'children'" class="evaluator-compound">
      <div class="evaluator-header">
        <span class="evaluator-type-tag" :style="{ backgroundColor: CATEGORY_TAG_COLORS[category] }">
          {{ evaluatorTypeLabel[e.type as string] || (e.type as string) }}
        </span>

        <el-popover :visible="showingPicker" placement="bottom-start" :width="200" trigger="click">
          <template #reference>
            <el-button size="small" text class="evaluator-type-switch-btn" @click="showingPicker = !showingPicker">
              ⇄
            </el-button>
          </template>
          <div class="type-switch-inner">
            <el-select
              v-model="pickerType"
              placeholder="切换类型..."
              size="small"
              class="type-select"
              @change="changeType"
            >
              <el-option
                v-for="opt in evaluatorOptions"
                :key="opt"
                :label="evaluatorTypeLabel[opt] || opt"
                :value="opt"
              />
            </el-select>
            <el-button size="small" text @click="showingPicker = false"> 取消 </el-button>
          </div>
        </el-popover>
      </div>

      <div class="evaluator-children">
        <div v-for="(child, index) in e.conditions" :key="index" class="evaluator-child-item">
          <span class="child-connector">├</span>
          <EvaluatorEditor
            :model-value="child"
            @update:model-value="(v: EvaluatorDSL) => updateChildCondition(Number(index), v)"
          >
            <template #value="slotProps: { modelValue: Value; update: (v: Value) => void; field?: string }">
              <slot
                name="value"
                :model-value="slotProps.modelValue"
                :update="slotProps.update"
                :field="slotProps.field"
              />
            </template>
          </EvaluatorEditor>
          <el-button size="small" text class="child-delete-btn" @click="updateChildCondition(Number(index), undefined)">
            ✕
          </el-button>
        </div>
        <el-button size="small" text class="child-add-btn" @click="addChildCondition"> + 子条件 </el-button>
      </div>
    </div>

    <div v-if="category === 'singleChild'" class="evaluator-compound">
      <div class="evaluator-header">
        <span class="evaluator-type-tag" :style="{ backgroundColor: CATEGORY_TAG_COLORS[category] }">
          {{ evaluatorTypeLabel[e.type as string] || (e.type as string) }}
        </span>

        <el-popover :visible="showingPicker" placement="bottom-start" :width="200" trigger="click">
          <template #reference>
            <el-button size="small" text class="evaluator-type-switch-btn" @click="showingPicker = !showingPicker">
              ⇄
            </el-button>
          </template>
          <div class="type-switch-inner">
            <el-select
              v-model="pickerType"
              placeholder="切换类型..."
              size="small"
              class="type-select"
              @change="changeType"
            >
              <el-option
                v-for="opt in evaluatorOptions"
                :key="opt"
                :label="evaluatorTypeLabel[opt] || opt"
                :value="opt"
              />
            </el-select>
            <el-button size="small" text @click="showingPicker = false"> 取消 </el-button>
          </div>
        </el-popover>
      </div>

      <div class="evaluator-children">
        <div class="evaluator-child-item">
          <span class="child-connector">├</span>
          <EvaluatorEditor :model-value="e.condition" @update:model-value="(v: EvaluatorDSL) => updateInnerChild(v)">
            <template #value="slotProps: { modelValue: Value; update: (v: Value) => void; field?: string }">
              <slot
                name="value"
                :model-value="slotProps.modelValue"
                :update="slotProps.update"
                :field="slotProps.field"
              />
            </template>
          </EvaluatorEditor>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
export default { name: 'EvaluatorEditor' }
</script>

<style scoped>
.evaluator-node {
  font-size: var(--ae-font-sm);
}

.evaluator-simple {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-sm);
  padding: var(--ae-space-1) var(--ae-space-2);
  background-color: var(--ae-bg-surface);
}

.evaluator-header {
  display: flex;
  align-items: center;
  gap: var(--ae-space-1);
  flex-shrink: 0;
}

.evaluator-type-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: var(--ae-font-xs);
  font-weight: 600;
  color: var(--ae-text-primary);
  white-space: nowrap;
}

.evaluator-type-switch-btn {
  color: var(--ae-text-muted) !important;
  padding: 0 !important;
  min-height: unset !important;
  font-size: var(--ae-font-xs) !important;
}

.evaluator-fields {
  display: flex;
  align-items: center;
  gap: var(--ae-space-1);
  flex: 1;
  min-width: 0;
}

.operator-select {
  width: 72px;
}

.tag-input {
  width: 120px;
}

.field-hint {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-disabled);
  font-style: italic;
}

.evaluator-compound {
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-sm);
  background-color: var(--ae-bg-elevated);
  overflow: hidden;
}

.evaluator-compound .evaluator-header {
  padding: var(--ae-space-1) var(--ae-space-2);
  border-bottom: 1px solid var(--ae-border-subtle);
  background-color: var(--ae-bg-surface);
  width: 100%;
  justify-content: space-between;
}

.evaluator-children {
  padding: var(--ae-space-2);
  padding-left: var(--ae-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-1);
}

.evaluator-child-item {
  display: flex;
  align-items: center;
  gap: var(--ae-space-1);
}

.child-connector {
  color: var(--ae-border-default);
  font-family: monospace;
  font-size: var(--ae-font-sm);
  flex-shrink: 0;
}

.child-delete-btn {
  color: var(--ae-error) !important;
  padding: 0 !important;
  min-height: unset !important;
  font-size: var(--ae-font-xs) !important;
}

.child-add-btn {
  color: var(--ae-accent-primary) !important;
  font-size: var(--ae-font-xs) !important;
  padding: 0 !important;
  min-height: unset !important;
  align-self: flex-start;
}

.type-switch-inner {
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-2);
}

.type-switch-inner .type-select {
  width: 100%;
}
</style>
