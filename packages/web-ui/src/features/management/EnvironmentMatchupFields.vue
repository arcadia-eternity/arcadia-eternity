<script setup lang="ts">
import { environmentName } from '@/i18n/environment'
import { computed, ref } from 'vue'
import { resolveElementChart, type ElementDefinition, type MatchupTable } from '@arcadia-eternity/const'
import type { EnvironmentRules } from '@arcadia-eternity/protocol'

const rules = defineModel<EnvironmentRules>({ required: true })
const props = defineProps<{
  previewPolicy?: EnvironmentRules['matchups']
  catalog?: { elements: ElementDefinition[]; matchupTables: MatchupTable[] }
}>()
const attack = ref('')
const defense = ref('')
const input = ref('')
const issue = ref('')
const policy = computed(() => rules.value.matchups ?? {})
const preview = computed(() => {
  if (!props.catalog) return undefined
  try {
    return resolveElementChart(props.catalog, props.previewPolicy ?? policy.value)
  } catch {
    return undefined
  }
})
const cell = computed(() =>
  policy.value.adjustments?.find(cell => cell.attack === attack.value && cell.defense === defense.value),
)
const conflict = computed(() =>
  preview.value?.conflicts.find(row => row.attack === attack.value && row.defense === defense.value),
)
const known = computed(
  () =>
    props.catalog?.elements.some(el => el.id === attack.value) &&
    props.catalog.elements.some(el => el.id === defense.value),
)
const sources = computed(() => preview.value?.sources.get(attack.value + '>' + defense.value))
function setTable(table: string) {
  const next = { ...policy.value }
  if (table) next.table = table
  else delete next.table
  rules.value = { ...rules.value, schemaVersion: 2, matchups: next }
}
function pick(a: string, d: string) {
  attack.value = a
  defense.value = d
  input.value = ''
  issue.value = ''
}
function setCell(value?: number) {
  if (
    !attack.value.trim() ||
    !defense.value.trim() ||
    (value !== undefined && (!Number.isFinite(value) || value < 0))
  ) {
    issue.value = '请填写攻守属性和有效倍率'
    return
  }
  const a = attack.value.trim(),
    d = defense.value.trim()
  const adjustments = (policy.value.adjustments ?? []).filter(item => item.attack !== a || item.defense !== d)
  if (value !== undefined) adjustments.push({ attack: a, defense: d, multiplier: value })
  const next = { ...policy.value }
  if (adjustments.length) next.adjustments = adjustments
  else delete next.adjustments
  rules.value = { ...rules.value, schemaVersion: 2, matchups: next }
  pick(a, d)
}
</script>

<template>
  <details>
    <summary>属性相克</summary>
    <label
      >基础相克表
      <input
        list="environment-tables"
        :value="policy.table"
        placeholder="默认表"
        @change="setTable(($event.target as HTMLInputElement).value.trim())"
      />
    </label>
    <datalist id="environment-tables">
      <option v-for="table in catalog?.matchupTables" :key="table.id" :value="table.id">
        {{ environmentName('matchupTables', table.id, table.name) }}
      </option>
    </datalist>
    <datalist id="environment-elements">
      <option v-for="element in catalog?.elements" :key="element.id" :value="element.id">
        {{ environmentName('elements', element.id, element.name) }}
      </option>
    </datalist>
    <div class="field-row">
      <label>攻击属性 <input v-model.trim="attack" list="environment-elements" @input="input = ''" /></label>
      <label>防守属性 <input v-model.trim="defense" list="environment-elements" @input="input = ''" /></label>
    </div>
    <p v-if="conflict">来源冲突 · {{ conflict.proposals.map(row => row.source + ' ' + row.value + '×').join('，') }}</p>
    <p v-else-if="known && preview">
      倍率 {{ preview.values[attack]?.[defense] ?? 1 }}× · {{ cell ? '环境覆盖' : sources?.join('，') || '默认中性' }}
    </p>
    <div class="field-row">
      <label
        >本环境倍率
        <input
          v-model.trim="input"
          type="number"
          min="0"
          step="any"
          :placeholder="cell ? String(cell.multiplier) : undefined"
      /></label>
      <button type="button" :disabled="!attack || !defense || input === ''" @click="setCell(Number(input))">
        设置此格
      </button>
      <button type="button" :disabled="!cell" @click="setCell()">恢复继承</button>
    </div>
    <p v-if="issue" role="alert">{{ issue }}</p>
    <ul v-if="preview?.conflicts.length">
      <li v-for="row in preview.conflicts" :key="row.attack + '>' + row.defense">
        <button type="button" @click="pick(row.attack, row.defense)">
          解决冲突 · {{ row.attack }} → {{ row.defense }}
        </button>
      </li>
    </ul>
    <ul v-if="policy.adjustments?.length">
      <li v-for="row in policy.adjustments" :key="row.attack + '>' + row.defense">
        <button type="button" @click="pick(row.attack, row.defense)">
          {{ row.attack }} → {{ row.defense }} · {{ row.multiplier }}×
        </button>
      </li>
    </ul>
  </details>
</template>
