<script setup lang="ts">
import EnvironmentReferenceInput from './EnvironmentReferenceInput.vue'
import type { ReferenceOption } from './environmentReferences'
import { environmentName, parameterGroupLabel } from '@/i18n/environment'
import { computed, ref, watch } from 'vue'
import i18next from 'i18next'
import { ElCard, ElScrollbar, ElButton, ElFormItem, ElInput, ElInputNumber, ElOption, ElSelect } from 'element-plus'
import {
  resolveSkillGroupValue,
  resolveSkillParameters,
  skillParameterKey,
  type SkillParameterCatalog,
  type SkillParameterPolicy,
} from '@arcadia-eternity/const'
import type { EnvironmentRules } from '@arcadia-eternity/protocol'

const rules = defineModel<EnvironmentRules>({ required: true })
const props = defineProps<{
  skillOptions: ReferenceOption[]
  catalog?: SkillParameterCatalog
  resolved?: EnvironmentRules
  appliedKnown: boolean
  appliedPolicy?: SkillParameterPolicy
}>()
const policy = computed(() => rules.value.skillParameters ?? {})
const groupId = ref('')
const groupInput = ref<number>()
const selected = ref('')
const singleInput = ref<number>()
const editingSingle = ref(false)
const manual = ref({ skill: '', useId: '', parameter: '' })
const issue = ref('')
const previous = computed(() => {
  if (!props.catalog || !props.appliedKnown) return new Map<string, number>()
  return new Map(
    resolveSkillParameters(props.catalog, props.appliedPolicy).map(row => [skillParameterKey(row), row.value]),
  )
})
const manualTarget = computed(() => {
  const { skill, useId, parameter } = manual.value
  if (skill && useId && parameter) return { skill, useId, parameter }
  return undefined
})
const preview = computed(() => {
  if (!props.catalog || !props.resolved) return undefined
  try {
    return { rows: resolveSkillParameters(props.catalog, props.resolved.skillParameters) }
  } catch (error) {
    return { error: String(error) }
  }
})
const members = computed(() =>
  (props.catalog?.members ?? []).filter(row => !groupId.value || row.group === groupId.value),
)
const member = computed(() => members.value.find(row => skillParameterKey(row) === selected.value))
const sourceNames = { base: '技能基础值', profile: '数值方案', group: '参数组覆盖', override: '单招例外' } as Record<
  string,
  string
>

const effectiveGroup = computed(() => {
  if (!props.resolved) return undefined
  const policy = props.resolved.skillParameters
  return resolveSkillGroupValue(
    groupId.value,
    policy,
    props.catalog?.profiles.find(row => row.id === policy?.profile),
  )
})
const effective = computed(() => preview.value?.rows?.find(row => skillParameterKey(row) === selected.value))
const effectiveSource = computed(() => {
  const row = effective.value
  if (!row) return ''
  if (row.source === 'profile') {
    const profile = props.resolved!.skillParameters!.profile!
    return (
      '跟随 ' +
      environmentName('parameterProfiles', profile, props.catalog?.profiles.find(item => item.id === profile)?.name)
    )
  }
  if (row.source === 'group') return '跟随参数组「' + groupName(row.group!) + '」'
  return sourceNames[row.source]
})
watch(selected, () => {
  editingSingle.value = false
  singleInput.value = undefined
})
function editSingle() {
  singleInput.value =
    effective.value?.value ?? policy.value.overrides?.find(row => skillParameterKey(row) === selected.value)?.value
  editingSingle.value = true
}

function groupName(id: string) {
  return environmentName('parameterGroups', id, props.catalog?.groups.find(group => group.id === id)?.name)
}

