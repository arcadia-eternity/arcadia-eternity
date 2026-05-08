<script setup lang="ts">
import { computed, ref } from 'vue'
import type { OperatorDSL, OperatorDSLView } from '@arcadia-eternity/schema'
import { useEffectTyping } from './composables/useEffectTyping'

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
      operators: c.operators.filter(
        op => op.toLowerCase().includes(q) || (typeLabelMap[op] ?? op).toLowerCase().includes(q),
      ),
    }))
    .filter(c => c.operators.length > 0)
})

function selectType(type: string) {
  updateField('type', type)
}

function goBack() {
  emit('update:modelValue', {} as OperatorDSL)
}

const model = computed(() => props.modelValue as unknown as OperatorDSLView)

function fieldHint(fieldName: string): string | undefined {
  return typing.getOperatorFieldHint(selectedType.value, fieldName)
}

const cleanStageOptions = [
  { value: 'all', label: '全部' },
  { value: 'positive', label: '有利' },
  { value: 'negative', label: '负面' },
  { value: 'reverse', label: '反转' },
]

const transformTypeOptions = [
  { value: 'temporary', label: '临时' },
  { value: 'permanent', label: '永久' },
]

const permanentStrategyOptions = [
  { value: 'preserve_temporary', label: '保留临时效果' },
  { value: 'clear_temporary', label: '清除临时效果' },
]

const statTypeOptions = [
  { value: 'atk', label: '攻击' },
  { value: 'def', label: '防御' },
  { value: 'spa', label: '特攻' },
  { value: 'spd', label: '特防' },
  { value: 'speed', label: '速度' },
  { value: 'hp', label: '体力' },
  { value: 'recoverHp', label: '恢复体力' },
  { value: 'hitRate', label: '命中率' },
  { value: 'critRate', label: '暴击率' },
  { value: 'damageReduce', label: '减伤' },
  { value: 'damageBoost', label: '增伤' },
  { value: 'healBoost', label: '治疗加成' },
]

const modifierTypeOptions = [
  { value: 'add', label: '加' },
  { value: 'multiply', label: '乘' },
  { value: 'replace', label: '替换' },
  { value: 'set', label: '设' },
]

const TARGET_VALUE_OPS = new Set([
  'dealDamage',
  'heal',
  'addPower',
  'addCritRate',
  'addAccuracy',
  'amplifyPower',
  'addRage',
  'setRage',
  'addStacks',
  'consumeStacks',
  'setMultihit',
  'addMultihitResult',
  'addValue',
  'setValue',
  'setAccuracy',
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
])

