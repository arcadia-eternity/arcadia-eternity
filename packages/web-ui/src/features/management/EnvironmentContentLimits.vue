<script setup lang="ts">
import { ElButton, ElCard, ElFormItem } from 'element-plus'
import type { EnvironmentRules, ManagedEnvironmentDocument } from '@arcadia-eternity/protocol'
import EnvironmentIdList from './EnvironmentIdList.vue'
import type { ReferenceOptions } from './environmentReferences'

const rules = defineModel<ManagedEnvironmentDocument['rules']>({ required: true })
const props = defineProps<{ options: ReferenceOptions; resolved?: EnvironmentRules }>()
const labels = { species: '精灵', skills: '技能', marks: '印记' }
const sides = { allow: '允许名单', deny: '禁止名单' }
type Kind = keyof typeof labels
type Side = keyof typeof sides

function update(side: Side, kind: Kind, ids?: string[]) {
  const next = { ...rules.value }
  const lists: Partial<Record<Kind, string[]>> = { ...next[side] }
  if (ids === undefined) delete lists[kind]
  else lists[kind] = [...new Set(ids)]
  if (Object.keys(lists).length) next[side] = lists
  else delete next[side]
  rules.value = next
}
function effective(side: Side, kind: Kind) {
  return props.resolved ? props.resolved[side]?.[kind] : rules.value[side]?.[kind]
}
function emptyLabel(side: Side, kind: Kind) {
  if (side === 'deny') return '未禁用' + labels[kind]
  return effective(side, kind) === undefined ? '不限制' + labels[kind] : '全部' + labels[kind] + '均不允许'
}
</script>

<template>
  <ElCard
    v-for="(name, kind) in labels"
    :key="kind"
    shadow="never"
    class="content-limit"
    role="region"
    :aria-label="name + '限制'"
  >
    <template #header
      ><h4>{{ name }}</h4></template
    >
    <div class="limit-lists">
      <ElFormItem v-for="(label, side) in sides" :key="side" :label="label">
        <EnvironmentIdList
          :aria-label="name + label"
          :model-value="effective(side, kind)"
          :options="options[kind]"
          :placeholder="emptyLabel(side, kind)"
          @update:model-value="ids => update(side, kind, ids.length ? ids : undefined)"
        />
        <div class="list-actions">
          <ElButton v-if="rules[side]?.[kind] !== undefined" link type="primary" @click="update(side, kind)">
            恢复默认
          </ElButton>
          <ElButton v-if="side === 'allow' && effective(side, kind)?.length !== 0" link @click="update(side, kind, [])"
            >全部禁用</ElButton
          >
          <ElButton v-if="side === 'deny' && effective(side, kind)?.length" link @click="update(side, kind, [])"
            >清除禁用</ElButton
          >
        </div>
      </ElFormItem>
    </div>
  </ElCard>
</template>

<style scoped>
.limit-lists {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
  gap: 12px 20px;
}
.limit-lists :deep(.el-form-item) {
  min-width: 0;
  margin: 0;
}
.limit-lists :deep(.el-form-item__label) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.list-actions {
  display: flex;
  gap: 8px;
}
.list-actions:not(:empty) {
  margin-top: 6px;
}
</style>
