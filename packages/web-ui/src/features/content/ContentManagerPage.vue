<script setup lang="ts">
import { computed, provide, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { getBackendOrigin } from '@/bootstrap/deployment'
import { usePrivateRoomStore } from '@/stores/privateRoom'
import { isStaticMode } from '@/utils/env'
import ContentPackagesPanel from './ContentPackagesPanel.vue'
import ContentProjectsPanel from './ContentProjectsPanel.vue'
import LocalEnvironmentPage from './LocalEnvironmentPage.vue'
import ServerEnvironmentPanel from './ServerEnvironmentPanel.vue'
import { environmentDraftsKey, discardEnvironmentChanges } from './unsavedEnvironment'
const drafts = new Set<() => boolean>()
provide(environmentDraftsKey, drafts)
const hasDraft = () => [...drafts].some(isDirty => isDirty())
const allowLeave = () => !hasDraft() || discardEnvironmentChanges()
onBeforeRouteLeave(allowLeave)
onBeforeRouteUpdate((to, from) =>
  to.query.target === from.query.target && to.query.tab === from.query.tab ? true : allowLeave(),
)
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
const serverLabel = isStaticMode ? '' : new URL(getBackendOrigin()).host
const target = computed(() => {
  const value = route.query.target
  if (value === 'local' && local) return 'local'
  if (value === 'room' && rooms.currentRoom) return 'room'
  // Explicit remote URLs never fall back to the local bridge.
  if (value) return 'server'
  return local ? 'local' : 'server'
})
const tab = computed(() => (route.query.tab === 'environments' ? 'environments' : 'packages'))
async function navigate(nextTarget: string, nextTab = tab.value) {
  await router.replace({ path: '/content', query: { target: nextTarget, tab: nextTab } })
}
</script>
<template>
  <main class="content-hub">
    <header class="hub-heading">
      <h1>内容包</h1>
      <label
        >位置
        <select
          :value="target"
          aria-label="内容位置"
          @change="
            async event => {
              const select = event.target as HTMLSelectElement
              await navigate(select.value)
              select.value = target
            }
          "
        >
          <option v-if="local" value="local">本机</option>
          <option v-if="!isStaticMode" value="server">服务器 · {{ serverLabel }}</option>
          <option v-if="rooms.currentRoom" value="room">当前房间</option>
        </select>
      </label>
    </header>
    <nav class="hub-tabs" aria-label="内容分类">
      <button :aria-current="tab === 'packages' ? 'page' : undefined" @click="navigate(target, 'packages')">
        内容包
      </button>
      <button
        v-if="target !== 'room'"
        :aria-current="tab === 'environments' ? 'page' : undefined"
        @click="navigate(target, 'environments')"
      >
        环境
      </button>
    </nav>
    <div :key="target" class="hub-body">
      <LocalEnvironmentPage v-if="tab === 'environments' && target === 'local'" />
      <ServerEnvironmentPanel v-else-if="tab === 'environments' && target !== 'room'" target="server" />
      <ContentProjectsPanel v-else-if="target === 'local'" />
      <ContentPackagesPanel v-else :location="target" />
    </div>
  </main>
</template>
<style scoped>
.content-hub {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--el-text-color-primary);
  background: var(--el-bg-color-page);
}
.hub-heading,
.hub-tabs {
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
select,
button {
  font: inherit;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  padding: 6px 12px;
  background: var(--el-bg-color);
  color: inherit;
  max-width: 100%;
}
button[aria-current='page'] {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary);
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
