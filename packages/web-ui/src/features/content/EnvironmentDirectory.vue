<script setup lang="ts">
import { computed } from 'vue'
import { ElButton } from 'element-plus'
import { groupEnvironments, type EnvironmentLocation } from './environmentGroups'
const props = defineProps<{ entries: EnvironmentLocation[]; selected?: string; busy?: boolean }>()
const emit = defineEmits<{ select: [key: string, edit?: boolean] }>()
const groups = computed(() => groupEnvironments(props.entries, entry => entry.id))
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
  const entry = group.find(row => row.editable) ?? group[0]
  emit('select', entry.key)
}
</script>
<template>
  <div class="environment-directory">
    <nav aria-label="选择环境">
      <ElButton
        v-for="[id, group] in groups"
        :key="id"
        :disabled="busy"
        :aria-current="active?.id === id ? 'true' : undefined"
        @click="selectGroup(group)"
      >
        <strong>{{ group[0].name }}</strong>
        <small v-if="group.some(entry => entry.current)">本地使用中</small>
      </ElButton>
    </nav>
    <div v-if="otherEditors.length" class="edits">
      <ElButton v-for="entry in otherEditors" :key="entry.key" :disabled="busy" @click="emit('select', entry.key, true)"
        >编辑{{ entry.source }}副本</ElButton
      >
    </div>
  </div>
</template>
<style scoped>
.environment-directory {
  min-width: 0;
}
nav,
.edits {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
button {
  height: auto;
  margin: 0;
  padding: 8px 12px;
  max-width: 100%;
}
nav :deep(.el-button > span) {
  display: grid;
  text-align: start;
  gap: 3px;
  white-space: normal;
  overflow-wrap: anywhere;
}
.edits {
  margin-block: 8px;
}
button[aria-current='true'] {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary);
}
</style>
