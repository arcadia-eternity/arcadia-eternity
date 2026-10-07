<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  BaseSelectorKey,
  ConditionDSL,
  ConditionDSLView,
  EffectDslFieldTypingRule,
  SelectorChain,
  Value,
} from '@arcadia-eternity/schema'
import { getEffectDslManifest } from '@arcadia-eternity/schema'
import { createSelectorValidator, seer2EffectCompileTypingEnvironment } from '@arcadia-eternity/battle'
import type { CompileState } from '@arcadia-eternity/battle'
import DslNode from '../../DslNode.vue'
import { useNodeTyping, compileStatesToFieldTyping } from '../../composables/useNodeTyping'

defineOptions({ name: 'ConditionEditor' })

const props = withDefaults(
  defineProps<{
    modelValue: ConditionDSL | undefined
    fieldRule?: EffectDslFieldTypingRule
    depth?: number
    maxDepth?: number
  }>(),
  { fieldRule: undefined, depth: 0, maxDepth: 6 },
)

const emit = defineEmits<{
  'update:modelValue': [value: ConditionDSL | undefined]
}>()

const nextDepth = computed(() => (props.depth ?? 0) + 1)

// ── Manifest access ────────────────────────────────────────────────────────────
const manifest = getEffectDslManifest()

// ── Composable ─────────────────────────────────────────────────────────────────
const typing = useNodeTyping()

// ── Selector validator (for resolve target selector pipeline type) ─────────────
const selectorValidator = createSelectorValidator(seer2EffectCompileTypingEnvironment)

// ── Field configuration type ───────────────────────────────────────────────────
interface FieldConfig {
  key: keyof ConditionDSLView
  kind: 'selector' | 'value' | 'evaluator'
  rule: EffectDslFieldTypingRule
  optional: boolean
}

// ── Field labels ───────────────────────────────────────────────────────────────
const FIELD_LABELS: Partial<Record<keyof ConditionDSLView, string>> = {
  target: '选择器',
  evaluator: '求值器',
  baseId: '标记',
  times: '次数',
  strategy: '策略',
  sequence: '技能序列',
  maxGap: '最大间隔',
  window: '窗口',
  stat: '属性',
  mode: '匹配模式',
  source: '来源',
  check: '方向',
}

// Fields in valueFields that should render as DslNode kind='evaluator'
const EVALUATOR_FIELD_KEYS = new Set(['evaluator'])

/**
 * Derive field configs from the manifest for a condition type.
 * Iterates selectorFields first, then valueFields.
 * Maps 'evaluator' key to kind='evaluator' instead of 'value'.
 */
function getConditionFieldConfigs(type: keyof typeof manifest.condition): FieldConfig[] {
  const nodeTyping = manifest.condition[type]
  if (!nodeTyping) return []
  const fields: FieldConfig[] = []

  if (nodeTyping.selectorFields) {
    for (const [key, rule] of Object.entries(nodeTyping.selectorFields)) {
      const optional = nodeTyping?.requiredFields
        ? !(nodeTyping.requiredFields as readonly string[]).includes(key)
        : false
      fields.push({ key: key as keyof ConditionDSLView, kind: 'selector', rule, optional })
    }
  }

  if (nodeTyping.valueFields) {
    for (const [key, rule] of Object.entries(nodeTyping.valueFields)) {
      const kind = EVALUATOR_FIELD_KEYS.has(key) ? 'evaluator' : 'value'
      const optional = nodeTyping?.requiredFields
        ? !(nodeTyping.requiredFields as readonly string[]).includes(key)
        : false
      fields.push({ key: key as keyof ConditionDSLView, kind, rule, optional })
    }
  }

  return fields
}

// ── Category definitions ──────────────────────────────────────────────────────

