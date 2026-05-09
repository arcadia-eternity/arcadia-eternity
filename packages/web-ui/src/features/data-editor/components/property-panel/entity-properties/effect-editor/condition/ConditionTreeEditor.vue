<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ConditionDSL, ConditionDSLView, EvaluatorDSL, SelectorDSL, Value } from '@arcadia-eternity/schema'
import type { ContinuousUseSkillStrategy } from '@arcadia-eternity/const'
import { useEffectTyping } from '../composables/useEffectTyping'
import { CATEGORY_TAG_COLORS } from '../constants'

const props = withDefaults(
  defineProps<{
    modelValue: ConditionDSL | undefined
    label?: string
  }>(),
  {
    label: undefined,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: ConditionDSL | undefined]
}>()

defineSlots<{
  selector(props: { modelValue: SelectorDSL; update: (v: SelectorDSL) => void }): unknown
  value(props: { modelValue: Value; update: (v: Value) => void }): unknown
  condition(props: {
    modelValue: ConditionDSL | EvaluatorDSL
    update: (v: ConditionDSL | EvaluatorDSL) => void
  }): unknown
}>()

const { resolveConditionOptions } = useEffectTyping()
const conditionOptions = computed(() => resolveConditionOptions())

const showingTypePicker = ref(false)
const newType = ref('')

type ConditionCategory =
  | 'leaf'
  | 'evaluate'
  | 'value'
  | 'continuousUseSkill'
  | 'skillSequence'
  | 'statStageChange'
  | 'probability'
  | 'children'
  | 'singleChild'

const leaves = new Set([
  'petIsActive',
  'checkSelf',
  'selfUseSkill',
  'opponentUseSkill',
  'selfBeDamaged',
  'opponentBeDamaged',
  'selfAddMark',
  'opponentAddMark',
  'selfBeAddMark',
  'opponentBeAddMark',
  'selfBeHeal',
  'selfSwitchIn',
  'selfSwitchOut',
  'selfBeSkillTarget',
  'isFirstSkillUsedThisTurn',
  'isLastSkillUsedThisTurn',
])

function categorizeCondition(type: string): ConditionCategory {
  if (leaves.has(type)) return 'leaf'
  if (type === 'evaluate') return 'evaluate'
  if (type === 'selfHasMark' || type === 'opponentHasMark') return 'value'
  if (type === 'continuousUseSkill') return 'continuousUseSkill'
  if (type === 'skillSequence') return 'skillSequence'
  if (type === 'statStageChange') return 'statStageChange'
  if (type === 'probability') return 'probability'
  if (type === 'every' || type === 'some') return 'children'
  if (type === 'not') return 'singleChild'
  return 'leaf'
}

const conditionTypeLabel: Record<string, string> = {
  evaluate: '条件评估',
  every: '全部满足',
  some: '任一满足',
  not: '取反',
  petIsActive: '宠物存活',
  checkSelf: '检查自身',
  selfUseSkill: '自身使用技能',
  opponentUseSkill: '对手使用技能',
  selfBeDamaged: '自身受到伤害',
  opponentBeDamaged: '对手受到伤害',
  selfAddMark: '自身添加标记',
  opponentAddMark: '对手添加标记',
  selfBeAddMark: '自身被添加标记',
  opponentBeAddMark: '对手被添加标记',
  selfBeHeal: '自身受到治疗',
  selfSwitchIn: '自身上场',
  selfSwitchOut: '自身下场',
  selfBeSkillTarget: '自身成为技能目标',
  isFirstSkillUsedThisTurn: '本回合首次使用技能',
  isLastSkillUsedThisTurn: '本回合最后使用技能',
  selfHasMark: '自身持有标记',
  opponentHasMark: '对手持有标记',
  continuousUseSkill: '连续使用技能',
  skillSequence: '技能序列',
  statStageChange: '能力等级变化',
  probability: '概率判定',
}

const continuousUseStrategyOptions = [
  { value: 'Periodic', label: '周期性' },
  { value: 'Once', label: '仅一次' },
  { value: 'Continuous', label: '持续触发' },
]

const skillSequenceModeOptions = [
  { value: 'exact', label: '精确匹配' },
  { value: 'inOrder', label: '按顺序' },
  { value: 'withGap', label: '允许间隔' },
]

const skillSequenceSourceOptions = [
  { value: 'self', label: '自身' },
  { value: 'opponent', label: '对手' },
]