function addressLabel(row: { skill: string; useId: string; parameter: string; group?: string }) {
  const skill =
    i18next.t(row.skill + '.name', { ns: 'skill', nsSeparator: false, defaultValue: row.skill }) || row.skill
  const group = row.group && groupName(row.group)
  const label = group ?? row.parameter
  const ambiguous = props.catalog?.members.some(
    other =>
      other.skill === row.skill &&
      skillParameterKey(other) !== skillParameterKey(row) &&
      (group ? other.group === row.group : !other.group && other.parameter === row.parameter),
  )
  return ambiguous ? [skill, label, row.useId + ' / ' + row.parameter].join(' · ') : skill + ' · ' + label
}

function update(next: SkillParameterPolicy) {
  rules.value = { ...rules.value, schemaVersion: 2, skillParameters: next }
  issue.value = ''
}
function selectProfile(id: string) {
  const next = { ...policy.value }
  if (id) next.profile = id
  else delete next.profile
  update(next)
}
function resetGroupSelection() {
  groupInput.value = undefined
  selected.value = ''
}
function selectGroup(id: string) {
  groupId.value = id
  resetGroupSelection()
}
function setGroup(remove = false) {
  const id = groupId.value.trim()
  if (!id) return
  const groups = { ...policy.value.groups }
  if (remove) delete groups[id]
  else {
    if (groupInput.value == null || !Number.isFinite(Number(groupInput.value))) {
      issue.value = '请输入组值'
      return
    }
    groups[id] = Number(groupInput.value)
  }
  const next = { ...policy.value }
  if (Object.keys(groups).length) next.groups = groups
  else delete next.groups
  update(next)
  groupInput.value = undefined
}
function applyOverride() {
  const target = props.catalog ? member.value : manualTarget.value
  if (target && setOverride(target)) editingSingle.value = false
}
function setOverride(row: { skill: string; useId: string; parameter: string }, remove = false) {
  const key = skillParameterKey(row)
  const overrides = (policy.value.overrides ?? []).filter(entry => skillParameterKey(entry) !== key)
  if (!remove) {
    if (singleInput.value == null || !Number.isFinite(Number(singleInput.value))) {
      issue.value = '请输入单招数值'
      return
    }
    overrides.push({ skill: row.skill, useId: row.useId, parameter: row.parameter, value: Number(singleInput.value) })
  }
  const next = { ...policy.value }
  if (overrides.length) next.overrides = overrides
  else delete next.overrides
  update(next)
  return true
}
</script>