const CONDITION_CATEGORIES: {
  key: keyof typeof manifest.condition
  label: string
  color: string
  types: ConditionDSL['type'][]
}[] = [
  {
    key: 'basic',
    label: '基础',
    color: '#4caf50',
    types: [
      'petIsActive',
      'selfUseSkill',
      'opponentUseSkill',
      'checkSelf',
      'selfSwitchIn',
      'selfSwitchOut',
      'selfBeSkillTarget',
      'isFirstSkillUsedThisTurn',
      'isLastSkillUsedThisTurn',
    ],
  },
  {
    key: 'damage',
    label: '伤害/治疗',
    color: '#f44336',
    types: ['selfBeDamaged', 'opponentBeDamaged', 'selfBeHeal'],
  },
  {
    key: 'marks',
    label: '标记',
    color: '#ff9800',
    types: ['selfAddMark', 'opponentAddMark', 'selfBeAddMark', 'opponentBeAddMark', 'selfHasMark', 'opponentHasMark'],
  },
  {
    key: 'logic',
    label: '逻辑组合',
    color: '#9c27b0',
    types: ['some', 'every', 'not'],
  },
  {
    key: 'evaluate',
    label: '求值',
    color: '#2196f3',
    types: ['evaluate'],
  },
  {
    key: 'special',
    label: '特殊',
    color: '#607d8b',
    types: ['statStageChange', 'continuousUseSkill', 'skillSequence'],
  },
]

// ── Render category ───────────────────────────────────────────────────────────
type RenderCategory = 'leaf' | 'children' | 'singleChild' | 'compound' | 'special'

const RENDER_LEAF = new Set([
  'petIsActive',
  'selfUseSkill',
  'opponentUseSkill',
  'checkSelf',
  'selfSwitchIn',
  'selfSwitchOut',
  'selfBeSkillTarget',
  'isFirstSkillUsedThisTurn',
  'isLastSkillUsedThisTurn',
  'selfBeDamaged',
  'opponentBeDamaged',
  'selfBeHeal',
  'selfAddMark',
  'opponentAddMark',
  'selfBeAddMark',
  'opponentBeAddMark',
])

function getRenderCategory(type: ConditionDSL['type']): RenderCategory {
  if (RENDER_LEAF.has(type)) return 'leaf'
  if (type === 'some' || type === 'every') return 'children'
  if (type === 'not') return 'singleChild'
  if (type === 'evaluate' || type === 'selfHasMark' || type === 'opponentHasMark') return 'compound'
  if (type === 'continuousUseSkill' || type === 'skillSequence' || type === 'statStageChange') return 'special'
  return 'leaf'
}

// ── Labels ─────────────────────────────────────────────────────────────────────

const conditionTypeLabel: Partial<Record<ConditionDSL['type'], string>> = {
  petIsActive: '宠物存活',
  selfUseSkill: '自身使用技能',
  opponentUseSkill: '对手使用技能',
  checkSelf: '检查自身',
  selfSwitchIn: '自身上场',
  selfSwitchOut: '自身下场',
  selfBeSkillTarget: '自身被技能锁定',
  isFirstSkillUsedThisTurn: '本回合最先出手',
  isLastSkillUsedThisTurn: '本回合最后出手',
  selfBeDamaged: '自身受到伤害',
  opponentBeDamaged: '对手受到伤害',
  selfBeHeal: '自身受到治疗',
  selfAddMark: '自身添加标记',
  opponentAddMark: '对手添加标记',
  selfBeAddMark: '自身被添加标记',
  opponentBeAddMark: '对手被添加标记',
  selfHasMark: '自身拥有标记',
  opponentHasMark: '对手拥有标记',
  some: '任一满足',
  every: '全部满足',
  not: '取反',
  evaluate: '求值',
  statStageChange: '能力变化',
  continuousUseSkill: '连续使用技能',
  skillSequence: '技能序列',
}

const categoryToColor = computed(() => {
  const map: Partial<Record<ConditionDSL['type'], string>> = {}
  for (const cat of CONDITION_CATEGORIES) {
    for (const t of cat.types) {
      map[t] = cat.color
    }
  }
  return map
})

// ── Computed shortcuts ─────────────────────────────────────────────────────────