const statCheckOptions = [
  { value: 'up', label: '上升' },
  { value: 'down', label: '下降' },
  { value: 'all', label: '任意' },
]

function emitUpdate(val: ConditionDSL | undefined) {
  emit('update:modelValue', val)
}

function addCondition() {
  if (!newType.value) return
  const cat = categorizeCondition(newType.value)
  let condition: ConditionDSL

  switch (cat) {
    case 'children':
      condition = { type: newType.value as 'every' | 'some', conditions: [] }
      break
    case 'singleChild':
      condition = { type: 'not', condition: { type: 'petIsActive' } }
      break
    case 'evaluate':
      condition = { type: 'evaluate', target: 'self', evaluator: { type: 'exist' } }
      break
    case 'value':
      condition = {
        type: newType.value as 'selfHasMark' | 'opponentHasMark',
        baseId: { type: 'raw:string', value: '' },
      }
      break
    case 'continuousUseSkill':
      condition = {
        type: 'continuousUseSkill',
        times: { type: 'raw:number', value: 1 },
        strategy: 'Periodic' as ContinuousUseSkillStrategy,
      }
      break
    case 'skillSequence':
      condition = { type: 'skillSequence', sequence: { type: 'raw:string', value: '' }, mode: 'exact', source: 'self' }
      break
    case 'statStageChange':
      condition = { type: 'statStageChange', stat: { type: 'raw:string', value: 'atk' }, check: 'up' }
      break
    case 'probability':
      condition = {
        type: 'evaluate',
        target: 'self',
        evaluator: { type: 'probability', percent: { type: 'raw:number', value: 50 } },
      }
      break
    default:
      condition = { type: newType.value } as ConditionDSL
  }

  showingTypePicker.value = false
  newType.value = ''
  emitUpdate(condition)
}

function deleteCondition() {
  emitUpdate(undefined)
}

function updateField<K extends string>(field: K, value: unknown) {
  if (!props.modelValue) return
  const updated = { ...props.modelValue, [field]: value }
  emitUpdate(updated)
}

function addChildCondition() {
  if (!props.modelValue) return
  const cond = props.modelValue as { conditions: ConditionDSL[] }
  const children = [...(cond.conditions || [])]
  children.push({ type: 'petIsActive' })
  emitUpdate({ ...cond, conditions: children } as ConditionDSL)
}

function updateChildCondition(index: number, child: ConditionDSL | undefined) {
  if (!props.modelValue) return
  const cond = props.modelValue as { conditions: ConditionDSL[] }
  const children = [...(cond.conditions || [])]
  if (child === undefined) {
    children.splice(index, 1)
  } else {
    children[index] = child
  }
  emitUpdate({ ...cond, conditions: children } as ConditionDSL)
}

function moveChildUp(index: number) {
  if (!props.modelValue || index <= 0) return
  const cond = props.modelValue as { conditions: ConditionDSL[] }
  const children = [...(cond.conditions || [])]
  const temp = children[index]
  children[index] = children[index - 1]
  children[index - 1] = temp
  emitUpdate({ ...cond, conditions: children } as ConditionDSL)
}

function moveChildDown(index: number) {
  if (!props.modelValue) return
  const cond = props.modelValue as { conditions: ConditionDSL[] }
  const children = cond.conditions || []
  if (index >= children.length - 1) return
  const swapped = [...children]
  const temp = swapped[index]
  swapped[index] = swapped[index + 1]
  swapped[index + 1] = temp
  emitUpdate({ ...cond, conditions: swapped } as ConditionDSL)
}

function updateChildConditionInner(child: ConditionDSL | undefined) {
  if (!props.modelValue) return
  if (child === undefined) return
  const updated = { ...props.modelValue, condition: child } as ConditionDSL
  emitUpdate(updated)
}

function emitEvaluatorUpdate(evaluator: EvaluatorDSL) {
  if (!props.modelValue) return
  const cond = props.modelValue as { evaluator: EvaluatorDSL }
  const updated = { ...cond, evaluator } as ConditionDSL
  emitUpdate(updated)
}

function emitSelectorUpdate(selector: SelectorDSL) {
  if (!props.modelValue) return
  const cond = props.modelValue as { target: SelectorDSL }
  const updated = { ...cond, target: selector } as ConditionDSL
  emitUpdate(updated)
}

