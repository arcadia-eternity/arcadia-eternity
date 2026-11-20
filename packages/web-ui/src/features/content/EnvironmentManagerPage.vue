<script setup lang="ts">
import { ElSelect, ElOption } from 'element-plus'
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { getBackendOrigin } from '@/bootstrap/deployment'
import { usePrivateRoomStore } from '@/stores/privateRoom'
import { isStaticMode } from '@/utils/env'
import { hasPreparedWebEnvironment } from '@/services/preparedWebEnvironment'
import PublicEnvironments from './PublicEnvironments.vue'
import ContentPackagesPanel from './ContentPackagesPanel.vue'
import LocalEnvironmentPage from './LocalEnvironmentPage.vue'
import ServerEnvironmentPanel from './ServerEnvironmentPanel.vue'
import { useEnvironmentDrafts, discardEnvironmentChanges } from './unsavedEnvironment'
import EnvironmentDirectory from './EnvironmentDirectory.vue'
import { resolveEnvironmentEntry, type EnvironmentLocation } from './environmentGroups'

type Location = 'local' | 'web' | 'server' | 'room'
const { dirty: hasDraft, open: editorOpen } = useEnvironmentDrafts()
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
const showLocations = computed(() => Number(local || bundled) + Number(!isStaticMode) + Number(!!rooms.currentRoom) > 1)
const defaultAll = showLocations.value
function locationFor(value: unknown) {
  if ((!value && defaultAll) || value === 'all') return 'all'
  if (value === 'room' && rooms.currentRoom) return 'room'
  if (bundled && (value === 'web' || isStaticMode)) return 'web'
  if ((value === 'local' || value === 'host') && local) return 'local'
  if (value && value !== 'all') return 'server'
  return local ? 'local' : 'server'
}
const target = computed(() => locationFor(route.query.target))
const catalogs = ref<Record<Exclude<Location, 'room'>, EnvironmentLocation[]>>({ local: [], web: [], server: [] })
const roomRows = computed<EnvironmentLocation[]>(() => {
  const descriptor = rooms.currentRoom?.personalEnvironment?.descriptor ?? rooms.currentRoom?.environment
  return descriptor
    ? [
        {
          id: descriptor.environmentId ?? descriptor.id,
          key: descriptor.id,
          name: descriptor.environmentName ?? '房间环境',
          source: '当前房间',
        },
      ]
    : []
})
const entries = computed(() =>
  (['local', 'web', 'server', 'room'] as const).flatMap(location =>
    (location === 'room' ? roomRows.value : catalogs.value[location]).map(row => ({
      ...row,
      key: location + '/' + row.key,
      sourceKey: row.key,
      location,
    })),
  ),
)
const preferredLocation: Location = local ? 'local' : bundled ? 'web' : 'server'
type CatalogEntry = (typeof entries.value)[number]
const chosen = ref<{ id: string; location: Location; key: string }>()
const localEdit = ref(false)
const serverEdit = ref(false)
function choose(row: CatalogEntry, startEdit = false) {
  chosen.value = { id: row.id, location: row.location, key: row.sourceKey }
  localEdit.value = startEdit && row.location === 'local'
  serverEdit.value = startEdit && row.location === 'server'
}
const activeLocation = computed(() => chosen.value?.location ?? preferredLocation)
const activeKey = computed(() => chosen.value?.key ?? '')
const selected = computed(() => activeLocation.value + '/' + activeKey.value)
const relatedServerEnvironment = computed(() => {
  if (target.value !== 'all' || activeLocation.value === 'server' || editorOpen()) return undefined
  const active = entries.value.find(row => row.key === selected.value)
  const remote = active && catalogs.value.server.find(row => row.id === active.id && row.serverId)
  return remote && remote.serverId !== active?.serverId ? remote.id : undefined
})
const localBusy = ref(false)
const serverBusy = ref(false)
const directoryBusy = computed(() =>
  activeLocation.value === 'local' ? localBusy.value : activeLocation.value === 'server' && serverBusy.value,
)
watch([entries, editorOpen, directoryBusy], ([rows, editing, busy]) => {
  if (target.value !== 'all' || editing || busy || localEdit.value || serverEdit.value) return
  const id = chosen.value?.id ?? (rows.find(row => row.location === preferredLocation) ?? rows[0])?.id
  const next = resolveEnvironmentEntry(rows, id, selected.value)
  if (next && next.key !== selected.value) choose(next)
})
async function select(key: string, startEdit = false) {
  if (key === selected.value || directoryBusy.value || !(await allowLeave())) return
  const row = entries.value.find(entry => entry.key === key)
  if (row && (!startEdit || row.editable)) choose(row, startEdit)
}
function selectLocal(key: string) {
  const row = entries.value.find(entry => entry.location === 'local' && entry.sourceKey === key)
  if (row) choose(row)
  else chosen.value = { location: 'local', key, id: key.slice(key.indexOf('/') + 1) }
}
function selection(location: Location) {
  if (target.value !== 'all') return undefined
  return activeLocation.value === location ? activeKey.value : null
}
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
          <ElOption value="all" label="全部来源" />
          <ElOption v-if="bundled" value="web" label="网页内置" />
          <ElOption v-if="local" value="local" label="本机" />
          <ElOption v-if="!isStaticMode" value="server" :label="`服务器 · ${serverLabel}`" />
          <ElOption v-if="rooms.currentRoom" value="room" label="当前房间" />
        </ElSelect>
      </label>
    </header>
    <div :key="target" class="hub-body">
      <EnvironmentDirectory
        v-if="target === 'all'"
        :entries="entries"
        :selected="selected"
        :busy="directoryBusy"
        @select="select"
      />
      <PublicEnvironments
        v-if="target === 'web' || (target === 'all' && bundled)"
        bundled
        :selection="selection('web')"
        @catalog="catalogs.web = $event"
      />
      <LocalEnvironmentPage
        v-if="target === 'local' || (target === 'all' && local)"
        :selection="selection('local')"
        @catalog="catalogs.local = $event"
        @busy="localBusy = $event"
        v-model:edit-requested="localEdit"
        @select="selectLocal"
      />
      <ServerEnvironmentPanel
        v-if="target === 'server' || (target === 'all' && !isStaticMode)"
        target="server"
        :selection="selection('server')"
        v-model:edit-requested="serverEdit"
        :related-environment-id="relatedServerEnvironment"
        @catalog="catalogs.server = $event"
        @busy="serverBusy = $event"
      />
      <ContentPackagesPanel
        v-if="target === 'room' || (target === 'all' && activeLocation === 'room' && activeKey === roomRows[0]?.key)"
        location="room"
      />
      <p v-else-if="target === 'all' && activeLocation === 'room'" role="status">此房间环境已不可用。</p>
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
.hub-body > .environment-directory {
  margin: 0 20px 12px;
}
.hub-body > :deep(.local-environments) {
  height: auto;
  min-height: 0;
  padding: 0 20px 20px;
}
</style>
