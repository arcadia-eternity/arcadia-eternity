<script setup lang="ts">
import EnvironmentIdList from './EnvironmentIdList.vue'
import { defaultEditorSkillSlots, skillSlotsSchema } from '@arcadia-eternity/const'
import { computed, ref, watch } from 'vue'
import { ElCollapseItem, ElButton, ElFormItem, ElInput, ElInputNumber, ElOption, ElSelect } from 'element-plus'
import type { EnvironmentRules } from '@arcadia-eternity/protocol'
const rules = defineModel<EnvironmentRules>({ required: true })
type Inheritance = NonNullable<NonNullable<EnvironmentRules['mechanics']>['inheritance']>
type Target = Inheritance['eligible']
const props = defineProps<{ resolved?: EnvironmentRules }>()
const mechanics = computed(() => ({ ...props.resolved?.mechanics, ...rules.value.mechanics }))
const inherited = computed(() => mechanics.value.inheritance)
const slots = ref({ normalMax: 4, climaxMax: 1, climaxMin: 0 })
const slotError = ref('')
watch(
  () => mechanics.value.skillSlots,
  value => {
    slots.value = { ...(value ?? defaultEditorSkillSlots), climaxMin: value?.climaxMin ?? 0 }
    slotError.value = ''
  },
  { immediate: true },
)
function saveSlots() {
  const parsed = skillSlotsSchema.safeParse(slots.value)
  if (!parsed.success) {
    slotError.value = '普通与必杀槽合计最多五个，必选数量须在必杀槽数以内'
    return
  }
  rules.value = { ...rules.value, schemaVersion: 2, mechanics: { ...rules.value.mechanics, skillSlots: parsed.data } }
  slotError.value = ''
}
function restore(key: 'inheritance' | 'secondGenerationNatures' | 'enhancement' | 'skillSlots') {
  const next = { ...rules.value, mechanics: { ...rules.value.mechanics } }
  delete next.mechanics[key]
  rules.value = next
}
const eligibilityLabels = { off: '关闭', species: '按物种', all: '全部物种', list: '指定物种' }
const mode = (eligible?: Target) => (Array.isArray(eligible) ? 'list' : (eligible ?? 'off'))
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
  const current = inherited.value ?? { eligible: 'species' }
  if (!value) updateInheritance({ eligible: current.eligible })
  else
    updateInheritance({
      ...current,
      pool: { mode: value as 'fallback' | 'append' | 'replace', skills: current.pool?.skills ?? [] },
    })
}
type Enhancement = NonNullable<NonNullable<EnvironmentRules['mechanics']>['enhancement']>
function setEnhancement(change: Partial<Enhancement>) {
  const next = { mode: 'forbidden' as const, ...mechanics.value.enhancement, ...change }
  rules.value = { ...rules.value, schemaVersion: 2, mechanics: { ...rules.value.mechanics, enhancement: next } }
}
function setEnhancementList(field: 'species' | 'stages', values: string[]) {
  const next = { ...mechanics.value.enhancement, mode: mechanics.value.enhancement?.mode ?? 'forbidden' } as Enhancement
  if (values.length) next[field] = values
  else delete next[field]
  rules.value = { ...rules.value, schemaVersion: 2, mechanics: { ...rules.value.mechanics, enhancement: next } }
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
  <ElCollapseItem name="learning" title="遗传与配招"
    ><div class="learning-fields">
      <div class="learning-row">
        <ElFormItem label="二代性格资格"
          ><ElSelect
            :model-value="mode(mechanics.secondGenerationNatures)"
            @change="value => setNatureTarget(value === 'list' ? [] : value)"
          >
            <ElOption
              v-for="(label, value) in eligibilityLabels"
              :key="value"
              :value="value"
              :label="label"
            /> </ElSelect
        ></ElFormItem>
        <ElFormItem v-if="Array.isArray(mechanics.secondGenerationNatures)" label="二代性格物种 ID">
          <EnvironmentIdList
            :model-value="mechanics.secondGenerationNatures"
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
      <details>
        <summary>技能槽位</summary>
        <div class="learning-row">
          <ElFormItem label="普通槽上限"><ElInputNumber v-model="slots.normalMax" :min="0" :max="5" /></ElFormItem>
          <ElFormItem label="必杀槽上限"><ElInputNumber v-model="slots.climaxMax" :min="0" :max="5" /></ElFormItem>
          <ElFormItem label="必杀至少装备"><ElInputNumber v-model="slots.climaxMin" :min="0" :max="5" /></ElFormItem>
          <ElButton @click="saveSlots">应用槽位设置</ElButton>
          <ElButton v-if="rules.mechanics?.skillSlots" link @click="restore('skillSlots')">恢复继承槽位</ElButton>
        </div>
        <p v-if="slotError" role="alert">{{ slotError }}</p>
      </details>
      <div v-for="(row, index) in rules.learnsetAdjustments" :key="index" class="learning-row">
        <ElFormItem label="物种 ID"><ElInput v-model.trim="row.species" /></ElFormItem>
        <ElFormItem label="来源"
          ><ElSelect v-model="row.source" @change="delete row.level">
            <ElOption value="normal" label="普通" /><ElOption value="inherited" label="遗传" /> </ElSelect
        ></ElFormItem>
        <ElFormItem label="操作"
          ><ElSelect v-model="row.action" @change="delete row.level">
            <ElOption value="add" label="增加" /><ElOption value="remove" label="移除" /> </ElSelect
        ></ElFormItem>
        <ElFormItem label="技能 ID"><ElInput v-model.trim="row.skill" /></ElFormItem>
        <ElFormItem v-if="row.source === 'normal' && row.action === 'add'" label="学习等级">
          <ElInputNumber
            :model-value="row.level ?? 1"
            :min="1"
            :max="100"
            @update:model-value="value => (row.level = value ?? undefined)"
          />
        </ElFormItem>
        <ElButton type="danger" link @click="removeRow(index)">删除调整</ElButton>
      </div>
      <ElButton @click="addRow">添加物种技能调整</ElButton>
    </div></ElCollapseItem
  >
  <ElCollapseItem name="enhancement" title="神魔化"
    ><div class="learning-fields">
      <div class="learning-row">
        <ElSelect
          aria-label="神魔化规则"
          :model-value="mechanics.enhancement?.mode ?? 'forbidden'"
          @change="value => setEnhancement({ mode: value })"
        >
          <ElOption value="forbidden" label="禁止携带" /><ElOption
            value="suppressed"
            label="可携带，本局不生效"
          /><ElOption value="active" label="启用阶段加成" />
        </ElSelect>
        <ElButton v-if="rules.mechanics?.enhancement" link type="primary" @click="restore('enhancement')"
          >恢复继承神魔化规则</ElButton
        >
      </div>
      <div v-if="mechanics.enhancement && mechanics.enhancement.mode !== 'forbidden'" class="learning-row">
        <ElFormItem label="允许阶段 ID"
          ><EnvironmentIdList
            placeholder="全部阶段"
            :model-value="mechanics.enhancement.stages"
            @update:model-value="value => setEnhancementList('stages', value)"
        /></ElFormItem>
        <ElFormItem label="适用物种 ID"
          ><EnvironmentIdList
            placeholder="全部物种"
            :model-value="mechanics.enhancement.species"
            @update:model-value="value => setEnhancementList('species', value)"
        /></ElFormItem>
      </div></div
  ></ElCollapseItem>
</template>

<style scoped>
.learning-fields {
  display: grid;
  gap: 12px;
  justify-items: start;
}
.learning-row {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 8px 12px;
  max-width: 100%;
}
.learning-row :deep(.el-select) {
  width: min(15rem, 100%);
}
.learning-row :deep(.el-form-item) {
  margin: 0;
}
</style>
