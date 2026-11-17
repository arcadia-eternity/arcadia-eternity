<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElButton, ElDrawer, ElSkeleton } from 'element-plus'
import { useManagementController } from '@/features/management/useManagementController'
import ManagementLogin from '@/features/management/ManagementLogin.vue'
import ManagementEnvironments from '@/features/management/ManagementEnvironments.vue'
import ManagementTasks from '@/features/management/ManagementTasks.vue'
import PublicEnvironments from './PublicEnvironments.vue'
import EnvironmentServerUsage from '@/features/management/EnvironmentServerUsage.vue'
import '@/features/management/managementStyles'
import '@/features/management/management.css'
const props = defineProps<{ target: 'local' | 'server'; bindingsOnly?: boolean; environmentId?: string }>()
// This component is remounted by the hub when its target changes.
const controller = useManagementController(
  { initialTarget: props.target, initialTab: 'environments', scope: 'content' },
  () => {},
)
const {
  isAdministrator,
  loginRequired,
  error,
  notice,
  busy,
  loading,
  initialized,
  state,
  tab,
  logout,
  activeOperations,
} = controller
const loginOpen = ref(false)
const tasksOpen = ref(false)
watch(tab, value => {
  if (value === 'tasks') {
    tasksOpen.value = true
    tab.value = 'environments'
  }
})
watch(isAdministrator, allowed => {
  if (allowed) loginOpen.value = false
})
</script>
<template>
  <section class="server-content" aria-label="服务器环境">
    <ElSkeleton v-if="!initialized" :rows="8" animated aria-label="正在加载环境" />
    <div v-if="initialized && !bindingsOnly" class="actions">
      <template v-if="isAdministrator && !loginRequired">
        <ElButton @click="tasksOpen = true">任务{{ activeOperations ? `（${activeOperations}）` : '' }}</ElButton>
        <ElButton :disabled="busy" :loading="loading" @click="state.refresh">刷新</ElButton>
        <ElButton v-if="target === 'server'" @click="logout">退出管理</ElButton>
      </template>
      <ElButton v-else-if="target === 'server'" @click="loginOpen = !loginOpen">{{
        loginOpen ? '返回浏览' : '管理员登录'
      }}</ElButton>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <template v-if="initialized && isAdministrator && !loginRequired">
      <EnvironmentServerUsage
        v-if="bindingsOnly && environmentId"
        :controller="controller"
        :environment-id="environmentId"
      />
      <ManagementEnvironments v-else :controller="controller" />
      <ElDrawer v-if="!bindingsOnly" v-model="tasksOpen" title="环境任务" size="min(860px, 100vw)" append-to-body
        ><ManagementTasks :controller="controller" content-only
      /></ElDrawer>
    </template>
    <template v-else-if="initialized && target === 'server'">
      <ManagementLogin v-if="loginOpen" :controller="controller" account-return-to="/account?returnTo=environments" />
      <PublicEnvironments v-else />
    </template>
    <RouterLink v-else-if="initialized && !loading" to="/servers">启动本机服务器</RouterLink>
  </section>
</template>
<style scoped>
.server-content {
  padding: 0 20px 20px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}
.actions :deep(.el-button) {
  margin-left: 0;
}
.server-content :deep(.environment-workspace) {
  margin-top: 16px;
}
</style>
