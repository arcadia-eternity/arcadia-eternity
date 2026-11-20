<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElButton, ElCard, ElIcon, ElInput } from 'element-plus'
import { Collection, Search } from '@element-plus/icons-vue'
import { groupEnvironments, resolveEnvironmentEntry, type EnvironmentLocation } from './environmentGroups'
const props = defineProps<{
  entries: EnvironmentLocation[]
  selected?: string
  busy?: boolean
  label?: string
  showSources?: boolean
}>()
const emit = defineEmits<{ select: [key: string, edit?: boolean] }>()
const groups = computed(() => groupEnvironments(props.entries, entry => entry.id))
const query = ref('')
const visibleGroups = computed(() => {
  const term = query.value.trim().toLowerCase()
  return [...groups.value].filter(([, rows]) =>
    rows.some(row =>
      [row.name, row.id, ...(row.sources ?? [row.source])].some(value => value.toLowerCase().includes(term)),
    ),
  )
})
const active = computed(() => props.entries.find(entry => entry.key === props.selected))
const otherEditors = computed(() => {
  const current = active.value
  if (!current) return []
  const owners = new Set([current.workspaceId ?? current.key])
  return (
    groups.value.get(current.id)?.filter(entry => {
      const owner = entry.workspaceId ?? entry.key
      if (!entry.editable || owners.has(owner)) return false
      owners.add(owner)
      return true
    }) ?? []
  )
})
function selectGroup(group: [EnvironmentLocation, ...EnvironmentLocation[]]) {
  if (active.value?.id === group[0].id) return
  const entry = resolveEnvironmentEntry(group, group[0].id) ?? group[0]
  emit('select', entry.key)
}
</script>
<template>
  <ElCard class="environment-directory" shadow="never">
    <template #header>
      <div class="directory-heading">
        <h2>环境列表</h2>
        <span>{{ groups.size }}</span>
      </div>
    </template>
    <ElInput
      v-if="groups.size > 6 || query"
      v-model="query"
      :prefix-icon="Search"
      clearable
      placeholder="搜索环境"
      aria-label="搜索环境"
    />
    <nav :aria-label="label ?? '选择环境'">
      <ElButton
        v-for="[id, group] in visibleGroups"
        :key="id"
        text
        :disabled="busy"
        :aria-current="active?.id === id ? 'true' : undefined"
        @click="selectGroup(group)"
      >
        <ElIcon><Collection /></ElIcon>
        <span class="row-text"
          ><strong>{{ active?.id === id ? active.name : group[0].name }}</strong>
          <small v-if="showSources">{{
            [...new Set(group.flatMap(entry => entry.sources ?? [entry.source]))].join(' · ')
          }}</small>
          <small v-if="group.some(entry => entry.current)">本地使用中</small>
        </span>
      </ElButton>
    </nav>
    <p v-if="query && !visibleGroups.length" role="status">没有匹配的环境</p>
    <div v-if="otherEditors.length" class="edits">
      <ElButton
        v-for="entry in otherEditors"
        :key="entry.key"
        link
        type="primary"
        :disabled="busy"
        @click="emit('select', entry.key, true)"
        >编辑{{ entry.source }}副本</ElButton
      >
    </div>
  </ElCard>
</template>

<style scoped>
.environment-directory {
  min-width: 0;
  --el-card-padding: 10px;
  --el-card-border-radius: 12px;
}
.directory-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px;
}
.directory-heading h2 {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}
.directory-heading span,
small,
p {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
nav {
  display: grid;
  gap: 3px;
  max-height: 58vh;
  overflow-y: auto;
}
nav > .el-button {
  justify-content: flex-start;
  width: 100%;
  height: auto;
  margin: 0;
  padding: 11px 10px;
  min-width: 0;
}
nav button[aria-current='true'] {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
nav :deep(.el-button > span) {
  max-width: 100%;
  gap: 10px;
}
.row-text {
  display: grid;
  text-align: start;
  white-space: normal;
  overflow-wrap: anywhere;
  gap: 4px;
}
.row-text strong {
  font-weight: 500;
}
.el-input {
  margin-bottom: 8px;
}
.edits {
  display: grid;
  justify-items: start;
  gap: 6px;
  margin-top: 8px;
  padding: 10px 6px 2px;
  border-top: 1px solid var(--el-border-color-lighter);
}
.edits > .el-button {
  margin: 0;
}
@media (max-width: 760px) {
  nav {
    max-height: 144px;
  }
}
</style>
