<script setup lang="ts">
import EnvironmentIdList from './EnvironmentIdList.vue'
import {
  ElCollapse,
  ElCollapseItem,
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
import type { ConstraintEdits } from '@arcadia-eternity/const'

type Condition = TeamConstraint['allOf'][number]
type Field = { kind: Condition['kind']; ids: string[]; collections: string[] }
const props = defineProps<{ inherited?: TeamConstraint[] }>()
const rules = defineModel<ManagedEnvironmentDocument['rules']>({ required: true })
const editMode = ref<'local' | 'replace' | 'exception'>('local')
const inheritedById = computed(() => new Map(props.inherited?.map(row => [row.id, row])))
const rows = computed(() => rules.value.constraints ?? [])
const id = ref('')
const originalId = ref('')
const kind = ref<'pet' | 'team' | 'memberLimit'>('pet')
const count = ref(1)
const allOf = ref<Field[]>([])
const exceptions = ref<Field[]>([])
const priorAlternatives = ref<TeamConstraint['allOf'][]>()
const issue = ref('')
const collectionId = ref('')
const collectionKind = ref<RuleCollection['kind']>('species')
const collectionIds = ref<string[]>([])
const collectionError = ref('')
function saveCollection(remove = false) {
  const id = collectionId.value.trim()
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
  collectionError.value = collectionId.value = ''
  collectionIds.value = []
}
function selectCollection(row: RuleCollection) {
  collectionId.value = row.id
  collectionKind.value = row.kind
  collectionIds.value = [...row.ids]
}
const choices = { species: '物种', skill: '装备技能', mark: '特性或纹章' }
const field = (): Field => ({ kind: 'species', ids: [], collections: [] })
function edit(row?: TeamConstraint, mode: 'local' | 'replace' | 'exception' = 'local') {
  editMode.value = mode
  const fields = (conditions: Condition[]) =>
    conditions.map(c => ({ kind: c.kind, ids: [...c.ids], collections: [...(c.fromCollections ?? [])] }))
  id.value = originalId.value = row?.id ?? ''
  kind.value = row?.kind === 'memberLimit' ? row.kind : (row?.scope ?? 'pet')
  count.value = row?.kind === 'memberLimit' ? row.max : 1
  allOf.value = row ? fields(row.allOf) : [field()]
  exceptions.value = mode === 'exception' ? [field()] : row?.kind === 'ban' ? fields(row.exceptWhen ?? []) : []
  priorAlternatives.value = row?.kind === 'ban' ? row.exceptAny : undefined
  issue.value = ''
}
function saveRows(next: TeamConstraint[]) {
  const value = { ...rules.value, schemaVersion: 2 as const }
  if (next.length) value.constraints = next
  else delete value.constraints
  rules.value = value
}
function changeTarget(
  id: string,
  update?: { replace?: TeamConstraint; remove?: boolean; exception?: TeamConstraint['allOf'] },
) {
  const current = rules.value.constraintEdits ?? {}
  const preserve = !!update?.exception
  const changes: ConstraintEdits = {
    replace: current.replace?.filter(row => preserve || row.id !== id),
    remove: current.remove?.filter(target => preserve || target !== id),
    exceptions: current.exceptions?.filter(row => preserve || row.target !== id),
    clearExceptions: current.clearExceptions?.filter(target => preserve || target !== id),
  }
  if (update?.remove) (changes.remove ??= []).push(id)
  if (update?.replace) (changes.replace ??= []).push(update.replace)
  if (update?.exception) (changes.exceptions ??= []).push({ target: id, allOf: update.exception })
  if (update?.remove || update?.replace) {
    const previous = inheritedById.value.get(id)
    if (previous?.kind === 'ban' && (previous.exceptWhen?.length || previous.exceptAny?.length))
      (changes.clearExceptions ??= []).push(id)
  }
  const declaration = { ...rules.value, schemaVersion: 2 as const }
  const nonempty = Object.fromEntries(Object.entries(changes).filter(([, values]) => values?.length))
  if (Object.keys(nonempty).length) declaration.constraintEdits = nonempty
  else delete declaration.constraintEdits
  rules.value = declaration
  allOf.value = []
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
  if (editMode.value !== 'local') {
    const checked = declaredConstraintsSchema.safeParse([row])
    if (!checked.success) {
      issue.value = '请检查条件与成员数量'
      return
    }
    if (editMode.value === 'replace') changeTarget(row.id, { replace: row })
    else {
      if (row.kind !== 'ban' || !row.exceptWhen?.length) {
        issue.value = '请选择豁免条件'
        return
      }
      changeTarget(row.id, { exception: row.exceptWhen })
    }
    return
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
  <ElCollapseItem name="constraints" title="组合禁令与限额">
    <ElCollapse
      ><ElCollapseItem name="collections" title="具名集合">
        <ElButton v-for="row in rules.collections" :key="row.id" native-type="button" @click="selectCollection(row)">
          {{ row.id }}
        </ElButton>
        <ElFormItem label="集合 ID"><ElInput v-model.trim="collectionId" /></ElFormItem>
        <ElFormItem label="集合类型"
          ><ElSelect v-model="collectionKind">
            <ElOption v-for="(name, key) in choices" :key="key" :value="key" :label="name" /> </ElSelect
        ></ElFormItem>
        <ElFormItem label="成员 ID"><EnvironmentIdList v-model="collectionIds" /></ElFormItem>
        <ElButton native-type="button" @click="saveCollection()">保存集合</ElButton>
        <ElButton
          v-if="rules.collections?.some(row => row.id === collectionId)"
          native-type="button"
          @click="saveCollection(true)"
        >
          移除本地集合
        </ElButton>
        <p v-if="collectionError" role="alert">{{ collectionError }}</p>
      </ElCollapseItem></ElCollapse
    >
    <ul v-if="inherited?.length">
      <li v-for="row in inherited" :key="row.id">
        {{ row.id }}
        <span v-if="rules.constraintEdits?.remove?.includes(row.id)">已移除</span>
        <template v-else>
          <ElButton
            native-type="button"
            @click="edit(rules.constraintEdits?.replace?.find(item => item.id === row.id) ?? row, 'replace')"
          >
            替换规则及豁免
          </ElButton>
          <ElButton v-if="row.kind === 'ban'" native-type="button" @click="edit(row, 'exception')">追加豁免</ElButton>
          <ElButton native-type="button" @click="changeTarget(row.id, { remove: true })">移除继承规则及豁免</ElButton>
        </template>
        <ElButton
          v-if="
            rules.constraintEdits?.remove?.includes(row.id) ||
            rules.constraintEdits?.replace?.some(item => item.id === row.id) ||
            rules.constraintEdits?.exceptions?.some(item => item.target === row.id)
          "
          native-type="button"
          @click="changeTarget(row.id)"
        >
          恢复继承规则
        </ElButton>
      </li>
    </ul>
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
      <ElFormItem label="规则 ID"><ElInput v-model.trim="id" :readonly="editMode !== 'local'" /></ElFormItem>
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
        v-for="group in editMode === 'exception'
          ? [exceptions]
          : kind === 'memberLimit'
            ? [allOf]
            : [allOf, exceptions]"
        :key="group === allOf ? 'match' : 'except'"
      >
        <legend>{{ group === allOf ? '同时满足' : '豁免条件' }}</legend>
        <div v-for="(item, i) in group" :key="i">
          <ElSelect v-model="item.kind" aria-label="条件类型">
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
                v-for="row in rules.collections?.filter(row => row.kind === item.kind)"
                :key="row.id"
                :value="row.id"
                :label="row.id" /></ElSelect
          ></ElFormItem>
          <ElFormItem label="任一内容 ID"><EnvironmentIdList v-model="item.ids" /></ElFormItem>
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
  </ElCollapseItem>
</template>