const cond = computed(() => (props.modelValue ?? {}) as ConditionDSLView)
const condType = computed((): ConditionDSL['type'] => cond.value.type as ConditionDSL['type'])
const renderCategory = computed(() => getRenderCategory(condType.value))
const hasCondition = computed(() => props.modelValue !== undefined && props.modelValue !== null)

/** Manifest-derived field configs for the current condition type */
const fieldConfigs = computed(() => {
  if (!condType.value) return []
  return getConditionFieldConfigs(condType.value)
})

/** For evaluate conditions: resolve the target selector's pipeline output type.
 *  This is passed to the evaluator so it can narrow value type options and
 *  show type mismatch warnings for dynamic values' inner selectors. */
const evaluateTargetFieldRule = computed((): EffectDslFieldTypingRule | undefined => {
  if (condType.value !== 'evaluate') return undefined
  try {
    const target = cond.value.target
    if (!target) return undefined
    let states: CompileState[]
    if (typeof target === 'string') {
      states = selectorValidator.getBaseStates(target)
    } else if ('base' in target) {
      const cs = target as { base: BaseSelectorKey; chain?: SelectorChain[] }
      states = selectorValidator.getBaseStates(cs.base)
      for (const step of cs.chain ?? []) {
        const result = selectorValidator.resolveStep(states, step, '/evaluate-target')
        if (!result.ok) return undefined
        states = result.states
      }
    } else {
      return undefined
    }
    if (states.length > 0) return compileStatesToFieldTyping(states)
  } catch {
    /* ignore resolution errors */
  }
  return undefined
})

const conditionOptions = computed(() => typing.resolveConditionOptions(props.fieldRule))

// ── Type picker (no condition selected) ────────────────────────────────────────

const showingTypePicker = ref(false)
const searchQuery = ref('')
const activeCategory = ref<(typeof CONDITION_CATEGORIES)[number]['key']>('basic')

const filteredOptions = computed(() => {
  const cat = CONDITION_CATEGORIES.find(c => c.key === activeCategory.value)
  if (!cat) return []
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return cat.types
  return cat.types.filter(t => {
    const label = (conditionTypeLabel[t] || t).toLowerCase()
    return label.includes(q) || t.toLowerCase().includes(q)
  })
})

const allMatchingOptions = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) {
    const cat = CONDITION_CATEGORIES.find(c => c.key === activeCategory.value)
    return cat?.types ?? []
  }
  return CONDITION_CATEGORIES.flatMap(c => c.types).filter(t => {
    const label = (conditionTypeLabel[t] || t).toLowerCase()
    return label.includes(q) || t.toLowerCase().includes(q)
  })
})

// ── Type switcher (editing existing condition) ─────────────────────────────────

const showingSwitcher = ref(false)
const switcherType = ref<ConditionDSL['type']>('petIsActive')

function getCatColor(type: ConditionDSL['type']): string {
  for (const cat of CONDITION_CATEGORIES) {
    if (cat.types.includes(type)) return cat.color
  }
  return '#607d8b'
}

// ── Default constructors (use CORRECT schema field names) ──────────────────────

function createDefaultCondition(type: ConditionDSL['type']): ConditionDSL {
  switch (type) {
    case 'some':
    case 'every':
      return { type, conditions: [] }
    case 'not':
      return { type: 'not', condition: { type: 'petIsActive' } }
    case 'evaluate':
      return { type: 'evaluate', target: 'self', evaluator: { type: 'exist' } }
    case 'selfHasMark':
    case 'opponentHasMark':
      return { type, baseId: { type: 'raw:string', value: '' } }
    case 'statStageChange':
      return { type: 'statStageChange', stat: { type: 'raw:string', value: 'speed' }, check: 'all' }
    case 'continuousUseSkill':
      return { type: 'continuousUseSkill', times: { type: 'raw:number', value: 2 } }
    case 'skillSequence':
      return { type: 'skillSequence', sequence: { type: 'raw:string', value: '' }, mode: 'exact' }
    default:
      return { type }
  }
}

// ── Selection ──────────────────────────────────────────────────────────────────