const condition = computed(() => props.modelValue)
const c = computed(() => (condition.value ?? {}) as ConditionDSLView)
const category = computed(() => (condition.value ? categorizeCondition(condition.value.type) : null))
</script>

<template>
  <div class="condition-tree-node">
    <div v-if="!condition" class="condition-empty">
      <span class="condition-empty-label">无条件</span>
      <el-button v-if="!showingTypePicker" size="small" type="primary" plain @click="showingTypePicker = true">
        + 添加条件
      </el-button>
      <div v-if="showingTypePicker" class="condition-type-picker">
        <el-select
          v-model="newType"
          placeholder="选择条件类型..."
          size="small"
          class="type-select"
          @change="addCondition"
        >
          <el-option v-for="opt in conditionOptions" :key="opt" :label="conditionTypeLabel[opt] || opt" :value="opt" />
          <el-option label="概率判定" value="probability" />
        </el-select>
        <el-button size="small" text @click="showingTypePicker = false"> 取消 </el-button>
      </div>
    </div>

    <template v-else>
      <div class="condition-row">
        <div class="condition-header">
          <span class="condition-type-tag" :style="{ backgroundColor: CATEGORY_TAG_COLORS[category!] }">
            {{ conditionTypeLabel[c.type as string] || (c.type as string) }}
          </span>

          <el-button size="small" text class="condition-delete-btn" @click="deleteCondition"> ✕ </el-button>
        </div>

        <div v-if="category === 'evaluate'" class="condition-fields">
          <div class="field-row">
            <span class="field-label">选择器</span>
            <slot name="selector" :model-value="c.target" :update="(v: SelectorDSL) => emitSelectorUpdate(v)" />
          </div>
          <div class="field-row">
            <span class="field-label">评估</span>
            <slot
              name="condition"
              :model-value="c.evaluator"
              :update="(v: ConditionDSL | EvaluatorDSL) => emitEvaluatorUpdate(v as EvaluatorDSL)"
            />
          </div>
        </div>

        <div v-else-if="category === 'probability'" class="condition-fields">
          <div class="field-row">
            <span class="field-label">概率值</span>
            <slot
              name="value"
              :model-value="(c.evaluator as Record<string, unknown>).percent as Value"
              :update="v => emitEvaluatorUpdate({ ...c.evaluator, percent: v } as EvaluatorDSL)"
            />
          </div>
        </div>

        <div v-else-if="category === 'value'" class="condition-fields">
          <div class="field-row">
            <span class="field-label">标记ID</span>
            <slot name="value" :model-value="c.baseId" :update="v => updateField('baseId', v)" />
          </div>
        </div>

        <div v-else-if="category === 'continuousUseSkill'" class="condition-fields">
          <div class="field-row">
            <span class="field-label">次数</span>
            <slot name="value" :model-value="c.times" :update="v => updateField('times', v)" />
          </div>
          <div class="field-row">
            <span class="field-label">策略</span>
            <el-select
              :model-value="c.strategy"
              size="small"
              class="field-select"
              @update:model-value="(v: string) => updateField('strategy', v)"
            >
              <el-option
                v-for="opt in continuousUseStrategyOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </div>
        </div>

        <div v-else-if="category === 'skillSequence'" class="condition-fields">
          <div class="field-row">
            <span class="field-label">序列</span>
            <slot name="value" :model-value="c.sequence" :update="v => updateField('sequence', v)" />
          </div>
          <div class="field-row">
            <span class="field-label">匹配模式</span>
            <el-select
              :model-value="c.mode"
              size="small"
              class="field-select"
              @update:model-value="(v: string) => updateField('mode', v)"
            >
              <el-option
                v-for="opt in skillSequenceModeOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </div>
          <div class="field-row">
            <span class="field-label">来源</span>
            <el-select
              :model-value="c.source"
              size="small"
              class="field-select"
              @update:model-value="(v: string) => updateField('source', v)"
            >
              <el-option
                v-for="opt in skillSequenceSourceOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </div>
        </div>

        <div v-else-if="category === 'statStageChange'" class="condition-fields">
          <div class="field-row">
            <span class="field-label">属性</span>
            <slot name="value" :model-value="c.stat" :update="v => updateField('stat', v)" />
          </div>
          <div class="field-row">
            <span class="field-label">方向</span>
            <el-select
              :model-value="c.check"
              size="small"
              class="field-select"
              @update:model-value="(v: string) => updateField('check', v)"
            >
              <el-option v-for="opt in statCheckOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
          </div>
        </div>

        <div v-else-if="category === 'leaf'" class="condition-fields">
          <span class="field-hint">无需额外参数</span>
        </div>

        <div v-if="category === 'children'" class="condition-children">
          <div v-for="(child, index) in c.conditions" :key="index" class="condition-child-item">
            <span class="child-connector">├</span>
            <button
              type="button"
              class="child-move-btn"
              title="上移"
              :disabled="index === 0"
              @click="moveChildUp(Number(index))"
            >
              ▲
            </button>
            <button
              type="button"
              class="child-move-btn"
              title="下移"
              :disabled="Number(index) >= (c.conditions?.length ?? 0) - 1"
              @click="moveChildDown(Number(index))"
            >
              ▼
            </button>
            <ConditionTreeEditor
              :model-value="child"
              @update:model-value="(v: ConditionDSL | undefined) => updateChildCondition(Number(index), v)"
            >
              <template #selector="scope">
                <slot name="selector" v-bind="scope" />
              </template>
              <template #value="scope">
                <slot name="value" v-bind="scope" />
              </template>
              <template #condition="scope">
                <slot name="condition" v-bind="scope" />
              </template>
            </ConditionTreeEditor>
          </div>
          <el-button size="small" text class="child-add-btn" @click="addChildCondition"> + 子条件 </el-button>
        </div>

        <div v-if="category === 'singleChild'" class="condition-children">
          <div class="condition-child-item">
            <ConditionTreeEditor
              :model-value="c.condition"
              @update:model-value="(v: ConditionDSL | undefined) => updateChildConditionInner(v)"
            >
              <template #selector="scope">
                <slot name="selector" v-bind="scope" />
              </template>
              <template #value="scope">
                <slot name="value" v-bind="scope" />
              </template>
              <template #condition="scope">
                <slot name="condition" v-bind="scope" />
              </template>
            </ConditionTreeEditor>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
