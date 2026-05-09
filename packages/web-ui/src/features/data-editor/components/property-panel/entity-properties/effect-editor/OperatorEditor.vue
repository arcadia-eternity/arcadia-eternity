<script setup lang="ts">
import { computed, ref } from 'vue'
import type { OperatorDSL, OperatorDSLView } from '@arcadia-eternity/schema'
import { useEffectTyping } from './composables/useEffectTyping'
import { getLayoutForType, OPERATOR_TYPE_LABELS } from './constants'
import OperatorFieldRenderer from './OperatorFieldRenderer.vue'

const props = defineProps<{
  modelValue: OperatorDSL
  label?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: OperatorDSL] }>()

const typing = useEffectTyping()

function updateField(field: string, value: unknown) {
  emit('update:modelValue', { ...props.modelValue, [field]: value } as OperatorDSL)
}

const hasType = computed(() => {
  const t = props.modelValue.type
  return typeof t === 'string' && t.length > 0
})

const selectedType = computed(() => (props.modelValue.type as string) ?? '')

const validTypes = computed(() => typing.operatorTypes.value)

const typeLabelMap: Record<string, string> = {
  dealDamage: '造成伤害',
  heal: '治疗',
  executeKill: '处决',
  addMark: '添加标记',
  destroyMark: '销毁标记',
  transferMark: '转移标记',
  addStacks: '增加堆叠',
  consumeStacks: '消耗堆叠',
  modifyStackResult: '修改堆叠结果',
  setMarkDuration: '设置标记持续',
  setMarkStack: '设置标记堆叠数',
  setMarkMaxStack: '设置标记最大堆叠',
  setMarkPersistent: '设置标记常驻',
  setMarkStackable: '设置标记可堆叠',
  setMarkStackStrategy: '设置堆叠策略',
  setMarkDestroyable: '设置标记可销毁',
  setMarkIsShield: '设置标记为护盾',
  setMarkKeepOnSwitchOut: '下场保留标记',
  setMarkTransferOnSwitch: '换宠转移标记',
  setMarkInheritOnFaint: '濒死继承标记',
  setStatLevelMarkLevel: '能力等级标记',
  overrideMarkConfig: '覆盖标记配置',
  addAttributeModifier: '属性修正',
  addDynamicAttributeModifier: '动态属性修正',
  addClampMaxModifier: '上限修正',
  addClampMinModifier: '下限修正',
  addClampModifier: '区间修正',
  addSkillAttributeModifier: '技能属性修正',
  addDynamicSkillAttributeModifier: '动态技能属性修正',
  addSkillClampMaxModifier: '技能上限修正',
  addSkillClampMinModifier: '技能下限修正',
  addSkillClampModifier: '技能区间修正',
  addConfigModifier: '配置修正',
  addDynamicConfigModifier: '动态配置修正',
  addTaggedConfigModifier: '标签配置修正',
  addPhaseConfigModifier: '阶段配置修正',
  addPhaseDynamicConfigModifier: '动态阶段配置修正',
  addPhaseTypeConfigModifier: '阶段类型配置修正',
  addDynamicPhaseTypeConfigModifier: '动态阶段类型配置修正',
  registerConfig: '注册配置',
  registerTaggedConfig: '注册标签配置',
  setConfig: '设置配置',
  statStageBuff: '能力升降',
  clearStatStage: '清除能力等级',
  reverseStatStage: '反转能力等级',
  transferStatStage: '转移能力等级',
  setSureHit: '必中',
  setSureCrit: '必暴',
  setSureMiss: '必失',
  setSureNoCrit: '必不暴',
  setIgnoreShield: '无视护盾',
  amplifyPower: '威力增幅',
  addPower: '威力增加',
  addCritRate: '暴击率增加',
  addAccuracy: '命中率增加',
  addRage: '怒气增加',
  setRage: '怒气设置',
  setMultihit: '多段攻击',
  addMultihitResult: '多段结果',
  stun: '眩晕',
  setSkill: '设置技能',
  setActualTarget: '实际目标',
  disableContext: '禁用上下文',
  transform: '变身',
  transformWithPreservation: '保留变身',
  removeTransformation: '解除变身',
  executeActions: '执行操作',
  addTemporaryEffect: '临时效果',
  addValue: '增加值',
  setValue: '设置值',
  toggle: '切换',
  setIgnoreStageStrategy: '忽略能力等级策略',
  setAccuracy: '设置命中',
  addModified: '伤害修正',
  addThreshold: '伤害阈值',
  preventDamage: '防止伤害',
  conditional: '条件分支',
  modifyStat: '修改属性',
}

const searchQuery = ref('')
const activeCategory = ref('伤害/治疗')

