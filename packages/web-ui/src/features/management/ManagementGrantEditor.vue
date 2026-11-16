<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElButton, ElCheckbox, ElCheckboxGroup } from 'element-plus'
import type { ManagementGrant } from '@/types/management'
import { managementActionLabels, managementScopeActions } from './managementPermissions'
const props = defineProps<{
  grant: ManagementGrant
  busy: boolean
  allowedActions: string[]
}>()
const emit = defineEmits<{ save: [grant: ManagementGrant, actions: string[]] }>()
const editing = ref(false)
const actions = ref<string[]>([])
const revision = ref<number>(0)
const stale = computed(() => editing.value && props.grant.revision !== revision.value)
function edit() {
  actions.value = [...props.grant.actions]
  revision.value = props.grant.revision
  editing.value = true
}
function save() {
  if (stale.value || props.busy) return
  emit('save', { ...props.grant, revision: revision.value }, [...actions.value])
}
</script>
<template>
  <template v-if="editing">
    <ElCheckboxGroup v-model="actions" :disabled="busy || stale">
      <ElCheckbox
        v-for="action in managementScopeActions[grant.scope.kind]"
        :key="action"
        :value="action"
        :disabled="!allowedActions.includes(action)"
      >
        {{ managementActionLabels[action] }}
      </ElCheckbox>
    </ElCheckboxGroup>
    <p v-if="stale" role="alert">授权已变更，请重新编辑。</p>
    <ElButton :disabled="busy || stale || !actions.length" @click="save">保存权限</ElButton>
    <ElButton :disabled="busy" @click="editing = false">关闭</ElButton>
  </template>
  <ElButton v-else :disabled="busy || !allowedActions.includes('grants.manage')" @click="edit">编辑权限</ElButton>
</template>
