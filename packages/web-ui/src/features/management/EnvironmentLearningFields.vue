<script setup lang="ts">
import type { ReferenceOptions } from './environmentReferences'
import EnvironmentReferenceInput from './EnvironmentReferenceInput.vue'
import EnvironmentIdList from './EnvironmentIdList.vue'
import {
  defaultLearnsetLevel,
  defaultEditorSkillSlots,
  maxEquippedSkills,
  resolveEnvironmentMechanics,
  resolveEnhancement,
  skillSlotsSchema,
  type SkillSlots,
} from '@arcadia-eternity/const'
import { computed } from 'vue'
import { ElCard, ElRadio, ElRadioGroup, ElButton, ElFormItem, ElInputNumber, ElOption, ElSelect } from 'element-plus'
import type { EnvironmentRules } from '@arcadia-eternity/protocol'
const rules = defineModel<EnvironmentRules>({ required: true })
type Inheritance = NonNullable<NonNullable<EnvironmentRules['mechanics']>['inheritance']>
type Target = Inheritance['eligible']
const props = defineProps<{
  resolved?: EnvironmentRules
  options: ReferenceOptions
  inheritedEnhancement?: Enhancement
}>()
const mechanics = computed(() => (props.resolved ? resolveEnvironmentMechanics(props.resolved) : rules.value.mechanics))
const inherited = computed(() => mechanics.value?.inheritance)
const slots = computed(() => mechanics.value?.skillSlots)
const slotIssue = computed(
  () => skillSlotsSchema.optional().safeParse(rules.value.mechanics?.skillSlots).error?.issues[0]?.message,
)
function setSlots(next: SkillSlots) {
  rules.value = { ...rules.value, schemaVersion: 2, mechanics: { ...rules.value.mechanics, skillSlots: next } }
}
function setSlot(key: keyof SkillSlots, value: number | null | undefined) {
  if (slots.value && value != null) setSlots({ ...slots.value, [key]: value })
}
function restore(key: 'inheritance' | 'secondGenerationNatures' | 'enhancement' | 'skillSlots') {
  const next = { ...rules.value, mechanics: { ...rules.value.mechanics } }
  delete next.mechanics[key]
  rules.value = next
}
const eligibilityLabels = { off: '关闭', species: '按物种', all: '全部物种', list: '指定物种' }
const mode = (eligible?: Target) => (Array.isArray(eligible) ? 'list' : eligible)
function updateInheritance(next: Inheritance) {
  rules.value = { ...rules.value, schemaVersion: 2, mechanics: { ...rules.value.mechanics, inheritance: next } }
}
function setTarget(target: string) {
  updateInheritance({ ...inherited.value, eligible: target === 'list' ? [] : (target as 'species' | 'all' | 'off') })
}
function setNatureTarget(eligible: Target) {
  rules.value = {
    ...rules.value,
    schemaVersion: 2,
    mechanics: { ...rules.value.mechanics, secondGenerationNatures: eligible },
  }
}
function setPool(value: string) {
  const current = inherited.value
  if (!current) return
  if (!value) updateInheritance({ eligible: current.eligible })
  else
    updateInheritance({
      ...current,
      pool: { mode: value as 'fallback' | 'append' | 'replace', skills: current.pool?.skills ?? [] },
    })
}
type Enhancement = NonNullable<NonNullable<EnvironmentRules['mechanics']>['enhancement']>
const enhancementModes = { active: '启用', suppressed: '禁用' }
const enhancementOverride = computed(() => rules.value.mechanics?.enhancement)
function selectEnhancement(value: unknown) {
  if (value === 'inherit') return restore('enhancement')
  if (value !== 'active' && value !== 'suppressed') return
  const enhancement = { ...mechanics.value?.enhancement, mode: value } satisfies Enhancement
  rules.value = { ...rules.value, schemaVersion: 2, mechanics: { ...rules.value.mechanics, enhancement } }
}
function setEnhancementList(field: 'species' | 'stages', values?: string[]) {
  if (!mechanics.value?.enhancement) return
  const next = { ...mechanics.value.enhancement }
  if (values !== undefined) next[field] = values
  else delete next[field]
  rules.value = { ...rules.value, schemaVersion: 2, mechanics: { ...rules.value.mechanics, enhancement: next } }
}
type Adjustment = NonNullable<EnvironmentRules['learnsetAdjustments']>[number]
const adjustmentKey = (row: Adjustment) => JSON.stringify([row.species, row.source, row.skill])
const inheritedAdjustments = computed(() => {
  const local = new Set(rules.value.learnsetAdjustments?.map(adjustmentKey))
  return props.resolved?.learnsetAdjustments?.filter(row => !local.has(adjustmentKey(row)))
})
function overrideAdjustment(row: Adjustment) {
  rules.value = {
    ...rules.value,
    schemaVersion: 2,
    learnsetAdjustments: [...(rules.value.learnsetAdjustments ?? []), { ...row }],
  }
}
function addRow() {
  rules.value = {
    ...rules.value,
    schemaVersion: 2,
    learnsetAdjustments: [
      ...(rules.value.learnsetAdjustments ?? []),
      { species: '', source: 'normal', skill: '', action: 'add' },
    ],
  }
}
function removeRow(index: number) {
  const next = { ...rules.value }
  const rows = next.learnsetAdjustments?.filter((_, i) => i !== index)
  if (rows?.length) next.learnsetAdjustments = rows
  else delete next.learnsetAdjustments
  rules.value = next
}
</script>