<template>
  <ElCard shadow="never" class="skill-parameters"
    ><template #header><h4>技能数值</h4></template>
    <div class="parameter-fields">
      <ElFormItem label="数值方案">
        <ElSelect
          :model-value="resolved?.skillParameters?.profile ?? policy.profile"
          filterable
          allow-create
          default-first-option
          :clearable="policy.profile !== undefined"
          aria-label="数值方案"
          :placeholder="resolved ? '内容基础值' : '选择数值方案'"
          @update:model-value="id => selectProfile(id || '')"
        >
          <ElOption
            v-for="row in catalog?.profiles"
            :key="row.id"
            :value="row.id"
            :label="environmentName('parameterProfiles', row.id, row.name)"
          />
        </ElSelect>
      </ElFormItem>
      <div class="parameter-row">
        <ElFormItem label="参数组">
          <ElSelect
            :model-value="groupId"
            filterable
            allow-create
            default-first-option
            clearable
            aria-label="参数组"
            placeholder="选择参数组"
            @update:model-value="id => selectGroup(id || '')"
          >
            <ElOption v-for="row in catalog?.groups" :key="row.id" :value="row.id" :label="parameterGroupLabel(row)" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="组值"
          ><ElInputNumber
            v-model="groupInput"
            aria-label="组值"
            :controls="false"
            :placeholder="effectiveGroup?.value.toString()"
        /></ElFormItem>
        <ElButton :disabled="!groupId || groupInput == null" @click="setGroup()">设置组值</ElButton>
        <ElButton :disabled="policy.groups?.[groupId] === undefined" @click="setGroup(true)">跟随方案</ElButton>
      </div>
      <ul v-if="policy.groups">
        <li v-for="(value, id) in policy.groups" :key="id">
          <ElButton link @click="selectGroup(String(id))">{{ groupName(String(id)) }} · {{ value }}</ElButton>
        </li>
      </ul>
      <div class="parameter-row">
        <ElFormItem v-if="catalog" label="单招参数">
          <ElSelect v-model="selected" filterable aria-label="单招参数" placeholder="选择技能及参数">
            <ElOption
              v-for="row in members"
              :key="skillParameterKey(row)"
              :value="skillParameterKey(row)"
              :label="addressLabel(row)"
            />
          </ElSelect>
        </ElFormItem>
        <template v-else>
          <ElFormItem label="技能 ID"
            ><EnvironmentReferenceInput :options="skillOptions" v-model.trim="manual.skill"
          /></ElFormItem>
          <ElFormItem label="使用位置"><ElInput v-model.trim="manual.useId" /></ElFormItem>
          <ElFormItem label="参数名"><ElInput v-model.trim="manual.parameter" /></ElFormItem>
        </template>
      </div>
      <div v-if="member || !catalog" class="parameter-row single-edit-row">
        <span v-if="effective" role="status"
          >当前 <strong>{{ effective.value }}</strong> · {{ effectiveSource }}</span
        >
        <ElButton v-if="catalog && !editingSingle" @click="editSingle">单独调整</ElButton>
        <template v-else>
          <ElFormItem label="单招数值"
            ><ElInputNumber v-model="singleInput" aria-label="单招数值" :controls="false"
          /></ElFormItem>
          <ElButton :disabled="!(catalog ? member : manualTarget) || singleInput == null" @click="applyOverride"
            >固定此招</ElButton
          >
          <ElButton v-if="catalog" text @click="editingSingle = false">取消调整</ElButton>
        </template>
      </div>
      <ul v-if="policy.overrides?.length">
        <li v-for="row in policy.overrides" :key="skillParameterKey(row)">
          {{ addressLabel(catalog?.members.find(item => skillParameterKey(item) === skillParameterKey(row)) ?? row) }} ·
          {{ row.value }}
          <ElButton link type="primary" @click="setOverride(row, true)">恢复跟随</ElButton>
        </li>
      </ul>
      <p v-if="issue || preview?.error" role="alert">{{ issue || preview?.error }}</p>
      <section v-if="preview?.rows?.length">
        <h5>按上次准备的内容预览</h5>
        <ElScrollbar max-height="18rem">
          <ul>
            <li
              v-for="row in preview.rows.filter(row => !groupId || row.group === groupId)"
              :key="skillParameterKey(row)"
            >
              {{ addressLabel(row) }} ·
              <template
                v-if="previous.has(skillParameterKey(row)) && previous.get(skillParameterKey(row)) !== row.value"
                >{{ previous.get(skillParameterKey(row)) }} → </template
              >{{ row.value }}（{{ sourceNames[row.source] }}）
            </li>
          </ul>
        </ElScrollbar>
      </section>
    </div>
  </ElCard>
</template>

<style scoped>
.parameter-fields {
  display: grid;
  gap: 12px;
  padding: 12px 0;
}
.parameter-row {
  display: flex;
  align-items: end;
  gap: 8px;
  flex-wrap: wrap;
}
.parameter-fields :deep(.el-form-item) {
  margin: 0;
}
.parameter-row > .el-form-item:first-child {
  flex: 1 1 20rem;
  min-width: 0;
}
.single-edit-row {
  align-items: center;
}
.single-edit-row > .el-form-item:first-child {
  flex: 0 0 auto;
}
.parameter-fields :deep(.el-select) {
  width: 100%;
}
.parameter-fields > .el-form-item {
  max-width: 24rem;
}
.parameter-fields :deep(.el-input-number) {
  width: 7rem;
}
</style>