interface CategoryDef {
  key: string
  label: string
  operators: string[]
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

function selectType(type: string) {
  updateField('type', type)
}

function goBack() {
  emit('update:modelValue', {} as OperatorDSL)
}

const model = computed(() => props.modelValue as OperatorDSLView)

const currentLayout = computed(() => getLayoutForType(selectedType.value))

const configModel = computed(() => {
  const raw = props.modelValue as Record<string, unknown>
  return (raw.config ?? {}) as Record<string, unknown>
})

function typeLabel(type: string): string {
  return typeLabelMap[type] ?? OPERATOR_TYPE_LABELS[type] ?? type
}

function fieldHint(fieldName: string): string | undefined {
  return typing.getOperatorFieldHint(selectedType.value, fieldName)
}
</script>

<template>
  <div class="op-editor">
    <div v-if="label" class="op-editor-label">{{ label }}</div>

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
                  @click="selectType(op)"
                >
                  {{ typeLabel(op) }}
                </button>
              </div>
            </div>
          </template>
          <div v-if="filteredCategories.length === 0" class="op-no-results">无匹配操作符</div>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="op-form">
        <div class="op-form-header">
          <span class="op-type-badge">{{ typeLabel(selectedType) }}</span>
          <button class="op-back-btn" @click="goBack">← 更换类型</button>
        </div>

        <div class="op-form-fields">
          <template v-if="currentLayout">
            <!-- Standard layout: no specialLayout -->
            <template v-if="!currentLayout.specialLayout">
              <OperatorFieldRenderer
                v-for="field in currentLayout.fields"
                :key="field.key"
                :field="field"
                :model="model"
                :field-hint="fieldHint"
                @update:field="(fieldName: string, value: unknown) => updateField(fieldName, value)"
              >
                <template
                  v-for="slotName in ['target', 'value', 'condition', 'operator']"
                  :key="slotName"
                  #[slotName]="slotProps"
                >
                  <slot :name="slotName" v-bind="slotProps" />
                </template>
              </OperatorFieldRenderer>
            </template>

            <!-- Special: markConfigInline (overrideMarkConfig) -->
            <template v-else-if="currentLayout.specialLayout === 'markConfigInline'">
              <OperatorFieldRenderer
                v-for="field in currentLayout.fields"
                :key="field.key"
                :field="field"
                :model="model"
                :field-hint="fieldHint"
                @update:field="(fieldName: string, value: unknown) => updateField(fieldName, value)"
              >
                <template
                  v-for="slotName in ['target', 'value', 'condition', 'operator']"
                  :key="slotName"
                  #[slotName]="slotProps"
                >
                  <slot :name="slotName" v-bind="slotProps" />
                </template>
              </OperatorFieldRenderer>
              <div class="op-mark-config-inline">
                <OperatorFieldRenderer
                  v-for="field in currentLayout.markConfigSubFields"
                  :key="field.key"
                  :field="field"
                  :model="configModel"
                  :field-hint="fieldHint"
                  @update:field="
                    (fieldName: string, value: unknown) =>
                      updateField('config', { ...(model.config ?? {}), [fieldName]: value })
                  "
                />
              </div>
            </template>

            <!-- Special: conditional -->
            <template v-else-if="currentLayout.specialLayout === 'conditional'">
              <OperatorFieldRenderer
                :field="currentLayout.fields[0]"
                :model="model"
                :field-hint="fieldHint"
                @update:field="(fieldName: string, value: unknown) => updateField(fieldName, value)"
              >
                <template
                  v-for="slotName in ['target', 'value', 'condition', 'operator']"
                  :key="slotName"
                  #[slotName]="slotProps"
                >
                  <slot :name="slotName" v-bind="slotProps" />
                </template>
              </OperatorFieldRenderer>
              <div class="op-conditional-branch">
                <div class="op-branch-label true">true</div>
                <OperatorFieldRenderer
                  :field="currentLayout.fields[1]"
                  :model="model"
                  :field-hint="fieldHint"
                  @update:field="(fieldName: string, value: unknown) => updateField(fieldName, value)"
                >
                  <template
                    v-for="slotName in ['target', 'value', 'condition', 'operator']"
                    :key="slotName"
                    #[slotName]="slotProps"
                  >
                    <slot :name="slotName" v-bind="slotProps" />
                  </template>
                </OperatorFieldRenderer>
              </div>
              <div class="op-conditional-branch">
                <div class="op-branch-label false">false</div>
                <OperatorFieldRenderer
                  :field="currentLayout.fields[2]"
                  :model="model"
                  :field-hint="fieldHint"
                  @update:field="(fieldName: string, value: unknown) => updateField(fieldName, value)"
                >
                  <template
                    v-for="slotName in ['target', 'value', 'condition', 'operator']"
                    :key="slotName"
                    #[slotName]="slotProps"
                  >
                    <slot :name="slotName" v-bind="slotProps" />
                  </template>
                </OperatorFieldRenderer>
              </div>
            </template>
          </template>

          <!-- Fallback for any unknown type -->
          <template v-else>
            <div class="op-unknown">未知操作符类型: {{ selectedType }}</div>
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

.op-editor-label {
  font-size: var(--ae-font-xs);
  font-weight: 600;
  color: var(--ae-text-secondary);
  text-transform: uppercase;
  padding: 0 0 var(--ae-space-1) 0;
}

/* Picker */
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

/* Form */
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

.op-mark-config-inline {
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-2);
  padding: var(--ae-space-2);
  background: var(--ae-bg-overlay);
  border-radius: var(--ae-radius-sm);
  border: 1px solid var(--ae-border-subtle);
}

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

.op-unknown {
  font-size: var(--ae-font-sm);
  color: var(--ae-text-muted);
  padding: var(--ae-space-2);
}
</style>
