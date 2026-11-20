<script setup lang="ts">
import { ElSelect, ElOption } from 'element-plus'
import { computed, provide, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { getBackendOrigin } from '@/bootstrap/deployment'
import { usePrivateRoomStore } from '@/stores/privateRoom'
import { isStaticMode } from '@/utils/env'
import { hasPreparedWebEnvironment } from '@/services/preparedWebEnvironment'
import PublicEnvironments from './PublicEnvironments.vue'
import ContentPackagesPanel from './ContentPackagesPanel.vue'
import LocalEnvironmentPage from './LocalEnvironmentPage.vue'
import ServerEnvironmentPanel from './ServerEnvironmentPanel.vue'
import { environmentDraftsKey, discardEnvironmentChanges } from './unsavedEnvironment'
const drafts = new Set<() => boolean>()
provide(environmentDraftsKey, drafts)
const hasDraft = () => [...drafts].some(isDirty => isDirty())
const allowLeave = () => !hasDraft() || discardEnvironmentChanges()
onBeforeRouteLeave(allowLeave)
onBeforeRouteUpdate((to, from) => locationFor(to.query.target) === locationFor(from.query.target) || allowLeave())
function beforeUnload(event: BeforeUnloadEvent) {
  if (hasDraft()) {
    event.preventDefault()
    event.returnValue = ''
  }
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
const route = useRoute()
const router = useRouter()
const rooms = usePrivateRoomStore()
const local = !!(window.arcadiaDesktop?.localEnvironment || window.arcadiaDesktop?.listContentPackages)
const bundled = !local && hasPreparedWebEnvironment()
const serverLabel = isStaticMode ? '' : new URL(getBackendOrigin()).host
function locationFor(value: unknown) {
  if (bundled && (value === 'web' || isStaticMode)) return 'web'
  if ((value === 'local' || value === 'host') && local) return 'local'
  if (value === 'room' && rooms.currentRoom) return 'room'
  // Explicit remote URLs never fall back to the local bridge.
  if (value) return 'server'
  return local ? 'local' : 'server'
}
const target = computed(() => locationFor(route.query.target))
const showLocations = computed(() => Number(local || bundled) + Number(!isStaticMode) + Number(!!rooms.currentRoom) > 1)
async function navigate(nextTarget: string) {
  await router.replace({ path: '/environments', query: { target: nextTarget } })
}
</script>
<template>
  <main class="environment-hub">
    <header class="hub-heading">
      <h1>环境</h1>
      <label v-if="showLocations"
        >位置
        <ElSelect :model-value="target" aria-label="环境位置" class="target-select" @change="value => navigate(value)">
          <ElOption v-if="bundled" value="web" label="网页内置" />
          <ElOption v-if="local" value="local" label="本机" />
          <ElOption v-if="!isStaticMode" value="server" :label="`服务器 · ${serverLabel}`" />
          <ElOption v-if="rooms.currentRoom" value="room" label="当前房间" />
        </ElSelect>
      </label>
    </header>
    <div :key="target" class="hub-body">
      <PublicEnvironments v-if="target === 'web'" bundled />
      <LocalEnvironmentPage v-else-if="target === 'local'" />
      <ServerEnvironmentPanel v-else-if="target === 'server'" target="server" />
      <ContentPackagesPanel v-else :location="target" />
    </div>
  </main>
</template>
<style scoped>
.environment-hub {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--el-text-color-primary);
  background: var(--el-bg-color-page);
}
.hub-heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 20px;
}
.hub-heading h1 {
  font-size: 22px;
  font-weight: 600;
  margin-right: auto;
}
.hub-heading label {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.target-select {
  width: 240px;
  max-width: 60vw;
}
.hub-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.hub-body > :deep(.local-environments) {
  height: auto;
  min-height: 0;
  padding: 0 20px 20px;
}
</style>