function selectType(type: ConditionDSL['type']) {
  showingTypePicker.value = false
  searchQuery.value = ''
  activeCategory.value = 'basic'
  emit('update:modelValue', createDefaultCondition(type))
}

function switchType() {
  if (!props.modelValue) return
  showingTypePicker.value = true
  searchQuery.value = ''
  activeCategory.value = 'basic'
  switcherType.value = props.modelValue.type as ConditionDSL['type']
}

function deleteCondition() {
  emit('update:modelValue', undefined)
}

// ── Field updates ──────────────────────────────────────────────────────────────

function updateField(field: keyof ConditionDSLView, value: unknown) {
  if (!props.modelValue) return
  emit('update:modelValue', { ...props.modelValue, [field]: value })
}

function addChildCondition() {
  if (!props.modelValue) return
  const conditions = [...((props.modelValue as ConditionDSLView).conditions ?? [])]
  conditions.push({ type: 'petIsActive' } as ConditionDSL)
  emit('update:modelValue', { ...props.modelValue, conditions } as ConditionDSL)
}

function updateChildCondition(index: number, child: ConditionDSL | undefined) {
  if (!props.modelValue) return
  const conditions = [...((props.modelValue as ConditionDSLView).conditions ?? [])]
  if (child === undefined) {
    conditions.splice(index, 1)
  } else {
    conditions[index] = child
  }
  emit('update:modelValue', { ...props.modelValue, conditions } as ConditionDSL)
}

function updateNotChild(child: ConditionDSL | undefined) {
  if (!props.modelValue || child === undefined) return
  emit('update:modelValue', { ...props.modelValue, condition: child } as ConditionDSL)
}

// ── Inline select options ──────────────────────────────────────────────────────

const statCheckOptions = [
  { value: 'up', label: '上升' },
  { value: 'down', label: '下降' },
  { value: 'all', label: '任意' },
]

const skillSequenceModeOptions = [
  { value: 'exact', label: '精确匹配' },
  { value: 'inOrder', label: '按顺序' },
  { value: 'withGap', label: '允许间隔' },
]

const sourceOptions = [
  { value: 'self', label: '自身' },
  { value: 'opponent', label: '对手' },
]
</script>

