<script setup lang="ts">
import type { ReferenceOptions } from './environmentReferences'
import EnvironmentIdList from './EnvironmentIdList.vue'
import {
  ElCard,
  ElAlert,
  ElTable,
  ElTableColumn,
  ElFormItem,
  ElInput,
  ElSelect,
  ElOption,
  ElButton,
  ElInputNumber,
} from 'element-plus'
import { computed, ref } from 'vue'
import {
  declaredConstraintsSchema,
  ruleCollectionsSchema,
  type RuleCollection,
  type DeclaredTeamConstraint as TeamConstraint,
} from '@arcadia-eternity/const'
import type { ManagedEnvironmentDocument } from '@arcadia-eternity/protocol'

type Condition = TeamConstraint['allOf'][number]
type Field = { kind: Condition['kind']; ids: string[]; collections: string[] }
defineProps<{
  options: ReferenceOptions
}>()
const rules = defineModel<ManagedEnvironmentDocument['rules']>({ required: true })
const collections = computed(() => rules.value.collections ?? [])
const rows = computed(() => rules.value.constraints ?? [])
const id = ref('')
const originalId = ref('')
const kind = ref<'pet' | 'team' | 'memberLimit'>('pet')
const count = ref(1)
const allOf = ref<Field[]>([])
const exceptions = ref<Field[]>([])
const priorAlternatives = ref<TeamConstraint['allOf'][]>()
const issue = ref('')
const editingCollection = ref(false)
const collectionId = ref('')
const collectionKind = ref<RuleCollection['kind']>('species')
const collectionIds = ref<string[]>([])
const collectionError = ref('')
function resetCollection() {
  editingCollection.value = false
  collectionId.value = collectionError.value = ''
  collectionIds.value = []
  collectionKind.value = 'species'
}
function saveCollection(remove = false) {
  const id = collectionId.value.trim()
  if (!editingCollection.value && rules.value.collections?.some(row => row.id === id)) {
    collectionError.value = '集合 ID 已存在'
    return
  }
  const next = (rules.value.collections ?? []).filter(row => row.id !== id)
  if (!remove) next.push({ id, kind: collectionKind.value, ids: [...collectionIds.value] })
  const result = ruleCollectionsSchema.safeParse(next)
  if (!result.success) {
    collectionError.value = '请检查集合 ID 与成员'
    return
  }
  const declaration = { ...rules.value, schemaVersion: 2 as const }
  if (next.length) declaration.collections = next
  else delete declaration.collections
  rules.value = declaration
  resetCollection()
}
function selectCollection(row: RuleCollection) {
  editingCollection.value = true
  collectionError.value = ''
  collectionId.value = row.id
  collectionKind.value = row.kind
  collectionIds.value = [...row.ids]
}
const listKeys = { species: 'species', skill: 'skills', mark: 'marks' } as const
const choices = { species: '物种', skill: '装备技能', mark: '特性或纹章' }
const field = (): Field => ({ kind: 'species', ids: [], collections: [] })
function resetCondition(item: Field) {
  item.ids = []
  item.collections = []
}
function edit(row?: TeamConstraint) {
  const fields = (conditions: Condition[]) =>
    conditions.map(c => ({ kind: c.kind, ids: [...c.ids], collections: [...(c.fromCollections ?? [])] }))
  id.value = originalId.value = row?.id ?? ''
  kind.value = row?.kind === 'memberLimit' ? row.kind : (row?.scope ?? 'pet')
  count.value = row?.kind === 'memberLimit' ? row.max : 1
  allOf.value = row ? fields(row.allOf) : [field()]
  exceptions.value = row?.kind === 'ban' ? fields(row.exceptWhen ?? []) : []
  priorAlternatives.value = row?.kind === 'ban' ? row.exceptAny : undefined
  issue.value = ''
}
function saveRows(next: TeamConstraint[]) {
  const value = { ...rules.value, schemaVersion: 2 as const }
  if (next.length) value.constraints = next
  else delete value.constraints
  rules.value = value
}
function apply() {
  const conditions = (fields: Field[]): Condition[] =>
    fields.map(c => ({
      kind: c.kind,
      ids: [...c.ids],
      ...(c.collections.length > 0 && { fromCollections: [...c.collections] }),
    }))
  const common = { id: id.value.trim(), allOf: conditions(allOf.value) }
  const row: TeamConstraint =
    kind.value === 'memberLimit'
      ? { ...common, kind: 'memberLimit', max: count.value }
      : {
          ...common,
          kind: 'ban',
          scope: kind.value,
          ...(priorAlternatives.value && { exceptAny: priorAlternatives.value }),
          ...(exceptions.value.length && { exceptWhen: conditions(exceptions.value) }),
        }
  const next = originalId.value
    ? rows.value.map(old => (old.id === originalId.value ? row : old))
    : [...rows.value, row]
  const result = declaredConstraintsSchema.safeParse(next)
  if (!result.success) {
    issue.value = '请检查规则 ID、条件中的内容 ID 和成员数量'
    return
  }
  saveRows(result.data)
  allOf.value = []
}
function remove(id: string) {
  saveRows(rows.value.filter(row => row.id !== id))
  if (originalId.value === id) allOf.value = []
}
</script>

