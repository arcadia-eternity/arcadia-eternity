<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDrawer, ElSkeleton } from 'element-plus'
import { useManagementController } from '@/features/management/useManagementController'
import { Refresh } from '@element-plus/icons-vue'
import ManagementEnvironments from '@/features/management/ManagementEnvironments.vue'
import ManagementTasks from '@/features/management/ManagementTasks.vue'
import PublicEnvironments from './PublicEnvironments.vue'
import EnvironmentServerUsage from '@/features/management/EnvironmentServerUsage.vue'
import '@/features/management/managementStyles'
import '@/features/management/management.css'
import { managedLocation, type EnvironmentLocation } from './environmentGroups'
const editRequested = defineModel<boolean>('editRequested', { default: false })
const emit = defineEmits<{ catalog: [rows: EnvironmentLocation[]]; busy: [value: boolean]; select: [key: string] }>()
const props = defineProps<{
  target: 'local' | 'server'
  relatedEnvironmentId?: string
  bindingsOnly?: boolean
  environmentId?: string
  selection?: string | null
}>()
// This component is remounted by the hub when its target changes.
const controller = useManagementController(
  { initialTarget: props.target, initialTab: 'environments', scope: 'content' },
  () => {},
)
const { isAdministrator, loginRequired, error, notice, busy, loading, initialized, state, tab, activeOperations } =
  controller
const managed = computed(() => initialized.value && isAdministrator.value && !loginRequired.value)
const publicRows = ref<EnvironmentLocation[]>([])
const managedEntries = computed(() =>
  controller.environments.value.map(environment => ({
    ...managedLocation(environment, 'server', '服务器'),
    workspaceId: state.workspaceId.value,
    serverId: controller.server.value?.id,
  })),
)
watch(
  () => (managed.value ? managedEntries.value : publicRows.value),
  rows => emit('catalog', rows),
  { immediate: true },
)
watch(busy, value => emit('busy', value), { immediate: true })
const tasksOpen = ref(false)
watch(tab, value => {
  if (value === 'tasks') {
    tasksOpen.value = true
    tab.value = 'environments'
  }
})
</script>
<template>
  <section v-show="selection !== null" class="server-content" aria-label="服务器环境">
    <ElSkeleton v-if="!initialized" :rows="8" animated aria-label="正在加载环境" />
    <ElAlert v-if="error && !loginRequired" type="error" :title="error" :closable="false" show-icon role="alert" />
    <ElAlert v-if="notice" type="success" :title="notice" :closable="false" show-icon role="status" />
    <template v-if="initialized && isAdministrator && !loginRequired">
      <EnvironmentServerUsage
        v-if="bindingsOnly && environmentId"
        :controller="controller"
        :environment-id="environmentId"
      />
      <ManagementEnvironments
        v-else-if="selection !== null"
        :key="selection"
        :controller="controller"
        @navigate="key => emit('select', key)"
        v-model:edit-requested="editRequested"
        :hide-navigation="selection !== undefined"
        :navigation="selection !== undefined ? { entries: managedEntries, selected: selection } : undefined"
      >
        <template #toolbar>
          <ElButton @click="tasksOpen = true">任务{{ activeOperations ? `（${activeOperations}）` : '' }}</ElButton>
          <ElButton :icon="Refresh" :disabled="busy" :loading="loading" @click="state.refresh">刷新</ElButton>
        </template>
      </ManagementEnvironments>
      <ElDrawer v-if="!bindingsOnly" v-model="tasksOpen" title="环境任务" size="min(860px, 100vw)" append-to-body
        ><ManagementTasks :controller="controller" content-only
      /></ElDrawer>
    </template>
    <PublicEnvironments
      v-else-if="initialized && target === 'server'"
      :selection="selection"
      @catalog="publicRows = $event"
    />
    <RouterLink v-else-if="initialized && !loading" to="/servers">启动本机服务器</RouterLink>
  </section>
  <EnvironmentServerUsage
    v-if="managed && selection === null && relatedEnvironmentId"
    class="server-content"
    :controller="controller"
    :environment-id="relatedEnvironmentId"
  />
</template>
<style scoped>
.server-content {
  min-width: 0;
}
.server-content > .el-alert {
  margin-bottom: 12px;
}
</style>