<template>
  <div class="condition-editor">
    <!-- ═══ No condition selected → type picker ═══ -->
    <div v-if="!hasCondition" class="condition-empty">
      <span class="condition-empty-label">无条件</span>
      <el-button v-if="!showingTypePicker" size="small" type="primary" plain @click="showingTypePicker = true">
        + 添加条件
      </el-button>

      <!-- Categorized type picker -->
      <div v-if="showingTypePicker" class="type-picker">
        <div class="type-picker-header">
          <span class="type-picker-title">选择条件类型</span>
          <el-button size="small" text @click="showingTypePicker = false"> ✕ </el-button>
        </div>

        <el-input v-model="searchQuery" size="small" class="type-search" placeholder="搜索条件类型..." clearable />

        <div v-if="!searchQuery" class="category-tabs">
          <button
            v-for="cat in CONDITION_CATEGORIES"
            :key="cat.key"
            class="category-tab"
            :class="{ active: activeCategory === cat.key }"
            @click="activeCategory = cat.key"
          >
            {{ cat.label }}
          </button>
        </div>

        <div class="type-grid">
          <button
            v-for="t in searchQuery ? allMatchingOptions : filteredOptions"
            :key="t"
            class="type-btn"
            :style="{ borderColor: getCatColor(t) }"
            @click="selectType(t)"
          >
            <span class="type-btn-dot" :style="{ backgroundColor: getCatColor(t) }" />
            {{ conditionTypeLabel[t] || t }}
          </button>
          <span v-if="(searchQuery ? allMatchingOptions : filteredOptions).length === 0" class="type-grid-empty">
            无匹配结果
          </span>
        </div>
      </div>
    </div>

    <!-- ═══ Condition selected → render based on category ═══ -->
    <template v-else>
      <!-- ── Leaf types (no children, no manifest fields) ── -->
      <div v-if="renderCategory === 'leaf'" class="condition-simple">
        <div class="condition-header">
          <span class="condition-type-tag" :style="{ backgroundColor: categoryToColor[condType] || '#607d8b' }">
            {{ conditionTypeLabel[condType] || condType }}
          </span>

          <el-popover :visible="showingSwitcher" placement="bottom-start" :width="200" trigger="click">
            <template #reference>
              <el-button size="small" text class="condition-switch-btn" @click="showingSwitcher = !showingSwitcher">
                ⇄
              </el-button>
            </template>
            <div class="type-switch-inner">
              <el-select
                v-model="switcherType"
                placeholder="切换类型..."
                size="small"
                class="type-select"
                @change="switchType"
              >
                <el-option
                  v-for="opt in conditionOptions"
                  :key="opt"
                  :label="conditionTypeLabel[opt] || opt"
                  :value="opt"
                />
              </el-select>
              <el-button size="small" text @click="showingSwitcher = false">取消</el-button>
            </div>
          </el-popover>

          <el-button size="small" text class="condition-delete-btn" @click="deleteCondition"> ✕ </el-button>
        </div>
        <div class="condition-fields">
          <span class="field-hint">无需额外参数</span>
        </div>
      </div>

      <!-- ── Compound types (evaluate, selfHasMark, opponentHasMark): manifest-driven fields ── -->
      <div v-else-if="renderCategory === 'compound'" class="condition-compound">
        <div class="condition-header">
          <span class="condition-type-tag" :style="{ backgroundColor: categoryToColor[condType] || '#2196f3' }">
            {{ conditionTypeLabel[condType] || condType }}
          </span>

          <el-popover :visible="showingSwitcher" placement="bottom-start" :width="200" trigger="click">
            <template #reference>
              <el-button size="small" text class="condition-switch-btn" @click="showingSwitcher = !showingSwitcher">
                ⇄
              </el-button>
            </template>
            <div class="type-switch-inner">
              <el-select
                v-model="switcherType"
                placeholder="切换类型..."
                size="small"
                class="type-select"
                @change="switchType"
              >
                <el-option
                  v-for="opt in conditionOptions"
                  :key="opt"
                  :label="conditionTypeLabel[opt] || opt"
                  :value="opt"
                />
              </el-select>
              <el-button size="small" text @click="showingSwitcher = false">取消</el-button>
            </div>
          </el-popover>

          <el-button size="small" text class="condition-delete-btn" @click="deleteCondition"> ✕ </el-button>
        </div>
        <div class="condition-fields">
          <div v-for="field in fieldConfigs" :key="field.key" class="field-row">
            <span class="field-label">{{ FIELD_LABELS[field.key] ?? field.key }}</span>
            <DslNode
              :kind="field.kind"
              :model-value="cond[field.key as keyof ConditionDSLView] as any"
              :field-rule="field.key === 'evaluator' ? (evaluateTargetFieldRule ?? field.rule) : field.rule"
              :field-name="field.key"
              :nullable="field.optional"
              :clearable="field.optional"
              :depth="nextDepth"
              :max-depth="maxDepth"
              @update:model-value="(v: unknown) => updateField(field.key, v)"
            />
          </div>
        </div>
      </div>

      <!-- ── Special types (continuousUseSkill, skillSequence, statStageChange): manifest + inline extras ── -->
      <div v-else-if="renderCategory === 'special'" class="condition-compound">
        <div class="condition-header">
          <span class="condition-type-tag" :style="{ backgroundColor: categoryToColor[condType] || '#607d8b' }">
            {{ conditionTypeLabel[condType] || condType }}
          </span>

          <el-popover :visible="showingSwitcher" placement="bottom-start" :width="200" trigger="click">
            <template #reference>
              <el-button size="small" text class="condition-switch-btn" @click="showingSwitcher = !showingSwitcher">
                ⇄
              </el-button>
            </template>
            <div class="type-switch-inner">
              <el-select
                v-model="switcherType"
                placeholder="切换类型..."
                size="small"
                class="type-select"
                @change="switchType"
              >
                <el-option
                  v-for="opt in conditionOptions"
                  :key="opt"
                  :label="conditionTypeLabel[opt] || opt"
                  :value="opt"
                />
              </el-select>
              <el-button size="small" text @click="showingSwitcher = false">取消</el-button>
            </div>
          </el-popover>

          <el-button size="small" text class="condition-delete-btn" @click="deleteCondition"> ✕ </el-button>
        </div>

        <div class="condition-fields">
          <!-- continuousUseSkill: fully manifest-driven (times, strategy) -->
          <template v-if="condType === 'continuousUseSkill'">
            <div v-for="field in fieldConfigs" :key="field.key" class="field-row">
              <span class="field-label">{{ FIELD_LABELS[field.key] ?? field.key }}</span>
              <DslNode
                :kind="field.kind"
                :model-value="cond[field.key as keyof ConditionDSLView] as any"
                :field-rule="field.rule"
                :field-name="field.key"
                :nullable="field.optional"
                :clearable="field.optional"
                :depth="nextDepth"
                :max-depth="maxDepth"
                @update:model-value="(v: unknown) => updateField(field.key, v)"
              />
            </div>
          </template>

          <!-- skillSequence: sequence (required, not in manifest) → manifest fields (maxGap, window) → mode, source -->
          <template v-else-if="condType === 'skillSequence'">
            <div class="field-row">
              <span class="field-label">{{ FIELD_LABELS['sequence'] ?? 'sequence' }}</span>
              <DslNode
                kind="value"
                :model-value="cond.sequence as Value | undefined"
                field-name="sequence"
                :depth="nextDepth"
                :max-depth="maxDepth"
                @update:model-value="(v: unknown) => updateField('sequence', v)"
              />
            </div>
            <div v-for="field in fieldConfigs" :key="field.key" class="field-row">
              <span class="field-label">{{ FIELD_LABELS[field.key] ?? field.key }}</span>
              <DslNode
                :kind="field.kind"
                :model-value="cond[field.key as keyof ConditionDSLView] as any"
                :field-rule="field.rule"
                :field-name="field.key"
                :nullable="field.optional"
                :clearable="field.optional"
                :depth="nextDepth"
                :max-depth="maxDepth"
                @update:model-value="(v: unknown) => updateField(field.key, v)"
              />
            </div>
            <div class="field-row">
              <span class="field-label">{{ FIELD_LABELS['mode'] ?? 'mode' }}</span>
              <el-select
                :model-value="cond.mode ?? 'exact'"
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
              <span class="field-label">{{ FIELD_LABELS['source'] ?? 'source' }}</span>
              <el-select
                :model-value="cond.source ?? 'self'"
                size="small"
                class="field-select"
                @update:model-value="(v: string) => updateField('source', v)"
              >
                <el-option v-for="opt in sourceOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
            </div>
          </template>

          <!-- statStageChange: stat (not in manifest) → check (inline) -->
          <template v-else-if="condType === 'statStageChange'">
            <div class="field-row">
              <span class="field-label">{{ FIELD_LABELS['stat'] ?? 'stat' }}</span>
              <DslNode
                kind="value"
                :model-value="cond.stat as Value | undefined"
                field-name="stat"
                :depth="nextDepth"
                :max-depth="maxDepth"
                @update:model-value="(v: unknown) => updateField('stat', v)"
              />
            </div>
            <div class="field-row">
              <span class="field-label">{{ FIELD_LABELS['check'] ?? 'check' }}</span>
              <el-select
                :model-value="cond.check ?? 'all'"
                size="small"
                class="field-select"
                @update:model-value="(v: string) => updateField('check', v)"
              >
                <el-option v-for="opt in statCheckOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
            </div>
          </template>
        </div>
      </div>

      <!-- ── Some / Every (children array) ── -->
      <div v-else-if="renderCategory === 'children'" class="condition-compound">
        <div class="condition-header">
          <span class="condition-type-tag" :style="{ backgroundColor: categoryToColor[condType] || '#9c27b0' }">
            {{ conditionTypeLabel[condType] || condType }}
          </span>

          <el-popover :visible="showingSwitcher" placement="bottom-start" :width="200" trigger="click">
            <template #reference>
              <el-button size="small" text class="condition-switch-btn" @click="showingSwitcher = !showingSwitcher">
                ⇄
              </el-button>
            </template>
            <div class="type-switch-inner">
              <el-select
                v-model="switcherType"
                placeholder="切换类型..."
                size="small"
                class="type-select"
                @change="switchType"
              >
                <el-option
                  v-for="opt in conditionOptions"
                  :key="opt"
                  :label="conditionTypeLabel[opt] || opt"
                  :value="opt"
                />
              </el-select>
              <el-button size="small" text @click="showingSwitcher = false">取消</el-button>
            </div>
          </el-popover>

          <el-button size="small" text class="condition-delete-btn" @click="deleteCondition"> ✕ </el-button>
        </div>

        <div class="condition-children">
          <div v-for="(child, index) in cond.conditions as ConditionDSL[]" :key="index" class="condition-child-item">
            <span class="child-connector">├</span>
            <ConditionEditor
              :model-value="child"
              :depth="nextDepth"
              :max-depth="maxDepth"
              @update:model-value="(v: ConditionDSL | undefined) => updateChildCondition(Number(index), v)"
            />
            <el-button
              size="small"
              text
              class="child-delete-btn"
              @click="updateChildCondition(Number(index), undefined)"
            >
              ✕
            </el-button>
          </div>
          <el-button size="small" text class="child-add-btn" @click="addChildCondition"> + 子条件 </el-button>
        </div>
      </div>

      <!-- ── Not (single child) ── -->
      <div v-else-if="renderCategory === 'singleChild'" class="condition-compound">
        <div class="condition-header">
          <span class="condition-type-tag" :style="{ backgroundColor: categoryToColor[condType] || '#9c27b0' }">
            {{ conditionTypeLabel[condType] || condType }}
          </span>

          <el-popover :visible="showingSwitcher" placement="bottom-start" :width="200" trigger="click">
            <template #reference>
              <el-button size="small" text class="condition-switch-btn" @click="showingSwitcher = !showingSwitcher">
                ⇄
              </el-button>
            </template>
            <div class="type-switch-inner">
              <el-select
                v-model="switcherType"
                placeholder="切换类型..."
                size="small"
                class="type-select"
                @change="switchType"
              >
                <el-option
                  v-for="opt in conditionOptions"
                  :key="opt"
                  :label="conditionTypeLabel[opt] || opt"
                  :value="opt"
                />
              </el-select>
              <el-button size="small" text @click="showingSwitcher = false">取消</el-button>
            </div>
          </el-popover>

          <el-button size="small" text class="condition-delete-btn" @click="deleteCondition"> ✕ </el-button>
        </div>

        <div class="condition-children">
          <div class="condition-child-item">
            <span class="child-connector">├</span>
            <ConditionEditor
              :model-value="cond.condition as ConditionDSL | undefined"
              :depth="nextDepth"
              :max-depth="maxDepth"
              @update:model-value="(v: ConditionDSL | undefined) => updateNotChild(v)"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.condition-editor {
  font-size: var(--ae-font-sm);
}