const TARGET_ONLY_OPS = new Set([
  'stun',
  'executeKill',
  'preventDamage',
  'destroyMark',
  'setIgnoreShield',
  'disableContext',
  'removeTransformation',
  'executeActions',
  'toggle',
])
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
                  {{ typeLabelMap[op] ?? op }}
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
          <span class="op-type-badge">{{ typeLabelMap[selectedType] ?? selectedType }}</span>
          <button class="op-back-btn" @click="goBack">← 更换类型</button>
        </div>

        <div class="op-form-fields">
          <!-- Pattern 1: targetValue -->
          <template v-if="TARGET_VALUE_OPS.has(selectedType)">
            <div class="op-field">
              <el-tooltip v-if="fieldHint('target')" :content="fieldHint('target')" placement="top" effect="dark">
                <label class="op-field-label">目标</label>
              </el-tooltip>
              <label v-else class="op-field-label">目标</label>
              <slot
                name="target"
                :modelValue="model.target"
                :field="'target'"
                :update="(v: unknown) => updateField('target', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('value')" :content="fieldHint('value')" placement="top" effect="dark">
                <label class="op-field-label">值</label>
              </el-tooltip>
              <label v-else class="op-field-label">值</label>
              <slot
                name="value"
                :modelValue="model.value"
                :field="'value'"
                :update="(v: unknown) => updateField('value', v)"
              />
            </div>
          </template>

          <!-- Pattern 2: targetOnly -->
          <template v-else-if="TARGET_ONLY_OPS.has(selectedType)">
            <div class="op-field">
              <el-tooltip v-if="fieldHint('target')" :content="fieldHint('target')" placement="top" effect="dark">
                <label class="op-field-label">目标</label>
              </el-tooltip>
              <label v-else class="op-field-label">目标</label>
              <slot
                name="target"
                :modelValue="model.target"
                :field="'target'"
                :update="(v: unknown) => updateField('target', v)"
              />
            </div>
          </template>

          <!-- Pattern 3: targetValueExtras — addMark -->
          <template v-else-if="selectedType === 'addMark'">
            <div class="op-field">
              <el-tooltip v-if="fieldHint('target')" :content="fieldHint('target')" placement="top" effect="dark">
                <label class="op-field-label">目标</label>
              </el-tooltip>
              <label v-else class="op-field-label">目标</label>
              <slot
                name="target"
                :modelValue="model.target"
                :field="'target'"
                :update="(v: unknown) => updateField('target', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('mark')" :content="fieldHint('mark')" placement="top" effect="dark">
                <label class="op-field-label">标记</label>
              </el-tooltip>
              <label v-else class="op-field-label">标记</label>
              <slot
                name="value"
                :modelValue="model.mark"
                :field="'mark'"
                :update="(v: unknown) => updateField('mark', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('duration')" :content="fieldHint('duration')" placement="top" effect="dark">
                <label class="op-field-label">持续回合</label>
              </el-tooltip>
              <label v-else class="op-field-label">持续回合</label>
              <slot
                name="value"
                :modelValue="model.duration"
                :field="'duration'"
                :update="(v: unknown) => updateField('duration', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('stack')" :content="fieldHint('stack')" placement="top" effect="dark">
                <label class="op-field-label">堆叠数</label>
              </el-tooltip>
              <label v-else class="op-field-label">堆叠数</label>
              <slot
                name="value"
                :modelValue="model.stack"
                :field="'stack'"
                :update="(v: unknown) => updateField('stack', v)"
              />
            </div>
          </template>

          <!-- Pattern 3: statStageBuff -->
          <template v-else-if="selectedType === 'statStageBuff'">
            <div class="op-field">
              <el-tooltip v-if="fieldHint('target')" :content="fieldHint('target')" placement="top" effect="dark">
                <label class="op-field-label">目标</label>
              </el-tooltip>
              <label v-else class="op-field-label">目标</label>
              <slot
                name="target"
                :modelValue="model.target"
                :field="'target'"
                :update="(v: unknown) => updateField('target', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('statType')" :content="fieldHint('statType')" placement="top" effect="dark">
                <label class="op-field-label">能力类型</label>
              </el-tooltip>
              <label v-else class="op-field-label">能力类型</label>
              <el-select
                :model-value="model.statType"
                placeholder="选择能力类型"
                clearable
                class="w-full"
                @update:model-value="(v: string) => updateField('statType', v)"
              >
                <el-option v-for="opt in statTypeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('value')" :content="fieldHint('value')" placement="top" effect="dark">
                <label class="op-field-label">值</label>
              </el-tooltip>
              <label v-else class="op-field-label">值</label>
              <slot
                name="value"
                :modelValue="model.value"
                :field="'value'"
                :update="(v: unknown) => updateField('value', v)"
              />
            </div>
            <div class="op-field">
              <label class="op-field-label">策略</label>
              <slot
                name="value"
                :modelValue="model.strategy"
                :field="'strategy'"
                :update="(v: unknown) => updateField('strategy', v)"
              />
            </div>
          </template>

          <!-- Pattern 3: clearStatStage / reverseStatStage -->
          <template v-else-if="selectedType === 'clearStatStage' || selectedType === 'reverseStatStage'">
            <div class="op-field">
              <el-tooltip v-if="fieldHint('target')" :content="fieldHint('target')" placement="top" effect="dark">
                <label class="op-field-label">目标</label>
              </el-tooltip>
              <label v-else class="op-field-label">目标</label>
              <slot
                name="target"
                :modelValue="model.target"
                :field="'target'"
                :update="(v: unknown) => updateField('target', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('statType')" :content="fieldHint('statType')" placement="top" effect="dark">
                <label class="op-field-label">能力类型</label>
              </el-tooltip>
              <label v-else class="op-field-label">能力类型</label>
              <slot
                name="value"
                :modelValue="model.statType"
                :field="'statType'"
                :update="(v: unknown) => updateField('statType', v)"
              />
            </div>
            <div class="op-field">
              <label class="op-field-label">清除策略</label>
              <el-select
                :model-value="model.cleanStageStrategy"
                placeholder="选择策略"
                clearable
                class="w-full"
                @update:model-value="(v: string) => updateField('cleanStageStrategy', v)"
              >
                <el-option v-for="opt in cleanStageOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
            </div>
          </template>

          <!-- Pattern 3: transferStatStage -->
          <template v-else-if="selectedType === 'transferStatStage'">
            <div class="op-field">
              <el-tooltip v-if="fieldHint('source')" :content="fieldHint('source')" placement="top" effect="dark">
                <label class="op-field-label">来源</label>
              </el-tooltip>
              <label v-else class="op-field-label">来源</label>
              <slot
                name="target"
                :modelValue="model.source"
                :field="'source'"
                :update="(v: unknown) => updateField('source', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('target')" :content="fieldHint('target')" placement="top" effect="dark">
                <label class="op-field-label">目标</label>
              </el-tooltip>
              <label v-else class="op-field-label">目标</label>
              <slot
                name="target"
                :modelValue="model.target"
                :field="'target'"
                :update="(v: unknown) => updateField('target', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('statType')" :content="fieldHint('statType')" placement="top" effect="dark">
                <label class="op-field-label">能力类型</label>
              </el-tooltip>
              <label v-else class="op-field-label">能力类型</label>
              <slot
                name="value"
                :modelValue="model.statType"
                :field="'statType'"
                :update="(v: unknown) => updateField('statType', v)"
              />
            </div>
            <div class="op-field">
              <label class="op-field-label">清除策略</label>
              <el-select
                :model-value="model.cleanStageStrategy"
                placeholder="选择策略"
                clearable
                class="w-full"
                @update:model-value="(v: string) => updateField('cleanStageStrategy', v)"
              >
                <el-option v-for="opt in cleanStageOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
            </div>
          </template>

          <!-- Pattern 3: modifyStackResult -->
          <template v-else-if="selectedType === 'modifyStackResult'">
            <div class="op-field">
              <el-tooltip v-if="fieldHint('target')" :content="fieldHint('target')" placement="top" effect="dark">
                <label class="op-field-label">目标</label>
              </el-tooltip>
              <label v-else class="op-field-label">目标</label>
              <slot
                name="target"
                :modelValue="model.target"
                :field="'target'"
                :update="(v: unknown) => updateField('target', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('newStacks')" :content="fieldHint('newStacks')" placement="top" effect="dark">
                <label class="op-field-label">新堆叠数</label>
              </el-tooltip>
              <label v-else class="op-field-label">新堆叠数</label>
              <slot
                name="value"
                :modelValue="model.newStacks"
                :field="'newStacks'"
                :update="(v: unknown) => updateField('newStacks', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip
                v-if="fieldHint('newDuration')"
                :content="fieldHint('newDuration')"
                placement="top"
                effect="dark"
              >
                <label class="op-field-label">新持续回合</label>
              </el-tooltip>
              <label v-else class="op-field-label">新持续回合</label>
              <slot
                name="value"
                :modelValue="model.newDuration"
                :field="'newDuration'"
                :update="(v: unknown) => updateField('newDuration', v)"
              />
            </div>
          </template>

          <!-- Pattern 3: setSkill -->
          <template v-else-if="selectedType === 'setSkill'">
            <div class="op-field">
              <el-tooltip v-if="fieldHint('target')" :content="fieldHint('target')" placement="top" effect="dark">
                <label class="op-field-label">目标</label>
              </el-tooltip>
              <label v-else class="op-field-label">目标</label>
              <slot
                name="target"
                :modelValue="model.target"
                :field="'target'"
                :update="(v: unknown) => updateField('target', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('value')" :content="fieldHint('value')" placement="top" effect="dark">
                <label class="op-field-label">值</label>
              </el-tooltip>
              <label v-else class="op-field-label">值</label>
              <slot
                name="value"
                :modelValue="model.value"
                :field="'value'"
                :update="(v: unknown) => updateField('value', v)"
              />
            </div>
            <div class="op-field">
              <label class="op-field-label">更新配置</label>
              <el-switch
                :model-value="!!model.updateConfig"
                @update:model-value="(v: string | number | boolean) => updateField('updateConfig', v)"
              />
            </div>
          </template>

          <!-- Pattern 3: setActualTarget -->
          <template v-else-if="selectedType === 'setActualTarget'">
            <div class="op-field">
              <el-tooltip v-if="fieldHint('target')" :content="fieldHint('target')" placement="top" effect="dark">
                <label class="op-field-label">目标</label>
              </el-tooltip>
              <label v-else class="op-field-label">目标</label>
              <slot
                name="target"
                :modelValue="model.target"
                :field="'target'"
                :update="(v: unknown) => updateField('target', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('newTarget')" :content="fieldHint('newTarget')" placement="top" effect="dark">
                <label class="op-field-label">新目标</label>
              </el-tooltip>
              <label v-else class="op-field-label">新目标</label>
              <slot
                name="value"
                :modelValue="model.newTarget"
                :field="'newTarget'"
                :update="(v: unknown) => updateField('newTarget', v)"
              />
            </div>
          </template>

          <!-- Pattern 3: addModified -->
          <template v-else-if="selectedType === 'addModified'">
            <div class="op-field">
              <el-tooltip v-if="fieldHint('target')" :content="fieldHint('target')" placement="top" effect="dark">
                <label class="op-field-label">目标</label>
              </el-tooltip>
              <label v-else class="op-field-label">目标</label>
              <slot
                name="target"
                :modelValue="model.target"
                :field="'target'"
                :update="(v: unknown) => updateField('target', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('delta')" :content="fieldHint('delta')" placement="top" effect="dark">
                <label class="op-field-label">增量</label>
              </el-tooltip>
              <label v-else class="op-field-label">增量</label>
              <slot
                name="value"
                :modelValue="model.delta"
                :field="'delta'"
                :update="(v: unknown) => updateField('delta', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('percent')" :content="fieldHint('percent')" placement="top" effect="dark">
                <label class="op-field-label">百分比</label>
              </el-tooltip>
              <label v-else class="op-field-label">百分比</label>
              <slot
                name="value"
                :modelValue="model.percent"
                :field="'percent'"
                :update="(v: unknown) => updateField('percent', v)"
              />
            </div>
          </template>

          <!-- Pattern 3: addThreshold -->
          <template v-else-if="selectedType === 'addThreshold'">
            <div class="op-field">
              <el-tooltip v-if="fieldHint('target')" :content="fieldHint('target')" placement="top" effect="dark">
                <label class="op-field-label">目标</label>
              </el-tooltip>
              <label v-else class="op-field-label">目标</label>
              <slot
                name="target"
                :modelValue="model.target"
                :field="'target'"
                :update="(v: unknown) => updateField('target', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('min')" :content="fieldHint('min')" placement="top" effect="dark">
                <label class="op-field-label">最小值</label>
              </el-tooltip>
              <label v-else class="op-field-label">最小值</label>
              <slot
                name="value"
                :modelValue="model.min"
                :field="'min'"
                :update="(v: unknown) => updateField('min', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('max')" :content="fieldHint('max')" placement="top" effect="dark">
                <label class="op-field-label">最大值</label>
              </el-tooltip>
              <label v-else class="op-field-label">最大值</label>
              <slot
                name="value"
                :modelValue="model.max"
                :field="'max'"
                :update="(v: unknown) => updateField('max', v)"
              />
            </div>
          </template>

          <!-- Pattern 3: setConfig -->
          <template v-else-if="selectedType === 'setConfig'">
            <div class="op-field">
              <el-tooltip v-if="fieldHint('target')" :content="fieldHint('target')" placement="top" effect="dark">
                <label class="op-field-label">目标</label>
              </el-tooltip>
              <label v-else class="op-field-label">目标</label>
              <slot
                name="target"
                :modelValue="model.target"
                :field="'target'"
                :update="(v: unknown) => updateField('target', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('key')" :content="fieldHint('key')" placement="top" effect="dark">
                <label class="op-field-label">键</label>
              </el-tooltip>
              <label v-else class="op-field-label">键</label>
              <slot
                name="value"
                :modelValue="model.key"
                :field="'key'"
                :update="(v: unknown) => updateField('key', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('value')" :content="fieldHint('value')" placement="top" effect="dark">
                <label class="op-field-label">值</label>
              </el-tooltip>
              <label v-else class="op-field-label">值</label>
              <slot
                name="value"
                :modelValue="model.value"
                :field="'value'"
                :update="(v: unknown) => updateField('value', v)"
              />
            </div>
          </template>

          <!-- Pattern 3: setIgnoreStageStrategy -->
          <template v-else-if="selectedType === 'setIgnoreStageStrategy'">
            <div class="op-field">
              <el-tooltip v-if="fieldHint('target')" :content="fieldHint('target')" placement="top" effect="dark">
                <label class="op-field-label">目标</label>
              </el-tooltip>
              <label v-else class="op-field-label">目标</label>
              <slot
                name="target"
                :modelValue="model.target"
                :field="'target'"
                :update="(v: unknown) => updateField('target', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('value')" :content="fieldHint('value')" placement="top" effect="dark">
                <label class="op-field-label">值</label>
              </el-tooltip>
              <label v-else class="op-field-label">值</label>
              <slot
                name="value"
                :modelValue="model.value"
                :field="'value'"
                :update="(v: unknown) => updateField('value', v)"
              />
            </div>
          </template>

          <!-- Pattern 3: setSureHit / setSureCrit / setSureMiss / setSureNoCrit -->
          <template
            v-else-if="
              selectedType === 'setSureHit' ||
              selectedType === 'setSureCrit' ||
              selectedType === 'setSureMiss' ||
              selectedType === 'setSureNoCrit'
            "
          >
            <div class="op-field">
              <el-tooltip v-if="fieldHint('target')" :content="fieldHint('target')" placement="top" effect="dark">
                <label class="op-field-label">目标</label>
              </el-tooltip>
              <label v-else class="op-field-label">目标</label>
              <slot
                name="target"
                :modelValue="model.target"
                :field="'target'"
                :update="(v: unknown) => updateField('target', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('priority')" :content="fieldHint('priority')" placement="top" effect="dark">
                <label class="op-field-label">优先级</label>
              </el-tooltip>
              <label v-else class="op-field-label">优先级</label>
              <el-input-number
                :model-value="Number(model.priority ?? 0)"
                :min="-128"
                :max="127"
                controls-position="right"
                @update:model-value="(v: number | undefined) => updateField('priority', v ?? 0)"
              />
            </div>
          </template>

          <!-- Pattern 3: transform / transformWithPreservation -->
          <template v-else-if="selectedType === 'transform' || selectedType === 'transformWithPreservation'">
            <div class="op-field">
              <el-tooltip v-if="fieldHint('target')" :content="fieldHint('target')" placement="top" effect="dark">
                <label class="op-field-label">目标</label>
              </el-tooltip>
              <label v-else class="op-field-label">目标</label>
              <slot
                name="target"
                :modelValue="model.target"
                :field="'target'"
                :update="(v: unknown) => updateField('target', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('newBase')" :content="fieldHint('newBase')" placement="top" effect="dark">
                <label class="op-field-label">新形态</label>
              </el-tooltip>
              <label v-else class="op-field-label">新形态</label>
              <slot
                name="value"
                :modelValue="model.newBase"
                :field="'newBase'"
                :update="(v: unknown) => updateField('newBase', v)"
              />
            </div>
            <div class="op-field">
              <label class="op-field-label">变身类型</label>
              <el-select
                :model-value="model.transformType"
                placeholder="选择类型"
                clearable
                class="w-full"
                @update:model-value="(v: string) => updateField('transformType', v)"
              >
                <el-option v-for="opt in transformTypeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
            </div>
            <div class="op-field">
              <label class="op-field-label">永久策略</label>
              <el-select
                :model-value="model.permanentStrategy"
                placeholder="选择策略"
                clearable
                class="w-full"
                @update:model-value="(v: string) => updateField('permanentStrategy', v)"
              >
                <el-option
                  v-for="opt in permanentStrategyOptions"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('priority')" :content="fieldHint('priority')" placement="top" effect="dark">
                <label class="op-field-label">优先级</label>
              </el-tooltip>
              <label v-else class="op-field-label">优先级</label>
              <slot
                name="value"
                :modelValue="model.priority"
                :field="'priority'"
                :update="(v: unknown) => updateField('priority', v)"
              />
            </div>
          </template>

          <!-- Pattern 3: addTemporaryEffect -->
          <template v-else-if="selectedType === 'addTemporaryEffect'">
            <div class="op-field">
              <el-tooltip v-if="fieldHint('target')" :content="fieldHint('target')" placement="top" effect="dark">
                <label class="op-field-label">目标</label>
              </el-tooltip>
              <label v-else class="op-field-label">目标</label>
              <slot
                name="target"
                :modelValue="model.target"
                :field="'target'"
                :update="(v: unknown) => updateField('target', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('effect')" :content="fieldHint('effect')" placement="top" effect="dark">
                <label class="op-field-label">效果</label>
              </el-tooltip>
              <label v-else class="op-field-label">效果</label>
              <slot
                name="value"
                :modelValue="model.effect"
                :field="'effect'"
                :update="(v: unknown) => updateField('effect', v)"
              />
            </div>
          </template>

          <!-- Pattern 3: registerConfig / registerTaggedConfig -->
          <template v-else-if="selectedType === 'registerConfig' || selectedType === 'registerTaggedConfig'">
            <div class="op-field">
              <el-tooltip v-if="fieldHint('target')" :content="fieldHint('target')" placement="top" effect="dark">
                <label class="op-field-label">目标</label>
              </el-tooltip>
              <label v-else class="op-field-label">目标</label>
              <slot
                name="target"
                :modelValue="model.target"
                :field="'target'"
                :update="(v: unknown) => updateField('target', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('configKey')" :content="fieldHint('configKey')" placement="top" effect="dark">
                <label class="op-field-label">配置键</label>
              </el-tooltip>
              <label v-else class="op-field-label">配置键</label>
              <slot
                name="value"
                :modelValue="model.configKey"
                :field="'configKey'"
                :update="(v: unknown) => updateField('configKey', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip
                v-if="fieldHint('initialValue')"
                :content="fieldHint('initialValue')"
                placement="top"
                effect="dark"
              >
                <label class="op-field-label">初始值</label>
              </el-tooltip>
              <label v-else class="op-field-label">初始值</label>
              <slot
                name="value"
                :modelValue="model.initialValue"
                :field="'initialValue'"
                :update="(v: unknown) => updateField('initialValue', v)"
              />
            </div>
            <div v-if="selectedType === 'registerTaggedConfig'" class="op-field">
              <el-tooltip v-if="fieldHint('tags')" :content="fieldHint('tags')" placement="top" effect="dark">
                <label class="op-field-label">标签</label>
              </el-tooltip>
              <label v-else class="op-field-label">标签</label>
              <slot
                name="value"
                :modelValue="model.tags"
                :field="'tags'"
                :update="(v: unknown) => updateField('tags', v)"
              />
            </div>
          </template>

          <!-- Pattern 3: overrideMarkConfig -->
          <template v-else-if="selectedType === 'overrideMarkConfig'">
            <div class="op-field">
              <el-tooltip v-if="fieldHint('target')" :content="fieldHint('target')" placement="top" effect="dark">
                <label class="op-field-label">目标</label>
              </el-tooltip>
              <label v-else class="op-field-label">目标</label>
              <slot
                name="target"
                :modelValue="model.target"
                :field="'target'"
                :update="(v: unknown) => updateField('target', v)"
              />
            </div>
            <div class="op-mark-config-inline">
              <div class="op-field">
                <label class="op-field-label">持续回合</label>
                <el-input-number
                  :model-value="(model.config as Record<string, any>)?.duration"
                  :min="0"
                  controls-position="right"
                  @update:model-value="
                    (v: number | undefined) =>
                      updateField('config', { ...((model.config as Record<string, any>) ?? {}), duration: v })
                  "
                />
              </div>
              <div class="op-field">
                <label class="op-field-label">最大堆叠</label>
                <el-input-number
                  :model-value="(model.config as Record<string, any>)?.maxStacks"
                  :min="0"
                  :max="999"
                  controls-position="right"
                  @update:model-value="
                    (v: number | undefined) =>
                      updateField('config', { ...((model.config as Record<string, any>) ?? {}), maxStacks: v })
                  "
                />
              </div>
              <div class="op-field">
                <label class="op-field-label">可堆叠</label>
                <el-switch
                  :model-value="!!(model.config as Record<string, any>)?.stackable"
                  @update:model-value="
                    (v: string | number | boolean) =>
                      updateField('config', { ...((model.config as Record<string, any>) ?? {}), stackable: v })
                  "
                />
              </div>
              <div class="op-field">
                <label class="op-field-label">护盾</label>
                <el-switch
                  :model-value="!!(model.config as Record<string, any>)?.isShield"
                  @update:model-value="
                    (v: string | number | boolean) =>
                      updateField('config', { ...((model.config as Record<string, any>) ?? {}), isShield: v })
                  "
                />
              </div>
            </div>
          </template>

          <!-- Pattern 4: conditional -->
          <template v-else-if="selectedType === 'conditional'">
            <div class="op-field">
              <label class="op-field-label">条件</label>
              <slot
                name="condition"
                :modelValue="model.condition"
                :update="(v: unknown) => updateField('condition', v)"
              />
            </div>
            <div class="op-conditional-branch">
              <div class="op-branch-label true">true</div>
              <slot
                name="operator"
                :modelValue="model.trueOperator"
                :field="'trueOperator'"
                :update="(v: unknown) => updateField('trueOperator', v)"
              />
            </div>
            <div class="op-conditional-branch">
              <div class="op-branch-label false">false</div>
              <slot
                name="operator"
                :modelValue="model.falseOperator"
                :field="'falseOperator'"
                :update="(v: unknown) => updateField('falseOperator', v)"
              />
            </div>
          </template>

          <!-- Pattern 5: modifiers (static value) -->
          <template
            v-else-if="
              [
                'addAttributeModifier',
                'addClampMaxModifier',
                'addClampMinModifier',
                'addClampModifier',
                'addSkillAttributeModifier',
                'addSkillClampMaxModifier',
                'addSkillClampMinModifier',
                'addSkillClampModifier',
                'addConfigModifier',
                'addTaggedConfigModifier',
                'addPhaseConfigModifier',
                'addPhaseTypeConfigModifier',
              ].includes(selectedType)
            "
          >
            <div class="op-field">
              <el-tooltip v-if="fieldHint('target')" :content="fieldHint('target')" placement="top" effect="dark">
                <label class="op-field-label">目标</label>
              </el-tooltip>
              <label v-else class="op-field-label">目标</label>
              <slot
                name="target"
                :modelValue="model.target"
                :field="'target'"
                :update="(v: unknown) => updateField('target', v)"
              />
            </div>
            <div class="op-field">
              <label class="op-field-label">{{
                ['addAttributeModifier', 'addClampMaxModifier', 'addClampMinModifier', 'addClampModifier'].includes(
                  selectedType,
                )
                  ? '属性'
                  : [
                        'addSkillAttributeModifier',
                        'addSkillClampMaxModifier',
                        'addSkillClampMinModifier',
                        'addSkillClampModifier',
                      ].includes(selectedType)
                    ? '技能属性'
                    : ['addTaggedConfigModifier'].includes(selectedType)
                      ? '标签'
                      : '配置键'
              }}</label>
              <slot
                name="value"
                :modelValue="model.stat ?? model.attribute ?? model.configKey ?? model.tag"
                :field="selectedType === 'addTaggedConfigModifier' ? 'tag' : 'stat'"
                :update="
                  (v: unknown) =>
                    updateField(
                      selectedType === 'addTaggedConfigModifier'
                        ? 'tag'
                        : selectedType.includes('Config')
                          ? 'configKey'
                          : selectedType.includes('Skill')
                            ? 'attribute'
                            : 'stat',
                      v,
                    )
                "
              />
            </div>
            <div class="op-field">
              <label class="op-field-label">修正类型</label>
              <el-select
                :model-value="model.modifierType"
                placeholder="选择修正类型"
                clearable
                class="w-full"
                @update:model-value="(v: string) => updateField('modifierType', v)"
              >
                <el-option v-for="opt in modifierTypeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('value')" :content="fieldHint('value')" placement="top" effect="dark">
                <label class="op-field-label">值</label>
              </el-tooltip>
              <label v-else class="op-field-label">值</label>
              <slot
                name="value"
                :modelValue="model.value ?? model.maxValue ?? model.minValue"
                :field="
                  selectedType === 'addClampMaxModifier' || selectedType === 'addSkillClampMaxModifier'
                    ? 'maxValue'
                    : selectedType === 'addClampMinModifier' || selectedType === 'addSkillClampMinModifier'
                      ? 'minValue'
                      : 'value'
                "
                :update="
                  (v: unknown) =>
                    updateField(
                      selectedType === 'addClampMaxModifier' || selectedType === 'addSkillClampMaxModifier'
                        ? 'maxValue'
                        : selectedType === 'addClampMinModifier' || selectedType === 'addSkillClampMinModifier'
                          ? 'minValue'
                          : 'value',
                      v,
                    )
                "
              />
            </div>
            <template v-if="selectedType === 'addClampModifier' || selectedType === 'addSkillClampModifier'">
              <div class="op-field">
                <el-tooltip v-if="fieldHint('minValue')" :content="fieldHint('minValue')" placement="top" effect="dark">
                  <label class="op-field-label">最小值</label>
                </el-tooltip>
                <label v-else class="op-field-label">最小值</label>
                <slot
                  name="value"
                  :modelValue="model.minValue"
                  :field="'minValue'"
                  :update="(v: unknown) => updateField('minValue', v)"
                />
              </div>
              <div class="op-field">
                <el-tooltip v-if="fieldHint('maxValue')" :content="fieldHint('maxValue')" placement="top" effect="dark">
                  <label class="op-field-label">最大值</label>
                </el-tooltip>
                <label v-else class="op-field-label">最大值</label>
                <slot
                  name="value"
                  :modelValue="model.maxValue"
                  :field="'maxValue'"
                  :update="(v: unknown) => updateField('maxValue', v)"
                />
              </div>
            </template>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('priority')" :content="fieldHint('priority')" placement="top" effect="dark">
                <label class="op-field-label">优先级</label>
              </el-tooltip>
              <label v-else class="op-field-label">优先级</label>
              <slot
                name="value"
                :modelValue="model.priority"
                :field="'priority'"
                :update="(v: unknown) => updateField('priority', v)"
              />
            </div>
            <template v-if="selectedType === 'addPhaseTypeConfigModifier'">
              <div class="op-field">
                <el-tooltip
                  v-if="fieldHint('phaseType')"
                  :content="fieldHint('phaseType')"
                  placement="top"
                  effect="dark"
                >
                  <label class="op-field-label">阶段类型</label>
                </el-tooltip>
                <label v-else class="op-field-label">阶段类型</label>
                <slot
                  name="value"
                  :modelValue="model.phaseType"
                  :field="'phaseType'"
                  :update="(v: unknown) => updateField('phaseType', v)"
                />
              </div>
            </template>
            <template
              v-if="
                [
                  'addAttributeModifier',
                  'addClampModifier',
                  'addPhaseTypeConfigModifier',
                  'addPhaseConfigModifier',
                ].includes(selectedType)
              "
            >
              <div class="op-field">
                <el-tooltip v-if="fieldHint('scope')" :content="fieldHint('scope')" placement="top" effect="dark">
                  <label class="op-field-label">作用域</label>
                </el-tooltip>
                <label v-else class="op-field-label">作用域</label>
                <slot
                  name="value"
                  :modelValue="model.scope"
                  :field="'scope'"
                  :update="(v: unknown) => updateField('scope', v)"
                />
              </div>
              <div class="op-field">
                <el-tooltip v-if="fieldHint('phaseId')" :content="fieldHint('phaseId')" placement="top" effect="dark">
                  <label class="op-field-label">阶段ID</label>
                </el-tooltip>
                <label v-else class="op-field-label">阶段ID</label>
                <slot
                  name="value"
                  :modelValue="model.phaseId"
                  :field="'phaseId'"
                  :update="(v: unknown) => updateField('phaseId', v)"
                />
              </div>
            </template>
          </template>

          <!-- Pattern 5: dynamic modifiers (observableValue) -->
          <template
            v-else-if="
              [
                'addDynamicAttributeModifier',
                'addDynamicSkillAttributeModifier',
                'addDynamicConfigModifier',
                'addPhaseDynamicConfigModifier',
                'addDynamicPhaseTypeConfigModifier',
              ].includes(selectedType)
            "
          >
            <div class="op-field">
              <el-tooltip v-if="fieldHint('target')" :content="fieldHint('target')" placement="top" effect="dark">
                <label class="op-field-label">目标</label>
              </el-tooltip>
              <label v-else class="op-field-label">目标</label>
              <slot
                name="target"
                :modelValue="model.target"
                :field="'target'"
                :update="(v: unknown) => updateField('target', v)"
              />
            </div>
            <div class="op-field">
              <label class="op-field-label">{{ selectedType.includes('Skill') ? '技能属性' : '配置键' }}</label>
              <slot
                name="value"
                :modelValue="model.stat ?? model.attribute ?? model.configKey"
                :field="
                  selectedType.includes('Config') ? 'configKey' : selectedType.includes('Skill') ? 'attribute' : 'stat'
                "
                :update="
                  (v: unknown) =>
                    updateField(
                      selectedType.includes('Config')
                        ? 'configKey'
                        : selectedType.includes('Skill')
                          ? 'attribute'
                          : 'stat',
                      v,
                    )
                "
              />
            </div>
            <div class="op-field">
              <label class="op-field-label">修正类型</label>
              <el-select
                :model-value="model.modifierType"
                placeholder="选择修正类型"
                clearable
                class="w-full"
                @update:model-value="(v: string) => updateField('modifierType', v)"
              >
                <el-option v-for="opt in modifierTypeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
            </div>
            <div class="op-field">
              <el-tooltip
                v-if="fieldHint('observableValue')"
                :content="fieldHint('observableValue')"
                placement="top"
                effect="dark"
              >
                <label class="op-field-label">观测值</label>
              </el-tooltip>
              <label v-else class="op-field-label">观测值</label>
              <slot
                name="target"
                :modelValue="model.observableValue"
                :field="'observableValue'"
                :update="(v: unknown) => updateField('observableValue', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('priority')" :content="fieldHint('priority')" placement="top" effect="dark">
                <label class="op-field-label">优先级</label>
              </el-tooltip>
              <label v-else class="op-field-label">优先级</label>
              <slot
                name="value"
                :modelValue="model.priority"
                :field="'priority'"
                :update="(v: unknown) => updateField('priority', v)"
              />
            </div>
            <template v-if="selectedType === 'addDynamicPhaseTypeConfigModifier'">
              <div class="op-field">
                <el-tooltip
                  v-if="fieldHint('phaseType')"
                  :content="fieldHint('phaseType')"
                  placement="top"
                  effect="dark"
                >
                  <label class="op-field-label">阶段类型</label>
                </el-tooltip>
                <label v-else class="op-field-label">阶段类型</label>
                <slot
                  name="value"
                  :modelValue="model.phaseType"
                  :field="'phaseType'"
                  :update="(v: unknown) => updateField('phaseType', v)"
                />
              </div>
            </template>
            <template
              v-if="
                [
                  'addDynamicAttributeModifier',
                  'addDynamicPhaseTypeConfigModifier',
                  'addPhaseDynamicConfigModifier',
                ].includes(selectedType)
              "
            >
              <div class="op-field">
                <el-tooltip v-if="fieldHint('scope')" :content="fieldHint('scope')" placement="top" effect="dark">
                  <label class="op-field-label">作用域</label>
                </el-tooltip>
                <label v-else class="op-field-label">作用域</label>
                <slot
                  name="value"
                  :modelValue="model.scope"
                  :field="'scope'"
                  :update="(v: unknown) => updateField('scope', v)"
                />
              </div>
              <div class="op-field">
                <el-tooltip v-if="fieldHint('phaseId')" :content="fieldHint('phaseId')" placement="top" effect="dark">
                  <label class="op-field-label">阶段ID</label>
                </el-tooltip>
                <label v-else class="op-field-label">阶段ID</label>
                <slot
                  name="value"
                  :modelValue="model.phaseId"
                  :field="'phaseId'"
                  :update="(v: unknown) => updateField('phaseId', v)"
                />
              </div>
            </template>
          </template>

          <!-- Pattern 3: transferMark -->
          <template v-else-if="selectedType === 'transferMark'">
            <div class="op-field">
              <el-tooltip v-if="fieldHint('target')" :content="fieldHint('target')" placement="top" effect="dark">
                <label class="op-field-label">目标</label>
              </el-tooltip>
              <label v-else class="op-field-label">目标</label>
              <slot
                name="target"
                :modelValue="model.target"
                :field="'target'"
                :update="(v: unknown) => updateField('target', v)"
              />
            </div>
            <div class="op-field">
              <el-tooltip v-if="fieldHint('mark')" :content="fieldHint('mark')" placement="top" effect="dark">
                <label class="op-field-label">标记</label>
              </el-tooltip>
              <label v-else class="op-field-label">标记</label>
              <slot
                name="value"
                :modelValue="model.mark"
                :field="'mark'"
                :update="(v: unknown) => updateField('mark', v)"
              />
            </div>
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
