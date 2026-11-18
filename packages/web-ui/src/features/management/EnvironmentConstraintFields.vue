<script setup lang="ts">
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
type Field = { kind: Condition['kind']; ids: string; collections: string }
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
const collectionIds = ref('')
const collectionError = ref('')
const splitIds = (value: string) => value.split(/[，,\s]+/u).filter(Boolean)
function saveCollection(remove = false) {
  const id = collectionId.value.trim()
  const next = (rules.value.collections ?? []).filter(row => row.id !== id)
  if (!remove) next.push({ id, kind: collectionKind.value, ids: splitIds(collectionIds.value) })
  const result = ruleCollectionsSchema.safeParse(next)
  if (!result.success) {
    collectionError.value = '请检查集合 ID 与成员'
    return
  }
  const declaration = { ...rules.value, schemaVersion: 2 as const }
  if (next.length) declaration.collections = next
  else delete declaration.collections
  rules.value = declaration
  collectionError.value = collectionId.value = collectionIds.value = ''
}
function selectCollection(row: RuleCollection) {
  collectionId.value = row.id
  collectionKind.value = row.kind
  collectionIds.value = row.ids.join('，')
}
const choices = { species: '物种', skill: '装备技能', mark: '特性或纹章' }
const field = (): Field => ({ kind: 'species', ids: '', collections: '' })
function edit(row?: TeamConstraint, mode: 'local' | 'replace' | 'exception' = 'local') {
  editMode.value = mode
  const fields = (conditions: Condition[]) =>
    conditions.map(c => ({ kind: c.kind, ids: c.ids.join('，'), collections: c.fromCollections?.join('，') ?? '' }))
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
      ids: splitIds(c.ids),
      ...(c.collections.trim() && { fromCollections: splitIds(c.collections) }),
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
  <details>
    <summary>组合禁令与限额</summary>
    <details>
      <summary>具名集合</summary>
      <button v-for="row in rules.collections" :key="row.id" type="button" @click="selectCollection(row)">
        {{ row.id }}
      </button>
      <label>集合 ID <input v-model.trim="collectionId" /></label>
      <label
        >集合类型
        <select v-model="collectionKind">
          <option v-for="(name, key) in choices" :key="key" :value="key">{{ name }}</option>
        </select></label
      >
      <label>成员 ID <input v-model="collectionIds" /></label>
      <button type="button" @click="saveCollection()">保存集合</button>
      <button
        v-if="rules.collections?.some(row => row.id === collectionId)"
        type="button"
        @click="saveCollection(true)"
      >
        移除本地集合
      </button>
      <p v-if="collectionError" role="alert">{{ collectionError }}</p>
    </details>
    <ul v-if="inherited?.length">
      <li v-for="row in inherited" :key="row.id">
        {{ row.id }}
        <span v-if="rules.constraintEdits?.remove?.includes(row.id)">已移除</span>
        <template v-else>
          <button
            type="button"
            @click="edit(rules.constraintEdits?.replace?.find(item => item.id === row.id) ?? row, 'replace')"
          >
            替换规则及豁免
          </button>
          <button v-if="row.kind === 'ban'" type="button" @click="edit(row, 'exception')">追加豁免</button>
          <button type="button" @click="changeTarget(row.id, { remove: true })">移除继承规则及豁免</button>
        </template>
        <button
          v-if="
            rules.constraintEdits?.remove?.includes(row.id) ||
            rules.constraintEdits?.replace?.some(item => item.id === row.id) ||
            rules.constraintEdits?.exceptions?.some(item => item.target === row.id)
          "
          type="button"
          @click="changeTarget(row.id)"
        >
          恢复继承规则
        </button>
      </li>
    </ul>
    <ul>
      <li v-for="row in rows" :key="row.id">
        <button type="button" @click="edit(row)">
          {{ row.id }} ·
          {{ row.kind === 'memberLimit' ? '最多 ' + row.max + ' 只' : row.scope === 'pet' ? '单宠禁令' : '全队禁令' }}
        </button>
        <button type="button" @click="remove(row.id)">移除规则</button>
      </li>
    </ul>
    <button v-if="!allOf.length" type="button" @click="edit()">添加组合规则</button>
    <div v-else>
      <label>规则 ID <input v-model.trim="id" :readonly="editMode !== 'local'" /></label>
      <label
        >限制方式
        <select v-model="kind">
          <option value="pet">单宠禁令</option>
          <option value="team">全队禁令</option>
          <option value="memberLimit">成员限额</option>
        </select></label
      >
      <label v-if="kind === 'memberLimit'"
        >最多几只 <input v-model.number="count" type="number" min="0" max="100"
      /></label>
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
          <select v-model="item.kind" aria-label="条件类型">
            <option v-for="(name, key) in choices" :key="key" :value="key">{{ name }}</option>
          </select>
          <label>引用集合 <input v-model.trim="item.collections" /></label>
          <label>任一内容 ID <input v-model.trim="item.ids" placeholder="多个 ID 用逗号分隔" /></label>
          <button type="button" :disabled="group === allOf && group.length === 1" @click="group.splice(i, 1)">
            移除条件
          </button>
        </div>
        <button type="button" @click="group.push(field())">添加条件</button>
      </fieldset>
      <p v-if="issue" role="alert">{{ issue }}</p>
      <button type="button" @click="apply">应用组合规则</button>
      <button type="button" @click="allOf = []">取消</button>
    </div>
  </details>
</template>