/* ── Empty state ─────────────────────────────────────────────────────────── */

.condition-empty {
  display: flex;
  align-items: flex-start;
  gap: var(--ae-space-2);
  flex-wrap: wrap;
}

.condition-empty-label {
  color: var(--ae-text-muted);
  font-size: var(--ae-font-sm);
  line-height: 24px;
}

/* ── Type picker (categorized tabs + search + grid) ───────────────────────── */

.type-picker {
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-2);
  padding: var(--ae-space-2);
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-sm);
  background-color: var(--ae-bg-elevated);
  min-width: 320px;
  max-width: 420px;
}

.type-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.type-picker-title {
  font-size: var(--ae-font-sm);
  font-weight: 600;
  color: var(--ae-text-primary);
}

.type-search {
  width: 100%;
}

.category-tabs {
  display: flex;
  gap: var(--ae-space-1);
  flex-wrap: wrap;
}

.category-tab {
  padding: 2px 10px;
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  background: var(--ae-bg-surface);
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-sm);
  cursor: pointer;
  transition: all 0.12s ease;
}

.category-tab:hover {
  color: var(--ae-text-primary);
  border-color: var(--ae-border-default);
}

.category-tab.active {
  color: var(--ae-accent-primary);
  border-color: var(--ae-accent-primary);
  background: var(--ae-accent-primary-subtle);
}