<template>
  <ElCard shadow="never">
    <template #header><h4>具名集合</h4></template>
    <ElTable v-if="collections.length" :data="collections" row-key="id" size="small">
      <ElTableColumn prop="id" label="集合 ID" min-width="100" />
      <ElTableColumn label="类型" width="100"
        ><template #default="{ row }">{{ choices[(row as RuleCollection).kind] }}</template></ElTableColumn
      >
      <ElTableColumn label="成员" width="62"
        ><template #default="{ row }">{{ row.ids.length }}</template></ElTableColumn
      >
      <ElTableColumn width="62"
        ><template #default="{ row }"
          ><ElButton link type="primary" @click="selectCollection(row as RuleCollection)">编辑</ElButton></template
        ></ElTableColumn
      >
    </ElTable>
    <div class="collection-fields">
      <ElFormItem label="集合 ID"><ElInput v-model.trim="collectionId" :readonly="editingCollection" /></ElFormItem>
      <ElFormItem label="集合类型"
        ><ElSelect v-model="collectionKind" @change="collectionIds = []">
          <ElOption v-for="(name, key) in choices" :key="key" :value="key" :label="name" /> </ElSelect
      ></ElFormItem>
    </div>
    <ElFormItem label="成员 ID"
      ><EnvironmentIdList :options="options[listKeys[collectionKind]]" v-model="collectionIds"
    /></ElFormItem>
    <ElAlert v-if="collectionError" :title="collectionError" type="error" :closable="false" />
    <ElButton type="primary" plain @click="saveCollection()">{{
      editingCollection ? '更新集合' : '添加集合'
    }}</ElButton>
    <ElButton v-if="editingCollection" @click="resetCollection">取消编辑</ElButton>
    <ElButton v-if="editingCollection" type="danger" link @click="saveCollection(true)">移除集合</ElButton>
  </ElCard>
  <ElCard shadow="never">
    <template #header><h4>组合禁令与限额</h4></template>
    <ul>
      <li v-for="row in rows" :key="row.id">
        <ElButton native-type="button" @click="edit(row)">
          {{ row.id }} ·
          {{ row.kind === 'memberLimit' ? '最多 ' + row.max + ' 只' : row.scope === 'pet' ? '单宠禁令' : '全队禁令' }}
        </ElButton>
        <ElButton native-type="button" @click="remove(row.id)">移除规则</ElButton>
      </li>
    </ul>
    <ElButton v-if="!allOf.length" native-type="button" @click="edit()">添加组合规则</ElButton>
    <div v-else>
      <ElFormItem label="规则 ID"><ElInput v-model.trim="id" /></ElFormItem>
      <ElFormItem label="限制方式"
        ><ElSelect v-model="kind">
          <ElOption value="pet" label="单宠禁令" />
          <ElOption value="team" label="全队禁令" />
          <ElOption value="memberLimit" label="成员限额" /> </ElSelect
      ></ElFormItem>
      <ElFormItem v-if="kind === 'memberLimit'" label="最多几只"
        ><ElInputNumber v-model="count" :value-on-clear="0" :min="0" :max="100"
      /></ElFormItem>
      <fieldset
        v-for="group in kind === 'memberLimit' ? [allOf] : [allOf, exceptions]"
        :key="group === allOf ? 'match' : 'except'"
      >
        <legend>{{ group === allOf ? '同时满足' : '豁免条件' }}</legend>
        <div v-for="(item, i) in group" :key="i">
          <ElSelect v-model="item.kind" aria-label="条件类型" @change="resetCondition(item)">
            <ElOption v-for="(name, key) in choices" :key="key" :value="key" :label="name" />
          </ElSelect>
          <ElFormItem label="引用集合"
            ><ElSelect
              v-model="item.collections"
              multiple
              filterable
              allow-create
              default-first-option
              placeholder="选择或输入集合 ID"
              ><ElOption
                v-for="row in collections.filter(row => row.kind === item.kind)"
                :key="row.id"
                :value="row.id"
                :label="row.id" /></ElSelect
          ></ElFormItem>
          <ElFormItem label="任一内容 ID"
            ><EnvironmentIdList :options="options[listKeys[item.kind]]" v-model="item.ids"
          /></ElFormItem>
          <ElButton native-type="button" :disabled="group === allOf && group.length === 1" @click="group.splice(i, 1)">
            移除条件
          </ElButton>
        </div>
        <ElButton native-type="button" @click="group.push(field())">添加条件</ElButton>
      </fieldset>
      <p v-if="issue" role="alert">{{ issue }}</p>
      <ElButton native-type="button" @click="apply">应用组合规则</ElButton>
      <ElButton native-type="button" @click="allOf = []">取消</ElButton>
    </div>
  </ElCard>
</template>

<style scoped>
.collection-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
  gap: 0 12px;
}
.el-table + .collection-fields {
  margin-top: 14px;
}
fieldset {
  min-width: 0;
  margin: 12px 0;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
}
</style>
