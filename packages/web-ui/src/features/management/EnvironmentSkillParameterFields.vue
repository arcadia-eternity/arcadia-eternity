<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  resolveSkillParameters,
  skillParameterKey,
  type SkillParameterCatalog,
  type SkillParameterPolicy,
} from '@arcadia-eternity/const'
import type { EnvironmentRules } from '@arcadia-eternity/protocol'

const rules = defineModel<EnvironmentRules>({ required: true })
const props = defineProps<{
  catalog?: SkillParameterCatalog
  previewPolicy?: SkillParameterPolicy
  appliedPolicy?: SkillParameterPolicy
}>()
const policy = computed(() => rules.value.skillParameters ?? {})
const groupId = ref('')
const groupInput = ref('')
const selected = ref('')
const singleInput = ref('')
const manual = ref({ skill: '', useId: '', parameter: '' })
const issue = ref('')
const previous = computed(() => {
  if (!props.catalog) return new Map<string, number>()
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
  if (!props.catalog) return undefined
  try {
    return { rows: resolveSkillParameters(props.catalog, props.previewPolicy ?? policy.value) }
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
function resetGroupSelection(value = '') {
  groupInput.value = value
  selected.value = ''
}
function selectGroup(id: string, value: string) {
  groupId.value = id
  resetGroupSelection(value)
}
function setGroup(remove = false) {
  const id = groupId.value.trim()
  if (!id) return
  const groups = { ...policy.value.groups }
  if (remove) delete groups[id]
  else {
    if (groupInput.value === '' || !Number.isFinite(Number(groupInput.value))) {
      issue.value = '请输入组值'
      return
    }
    groups[id] = Number(groupInput.value)
  }
  const next = { ...policy.value }
  if (Object.keys(groups).length) next.groups = groups
  else delete next.groups
  update(next)
}
function applyOverride() {
  const target = props.catalog ? member.value : manualTarget.value
  if (target) setOverride(target)
}
function setOverride(row: { skill: string; useId: string; parameter: string }, remove = false) {
  const key = skillParameterKey(row)
  const overrides = (policy.value.overrides ?? []).filter(entry => skillParameterKey(entry) !== key)
  if (!remove) {
    if (singleInput.value === '' || !Number.isFinite(Number(singleInput.value))) {
      issue.value = '请输入单招数值'
      return
    }
    overrides.push({ skill: row.skill, useId: row.useId, parameter: row.parameter, value: Number(singleInput.value) })
  }
  const next = { ...policy.value }
  if (overrides.length) next.overrides = overrides
  else delete next.overrides
  update(next)
}
</script>

<template>
  <details>
    <summary>技能数值</summary>
    <label
      >数值方案
      <input
        list="skill-parameter-profiles"
        :value="policy.profile ?? ''"
        placeholder="内容基础值"
        @change="selectProfile(($event.target as HTMLInputElement).value.trim())"
      />
    </label>
    <datalist id="skill-parameter-profiles">
      <option v-for="row in catalog?.profiles" :key="row.id" :value="row.id">{{ row.name }}</option>
    </datalist>
    <div class="field-row">
      <label
        >参数组 <input v-model.trim="groupId" list="skill-parameter-groups" @input="resetGroupSelection()"
      /></label>
      <datalist id="skill-parameter-groups">
        <option v-for="row in catalog?.groups" :key="row.id" :value="row.id">{{ row.name }} · {{ row.unit }}</option>
      </datalist>
      <label
        >组值
        <input v-model="groupInput" type="number" step="any" :placeholder="String(policy.groups?.[groupId] ?? '')"
      /></label>
      <button type="button" :disabled="!groupId || groupInput === ''" @click="setGroup()">设置组值</button>
      <button type="button" :disabled="policy.groups?.[groupId] === undefined" @click="setGroup(true)">跟随方案</button>
    </div>
    <ul v-if="policy.groups">
      <li v-for="(value, id) in policy.groups" :key="id">
        <button type="button" @click="selectGroup(String(id), String(value))">{{ id }} · {{ value }}</button>
      </li>
    </ul>
    <div class="field-row">
      <label v-if="catalog"
        >单招参数
        <select v-model="selected" @change="singleInput = ''">
          <option value="">选择技能及使用位置</option>
          <option v-for="row in members" :key="skillParameterKey(row)" :value="skillParameterKey(row)">
            {{ row.skill }} · {{ row.useId }} / {{ row.parameter }}
          </option>
        </select></label
      >
      <template v-else>
        <label>技能 ID <input v-model.trim="manual.skill" /></label>
        <label>使用位置 <input v-model.trim="manual.useId" /></label>
        <label>参数名 <input v-model.trim="manual.parameter" /></label>
      </template>
      <label>单招数值 <input v-model="singleInput" type="number" step="any" /></label>
      <button type="button" :disabled="!(catalog ? member : manualTarget) || singleInput === ''" @click="applyOverride">
        固定此招
      </button>
    </div>
    <ul v-if="policy.overrides?.length">
      <li v-for="row in policy.overrides" :key="skillParameterKey(row)">
        {{ row.skill }} · {{ row.useId }} / {{ row.parameter }} · {{ row.value }}
        <button type="button" @click="setOverride(row, true)">恢复跟随</button>
      </li>
    </ul>
    <p v-if="issue || preview?.error" role="alert">{{ issue || preview?.error }}</p>
    <details v-if="preview?.rows?.length">
      <summary>按上次准备的内容预览</summary>
      <ul>
        <li v-for="row in preview.rows.filter(row => !groupId || row.group === groupId)" :key="skillParameterKey(row)">
          {{ row.skill }} · {{ row.useId }} / {{ row.parameter }} ·
          <template v-if="previous.get(skillParameterKey(row)) !== row.value"
            >{{ previous.get(skillParameterKey(row)) }} → </template
          >{{ row.value }}（{{ sourceNames[row.source] }}）
        </li>
      </ul>
    </details>
  </details>
</template>