.type-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--ae-space-1);
  max-height: 200px;
  overflow-y: auto;
}

.type-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: var(--ae-font-xs);
  color: var(--ae-text-secondary);
  background: var(--ae-bg-surface);
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-sm);
  cursor: pointer;
  text-align: left;
  transition: all 0.12s ease;
  border-left-width: 3px;
}

.type-btn:hover {
  color: var(--ae-text-primary);
  background: var(--ae-accent-primary-subtle);
  border-color: var(--ae-accent-primary);
}

.type-btn-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.type-grid-empty {
  grid-column: 1 / -1;
  font-size: var(--ae-font-xs);
  color: var(--ae-text-disabled);
  text-align: center;
  padding: var(--ae-space-2);
}

/* ── Simple condition (leaf) ── */

.condition-simple {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-sm);
  background-color: var(--ae-bg-surface);
  overflow: hidden;
}

.condition-simple .condition-header {
  padding: var(--ae-space-1) var(--ae-space-2);
  display: flex;
  align-items: center;
  gap: var(--ae-space-1);
  flex-wrap: nowrap;
}

.condition-simple .condition-fields {
  padding: var(--ae-space-2);
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-2);
  border-top: 1px solid var(--ae-border-subtle);
}

/* ── Compound condition (evaluate, special, children, singleChild) ── */

