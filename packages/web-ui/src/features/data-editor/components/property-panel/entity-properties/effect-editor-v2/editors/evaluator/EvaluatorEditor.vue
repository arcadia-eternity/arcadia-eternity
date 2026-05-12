<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  EvaluatorDSL,
  EvaluatorDSLView,
  EffectDslFieldTypingRule,
  EffectDslStateConstraint,
} from '@arcadia-eternity/schema'
import DslNode from '../../DslNode.vue'
import { useNodeTyping } from '../../composables/useNodeTyping'
import { CATEGORY_TAG_COLORS } from '../../constants'

defineOptions({ name: 'EvaluatorEditor' })

const props = withDefaults(
  defineProps<{
    modelValue: EvaluatorDSL
    fieldRule?: EffectDslFieldTypingRule
    depth?: number
    maxDepth?: number
  }>(),
  { fieldRule: undefined, depth: 0, maxDepth: 6 },
)

const emit = defineEmits<{
  'update:modelValue': [value: EvaluatorDSL]
}>()

const nextDepth = computed(() => (props.depth ?? 0) + 1)

const typing = useNodeTyping()

// ── Evaluator type metadata ──────────────────────────────────────────────────

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

// ── Computed shortcuts ───────────────────────────────────────────────────────

const ev = computed(() => (props.modelValue ?? {}) as EvaluatorDSLView)
const evType = computed(() => (ev.value.type as string) ?? '')
const category = computed(() => categorizeEvaluator(evType.value))

const evaluatorOptions = computed(() => typing.resolveEvaluatorOptions(props.fieldRule))

// ── Value Rule Narrowing ──────────────────────────────────────────────────────
// For same/notSame/compare evaluators: pipeline narrows manifest — overlapping
// constraint kinds use the pipeline's narrower version (with specific targets/valueTypes).
// For probability/contain: pipeline is irrelevant — use manifest only.

function narrowValueRule(
  manifestRule: EffectDslFieldTypingRule,
  pipelineRule: EffectDslFieldTypingRule,
): EffectDslFieldTypingRule {
  const pipelineKinds = new Set(pipelineRule.allow.map(c => c.kind))
  const manifestOnly: EffectDslStateConstraint[] = manifestRule.allow.filter(c => !pipelineKinds.has(c.kind))
  return { allow: [...pipelineRule.allow, ...manifestOnly] }
}

// ── Field rule resolvers for child DslNodes ──────────────────────────────────

const valFieldRule = computed(() => {
  const manifestRule = typing.getFieldTyping('evaluator', evType.value, 'value', 'valueFields')
  if (!props.fieldRule) return manifestRule
  if (!manifestRule) return props.fieldRule

  // For same/notSame/compare: narrow manifest with pipeline constraints
  const narrowingCategories = new Set(['same', 'notSame', 'compare'])
  if (narrowingCategories.has(category.value)) {
    return narrowValueRule(manifestRule, props.fieldRule)
  }

  // For probability/contain/anyOf/exist: value type is independent of pipeline
  return manifestRule
})

const percentFieldRule = computed(() => typing.getFieldTyping('evaluator', evType.value, 'percent', 'valueFields'))

// ── Field updates ────────────────────────────────────────────────────────────

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

// ── Type picker ──────────────────────────────────────────────────────────────

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
</script>

