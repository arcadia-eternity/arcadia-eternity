<script setup lang="ts">
import { ElCard, ElFormItem, ElInputNumber, ElSelect, ElOption, ElButton } from 'element-plus'
import { environmentName } from '@/i18n/environment'
import { computed, ref } from 'vue'
import {
  elementMultiplier,
  resolveElementChart,
  type ElementDefinition,
  type MatchupTable,
} from '@arcadia-eternity/const'
import type { EnvironmentRules } from '@arcadia-eternity/protocol'

const rules = defineModel<EnvironmentRules>({ required: true })
const props = defineProps<{
  resolved?: EnvironmentRules
  catalog?: { elements: ElementDefinition[]; matchupTables: MatchupTable[] }
}>()
const attack = ref('')
const defense = ref('')
const input = ref<number | null>()
const issue = ref('')
const policy = computed(() => rules.value.matchups ?? {})
const preview = computed(() => {
  if (!props.catalog || !props.resolved) return undefined
  try {
    return { chart: resolveElementChart(props.catalog, props.resolved.matchups) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
})
const chart = computed(() => preview.value?.chart)
const cell = computed(() =>
  policy.value.adjustments?.find(cell => cell.attack === attack.value && cell.defense === defense.value),
)
const conflict = computed(() =>
  chart.value?.conflicts.find(row => row.attack === attack.value && row.defense === defense.value),
)
const known = computed(
  () =>
    props.catalog?.elements.some(el => el.id === attack.value) &&
    props.catalog.elements.some(el => el.id === defense.value),
)
const sources = computed(() => chart.value?.sources.get(attack.value + '>' + defense.value))
function setTable(table: string) {
  const next = { ...policy.value }
  if (table) next.table = table
  else delete next.table
  rules.value = { ...rules.value, schemaVersion: 2, matchups: next }
}
function pick(a: string, d: string) {
  attack.value = a
  defense.value = d
  input.value = undefined
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
  <ElCard shadow="never"
    ><template #header><h4>属性相克</h4></template>
    <ElFormItem label="基础相克表"
      ><ElSelect
        :model-value="resolved?.matchups?.table ?? policy.table ?? chart?.tableId"
        filterable
        :clearable="policy.table !== undefined"
        allow-create
        default-first-option
        aria-label="基础相克表"
        :placeholder="chart ? '无基础相克表' : '选择基础相克表'"
        @change="setTable(String($event ?? '').trim())"
      >
        <ElOption
          v-for="table in catalog?.matchupTables"
          :key="table.id"
          :value="table.id"
          :label="environmentName('matchupTables', table.id, table.name) + ' · ' + table.id"
        />
      </ElSelect>
    </ElFormItem>
    <div class="matchup-row">
      <ElFormItem label="攻击属性"
        ><ElSelect
          v-model="attack"
          filterable
          clearable
          allow-create
          default-first-option
          value-on-clear=""
          aria-label="攻击属性"
          @change="input = undefined"
        >
          <ElOption
            v-for="element in catalog?.elements"
            :key="element.id"
            :value="element.id"
            :label="environmentName('elements', element.id, element.name) + ' · ' + element.id"
          /> </ElSelect
      ></ElFormItem>
      <ElFormItem label="防守属性"
        ><ElSelect
          v-model="defense"
          filterable
          clearable
          allow-create
          default-first-option
          value-on-clear=""
          aria-label="防守属性"
          @change="input = undefined"
        >
          <ElOption
            v-for="element in catalog?.elements"
            :key="element.id"
            :value="element.id"
            :label="environmentName('elements', element.id, element.name) + ' · ' + element.id"
          /> </ElSelect
      ></ElFormItem>
    </div>
    <p v-if="conflict">来源冲突 · {{ conflict.proposals.map(row => row.source + ' ' + row.value + '×').join('，') }}</p>
    <p v-else-if="known && chart">
      倍率 {{ elementMultiplier(chart.values, attack, defense) }}× ·
      {{ cell ? '环境覆盖' : sources?.join('，') || '默认中性' }}
    </p>
    <div class="matchup-row">
      <ElFormItem label="本环境倍率">
        <ElInputNumber
          v-model="input"
          :min="0"
          :step="0.25"
          controls-position="right"
          :placeholder="cell ? String(cell.multiplier) : undefined"
      /></ElFormItem>
      <ElButton
        native-type="button"
        :disabled="!attack || !defense || input == null"
        @click="input != null && setCell(input)"
      >
        设置此格
      </ElButton>
      <ElButton native-type="button" :disabled="!cell" @click="setCell()">恢复基础倍率</ElButton>
    </div>
    <p v-if="issue || preview?.error" role="alert">{{ issue || preview?.error }}</p>
    <ul v-if="chart?.conflicts.length">
      <li v-for="row in chart.conflicts" :key="row.attack + '>' + row.defense">
        <ElButton native-type="button" @click="pick(row.attack, row.defense)">
          解决冲突 · {{ row.attack }} → {{ row.defense }}
        </ElButton>
      </li>
    </ul>
    <ul v-if="policy.adjustments?.length">
      <li v-for="row in policy.adjustments" :key="row.attack + '>' + row.defense">
        <ElButton native-type="button" @click="pick(row.attack, row.defense)">
          {{ row.attack }} → {{ row.defense }} · {{ row.multiplier }}×
        </ElButton>
      </li>
    </ul>
  </ElCard>
</template>

<style scoped>
.matchup-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  margin: 12px 0;
}
.matchup-row > .el-form-item {
  flex: 1 1 11rem;
  min-width: 0;
  margin: 0;
}
</style>