<template>
  <ElCard shadow="never"
    ><template #header><h4>遗传与配招</h4></template>
    <div class="learning-fields">
      <div class="learning-row">
        <ElFormItem label="二代性格资格"
          ><ElSelect
            :model-value="mode(mechanics?.secondGenerationNatures)"
            @change="value => setNatureTarget(value === 'list' ? [] : value)"
          >
            <ElOption
              v-for="(label, value) in eligibilityLabels"
              :key="value"
              :value="value"
              :label="label"
            /> </ElSelect
        ></ElFormItem>
        <ElFormItem v-if="Array.isArray(mechanics?.secondGenerationNatures)" label="二代性格物种 ID">
          <EnvironmentIdList
            :options="options.species"
            :model-value="mechanics?.secondGenerationNatures"
            @update:model-value="value => setNatureTarget(value)"
          />
        </ElFormItem>
        <ElButton
          v-if="rules.mechanics?.secondGenerationNatures !== undefined"
          link
          type="primary"
          @click="restore('secondGenerationNatures')"
          >恢复继承性格资格</ElButton
        >
      </div>
      <div class="learning-row">
        <ElFormItem label="遗传资格"
          ><ElSelect :model-value="mode(inherited?.eligible)" @change="setTarget">
            <ElOption
              v-for="(label, value) in eligibilityLabels"
              :key="value"
              :value="value"
              :label="label"
            /> </ElSelect
        ></ElFormItem>
        <ElFormItem v-if="Array.isArray(inherited?.eligible)" label="物种 ID">
          <EnvironmentIdList
            :options="options.species"
            :model-value="inherited.eligible"
            @update:model-value="value => updateInheritance({ ...inherited!, eligible: value })"
          />
        </ElFormItem>
        <ElButton v-if="rules.mechanics?.inheritance" link type="primary" @click="restore('inheritance')"
          >恢复继承遗传规则</ElButton
        >
      </div>
      <div v-if="inherited && inherited.eligible !== 'off'" class="learning-row">
        <ElFormItem label="遗传池"
          ><ElSelect
            :model-value="inherited.pool?.mode ?? 'species'"
            @change="value => setPool(value === 'species' ? '' : value)"
          >
            <ElOption value="species" label="沿用物种池" /><ElOption value="fallback" label="为空时使用公共池" />
            <ElOption value="append" label="追加公共池" /><ElOption value="replace" label="统一使用公共池" /> </ElSelect
        ></ElFormItem>
        <ElFormItem v-if="inherited.pool" label="公共池技能 ID">
          <EnvironmentIdList
            :options="options.skills"
            :model-value="inherited.pool.skills"
            @update:model-value="
              value =>
                updateInheritance({
                  ...inherited!,
                  pool: { ...inherited!.pool!, skills: value },
                })
            "
          />
        </ElFormItem>
      </div>
      <section aria-label="技能槽位">
        <h5>技能槽位</h5>
        <div v-if="slots" class="learning-row">
          <ElFormItem label="普通槽上限"
            ><ElInputNumber
              :model-value="slots.normalMax"
              :min="0"
              :max="maxEquippedSkills"
              @update:model-value="value => setSlot('normalMax', value)"
          /></ElFormItem>
          <ElFormItem label="必杀槽上限"
            ><ElInputNumber
              :model-value="slots.climaxMax"
              :min="0"
              :max="maxEquippedSkills"
              @update:model-value="value => setSlot('climaxMax', value)"
          /></ElFormItem>
          <ElFormItem label="必杀至少装备"
            ><ElInputNumber
              :model-value="slots.climaxMin ?? 0"
              :min="0"
              :max="maxEquippedSkills"
              @update:model-value="value => setSlot('climaxMin', value)"
          /></ElFormItem>
          <ElButton v-if="rules.mechanics?.skillSlots" link @click="restore('skillSlots')">恢复继承槽位</ElButton>
        </div>
        <template v-else>
          <span v-if="resolved">普通与必杀共用槽位（共 {{ maxEquippedSkills }} 个）</span>
          <ElButton @click="setSlots({ ...defaultEditorSkillSlots })">设置分类限额</ElButton>
        </template>
        <p v-if="slotIssue" role="alert">{{ slotIssue }}</p>
      </section>
      <ul v-if="inheritedAdjustments?.length" aria-label="继承的技能调整">
        <li v-for="row in inheritedAdjustments" :key="adjustmentKey(row)">
          {{ row.species }} · {{ row.source === 'normal' ? '普通' : '遗传' }} ·
          {{ row.action === 'add' ? '增加' : '移除' }} {{ row.skill }}
          <span v-if="row.source === 'normal' && row.action === 'add'"
            >（等级 {{ row.level ?? defaultLearnsetLevel }}）</span
          >
          <ElButton link @click="overrideAdjustment(row)">覆盖</ElButton>
        </li>
      </ul>
      <div v-for="(row, index) in rules.learnsetAdjustments" :key="index" class="learning-row">
        <ElFormItem label="物种 ID"
          ><EnvironmentReferenceInput :options="options.species" v-model.trim="row.species"
        /></ElFormItem>
        <ElFormItem label="来源"
          ><ElSelect v-model="row.source" @change="delete row.level">
            <ElOption value="normal" label="普通" /><ElOption value="inherited" label="遗传" /> </ElSelect
        ></ElFormItem>
        <ElFormItem label="操作"
          ><ElSelect v-model="row.action" @change="delete row.level">
            <ElOption value="add" label="增加" /><ElOption value="remove" label="移除" /> </ElSelect
        ></ElFormItem>
        <ElFormItem label="技能 ID"
          ><EnvironmentReferenceInput :options="options.skills" v-model.trim="row.skill"
        /></ElFormItem>
        <ElFormItem v-if="row.source === 'normal' && row.action === 'add'" label="学习等级">
          <ElInputNumber
            :model-value="row.level ?? defaultLearnsetLevel"
            :min="1"
            :max="100"
            @update:model-value="value => (row.level = value ?? undefined)"
          />
        </ElFormItem>
        <ElButton type="danger" link @click="removeRow(index)">删除调整</ElButton>
      </div>
      <ElButton @click="addRow">添加物种技能调整</ElButton>
    </div></ElCard
  >
  <ElCard shadow="never" role="region" aria-label="神魔化">
    <template #header><h4>神魔化</h4></template>
    <ElFormItem label="生效方式">
      <ElRadioGroup
        class="enhancement-modes"
        aria-label="神魔化规则"
        :model-value="enhancementOverride ? resolveEnhancement(enhancementOverride).mode : 'inherit'"
        @update:model-value="selectEnhancement"
      >
        <ElRadio value="inherit">{{
          inheritedEnhancement
            ? '继承（' + enhancementModes[resolveEnhancement(inheritedEnhancement).mode] + '）'
            : '继承规则集'
        }}</ElRadio>
        <ElRadio v-for="(label, value) in enhancementModes" :key="value" :value="value">{{ label }}</ElRadio>
      </ElRadioGroup>
    </ElFormItem>
    <div v-if="mechanics?.enhancement?.mode === 'active'" class="learning-row">
      <ElFormItem label="允许阶段 ID"
        ><EnvironmentIdList
          :placeholder="mechanics.enhancement.stages ? '未允许任何阶段' : '全部阶段'"
          :options="options.stages"
          :model-value="mechanics.enhancement.stages"
          @update:model-value="value => setEnhancementList('stages', value)"
        /><ElButton v-if="mechanics.enhancement.stages !== undefined" link @click="setEnhancementList('stages')"
          >允许全部阶段</ElButton
        ></ElFormItem
      >
      <ElFormItem label="适用物种 ID"
        ><EnvironmentIdList
          :placeholder="mechanics.enhancement.species ? '未允许任何物种' : '全部物种'"
          :options="options.species"
          :model-value="mechanics.enhancement.species"
          @update:model-value="value => setEnhancementList('species', value)"
        /><ElButton v-if="mechanics.enhancement.species !== undefined" link @click="setEnhancementList('species')"
          >允许全部物种</ElButton
        ></ElFormItem
      >
    </div></ElCard
  >
</template>

<style scoped>
.learning-fields {
  display: grid;
  gap: 12px;
  min-width: 0;
}
.learning-row {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 8px 12px;
  max-width: 100%;
}
.learning-row :deep(.el-select) {
  width: 100%;
}
.learning-row > .el-form-item {
  flex: 1 1 12rem;
  min-width: 0;
}
.enhancement-modes {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
  gap: 4px 20px;
}
.enhancement-modes :deep(.el-radio) {
  margin: 0;
  max-width: 100%;
  height: auto;
  min-height: 32px;
  white-space: normal;
}
.learning-row :deep(.el-form-item) {
  margin: 0;
}
</style>