.condition-compound {
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-sm);
  background-color: var(--ae-bg-elevated);
  overflow: hidden;
}

.condition-compound .condition-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--ae-space-1) var(--ae-space-2);
  border-bottom: 1px solid var(--ae-border-subtle);
  background-color: var(--ae-bg-surface);
}

.condition-compound .condition-fields {
  padding: var(--ae-space-2);
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-2);
}

/* ── Header shared ────────────────────────────────────────────────────────── */

.condition-type-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: var(--ae-font-xs);
  font-weight: 600;
  color: var(--ae-text-primary);
  white-space: nowrap;
}

.condition-switch-btn {
  color: var(--ae-text-muted) !important;
  padding: 0 !important;
  min-height: unset !important;
  font-size: var(--ae-font-xs) !important;
}

.condition-delete-btn {
  color: var(--ae-error) !important;
  padding: 0 var(--ae-space-1) !important;
  min-height: unset !important;
}

/* ── Fields ───────────────────────────────────────────────────────────────── */

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

/* ── Children ──────────────────────────────────────────────────────────────── */

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

.condition-child-item > .condition-editor {
  flex: 1;
  min-width: 0;
}

.child-connector {
  color: var(--ae-border-default);
  font-family: monospace;
  font-size: var(--ae-font-sm);
  padding-top: 6px;
  flex-shrink: 0;
}

.child-delete-btn {
  color: var(--ae-error) !important;
  padding: 0 !important;
  min-height: unset !important;
  font-size: var(--ae-font-xs) !important;
  flex-shrink: 0;
  margin-top: 4px;
}

.child-add-btn {
  color: var(--ae-accent-primary) !important;
  font-size: var(--ae-font-xs) !important;
  padding: 0 !important;
  min-height: unset !important;
  align-self: flex-start;
}

/* ── Type switcher (popover) ──────────────────────────────────────────────── */

.type-switch-inner {
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-2);
}

.type-switch-inner .type-select {
  width: 100%;
}
</style>