<template>
  <div class="evaluator-node">
    <!-- ── Simple evaluator (compare, same, notSame, probability, anyOf, contain, exist) ── -->
    <div v-if="category !== 'children' && category !== 'singleChild'" class="evaluator-simple">
      <div class="evaluator-header">
        <span class="evaluator-type-tag" :style="{ backgroundColor: CATEGORY_TAG_COLORS[category] }">
          {{ evaluatorTypeLabel[evType] || evType }}
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
            <el-button size="small" text @click="showingPicker = false">取消</el-button>
          </div>
        </el-popover>
      </div>

      <div class="evaluator-fields">
        <!-- compare: operator + value -->
        <template v-if="category === 'compare'">
          <el-select
            :model-value="ev.operator"
            size="small"
            class="operator-select"
            @update:model-value="(v: string) => updateField('operator', v)"
          >
            <el-option v-for="opt in compareOperatorOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
          <DslNode
            kind="value"
            :model-value="ev.value"
            :field-rule="valFieldRule"
            @update:model-value="(v: unknown) => updateField('value', v)"
          />
        </template>

        <!-- same / notSame: value only -->
        <template v-else-if="category === 'same' || category === 'notSame'">
          <DslNode
            kind="value"
            :model-value="ev.value"
            :field-rule="valFieldRule"
            @update:model-value="(v: unknown) => updateField('value', v)"
          />
        </template>

        <!-- probability / anyOf: value field with dynamic field name -->
        <template v-else-if="category === 'value'">
          <DslNode
            v-if="evType === 'probability'"
            kind="value"
            :model-value="ev.percent"
            field-name="percent"
            :field-rule="percentFieldRule"
            @update:model-value="(v: unknown) => updateField('percent', v)"
          />
          <DslNode
            v-else
            kind="value"
            :model-value="ev.value"
            field-name="value"
            :field-rule="valFieldRule"
            @update:model-value="(v: unknown) => updateField('value', v)"
          />
        </template>

        <!-- contain: tag input -->
        <template v-else-if="category === 'input'">
          <el-input
            :model-value="(ev as { tag?: string }).tag"
            size="small"
            class="tag-input"
            placeholder="标签名"
            @update:model-value="(v: string) => updateField('tag', v)"
          />
        </template>

        <!-- exist: no params -->
        <template v-else-if="category === 'leaf'">
          <span class="field-hint">无额外参数</span>
        </template>
      </div>
    </div>

    <!-- ── Compound children evaluator (any / all) ── -->
    <div v-if="category === 'children'" class="evaluator-compound">
      <div class="evaluator-header">
        <span class="evaluator-type-tag" :style="{ backgroundColor: CATEGORY_TAG_COLORS[category] }">
          {{ evaluatorTypeLabel[evType] || evType }}
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
            <el-button size="small" text @click="showingPicker = false">取消</el-button>
          </div>
        </el-popover>
      </div>

      <div class="evaluator-children">
        <div
          v-for="(child, index) in (ev as { conditions: EvaluatorDSL[] }).conditions"
          :key="index"
          class="evaluator-child-item"
        >
          <span class="child-connector">├</span>
          <DslNode
            kind="evaluator"
            :model-value="child"
            :depth="nextDepth"
            :max-depth="maxDepth"
            @update:model-value="(v: unknown) => updateChildCondition(Number(index), v as EvaluatorDSL)"
          />
          <el-button size="small" text class="child-delete-btn" @click="updateChildCondition(Number(index), undefined)">
            ✕
          </el-button>
        </div>
        <el-button size="small" text class="child-add-btn" @click="addChildCondition">+ 子条件</el-button>
      </div>
    </div>

    <!-- ── Single-child evaluator (not) ── -->
    <div v-if="category === 'singleChild'" class="evaluator-compound">
      <div class="evaluator-header">
        <span class="evaluator-type-tag" :style="{ backgroundColor: CATEGORY_TAG_COLORS[category] }">
          {{ evaluatorTypeLabel[evType] || evType }}
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
            <el-button size="small" text @click="showingPicker = false">取消</el-button>
          </div>
        </el-popover>
      </div>

      <div class="evaluator-children">
        <div class="evaluator-child-item">
          <span class="child-connector">├</span>
          <DslNode
            kind="evaluator"
            :model-value="(ev as { condition: EvaluatorDSL }).condition"
            :depth="nextDepth"
            :max-depth="maxDepth"
            @update:model-value="(v: unknown) => updateInnerChild(v as EvaluatorDSL)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

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