export default { name: 'ConditionTreeEditor' }
</script>

<style scoped>
.condition-tree-node {
  font-size: var(--ae-font-sm);
}

.condition-empty {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
  padding: var(--ae-space-1) 0;
}

.condition-empty-label {
  color: var(--ae-text-muted);
  font-size: var(--ae-font-sm);
}

.condition-type-picker {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
}

.type-select {
  width: 200px;
}

.condition-row {
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-sm);
  background-color: var(--ae-bg-elevated);
  overflow: hidden;
}

.condition-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--ae-space-1) var(--ae-space-2);
  border-bottom: 1px solid var(--ae-border-subtle);
  background-color: var(--ae-bg-surface);
}

.condition-type-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: var(--ae-font-xs);
  font-weight: 600;
  color: var(--ae-text-primary);
}

.condition-delete-btn {
  color: var(--ae-error) !important;
  padding: 0 var(--ae-space-1) !important;
  min-height: unset !important;
}

.condition-fields {
  padding: var(--ae-space-2);
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-2);
}

.field-row {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
}

.field-label {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  min-width: 56px;
  flex-shrink: 0;
}

.field-select {
  width: 140px;
}

.field-hint {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-disabled);
  font-style: italic;
}

.condition-children {
  padding: var(--ae-space-2);
  padding-left: var(--ae-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-1);
}

.condition-child-item {
  display: flex;
  align-items: flex-start;
  gap: var(--ae-space-1);
}

.child-connector {
  color: var(--ae-border-default);
  font-family: monospace;
  font-size: var(--ae-font-sm);
  padding-top: 6px;
  flex-shrink: 0;
}

.child-add-btn {
  color: var(--ae-accent-primary) !important;
  font-size: var(--ae-font-xs) !important;
  padding: 0 !important;
  min-height: unset !important;
  align-self: flex-start;
}

.child-move-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  background: none;
  color: var(--ae-text-muted);
  cursor: pointer;
  font-size: 7px;
  border-radius: 3px;
  padding: 0;
  flex-shrink: 0;
  transition: color 0.12s ease;
}

.child-move-btn:hover:not(:disabled) {
  color: var(--ae-text-primary);
  background: var(--ae-hover, rgba(255, 255, 255, 0.06));
}

.child-move-btn:disabled {
  opacity: 0.3;
  cursor: default;
}
</style>
