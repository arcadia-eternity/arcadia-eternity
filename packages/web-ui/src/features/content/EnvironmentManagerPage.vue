<script setup lang="ts">
import { Grid } from '@element-plus/icons-vue'
import EnvironmentMediaCache from './EnvironmentMediaCache.vue'
import EnvironmentLayout from './EnvironmentLayout.vue'
import { ElIcon } from 'element-plus'
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, onBeforeRouteLeave } from 'vue-router'
import { usePrivateRoomStore } from '@/stores/privateRoom'
import { isStaticMode } from '@/utils/env'
import { hasPreparedWebEnvironment } from '@/services/preparedWebEnvironment'
import PublicEnvironments from './PublicEnvironments.vue'
import ContentPackagesPanel from './ContentPackagesPanel.vue'
import LocalEnvironmentPage from './LocalEnvironmentPage.vue'
import ServerEnvironmentPanel from './ServerEnvironmentPanel.vue'
import { useEnvironmentDrafts, discardEnvironmentChanges } from './unsavedEnvironment'
import EnvironmentDirectory from './EnvironmentDirectory.vue'
import { environmentGroupKey, resolveEnvironmentEntry, type EnvironmentLocation } from './environmentGroups'

type Location = 'local' | 'web' | 'server' | 'room'
const { dirty: hasDraft, open: editorOpen } = useEnvironmentDrafts()
const allowLeave = () => !hasDraft() || discardEnvironmentChanges()
onBeforeRouteLeave(allowLeave)
function beforeUnload(event: BeforeUnloadEvent) {
  if (hasDraft()) {
    event.preventDefault()
    event.returnValue = ''
  }
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
const route = useRoute()
const rooms = usePrivateRoomStore()
const local = !!(window.arcadiaDesktop?.localEnvironment || window.arcadiaDesktop?.listContentPackages)
const bundled = !local && hasPreparedWebEnvironment()
const catalogs = ref<Record<Exclude<Location, 'room'>, EnvironmentLocation[]>>({ local: [], web: [], server: [] })
const roomRows = computed<EnvironmentLocation[]>(() => {
  const descriptor = rooms.currentRoom?.personalEnvironment?.descriptor ?? rooms.currentRoom?.environment
  return descriptor
    ? [
        {
          id: descriptor.environmentId ?? descriptor.id,
          key: descriptor.id,
          environmentVersion: descriptor.environmentVersion,
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
// Old bookmarks and management links can focus a source without narrowing the directory.
const target = route.query.target
const defaultLocation: Location = local ? 'local' : bundled ? 'web' : 'server'
const preferredLocation: Location =
  target === 'server' && !isStaticMode ? 'server' : target === 'room' && rooms.currentRoom ? 'room' : defaultLocation
let userSelected = false
type CatalogEntry = (typeof entries.value)[number]
const chosen = ref<{ id: string; location: Location; key: string; environmentVersion?: string }>()
const localEdit = ref(false)
const serverEdit = ref(false)
function choose(row: CatalogEntry, startEdit = false) {
  chosen.value = { id: row.id, environmentVersion: row.environmentVersion, location: row.location, key: row.sourceKey }
  localEdit.value = startEdit && row.location === 'local'
  serverEdit.value = startEdit && row.location === 'server'
}
const activeLocation = computed(() => chosen.value?.location ?? preferredLocation)
const activeKey = computed(() => chosen.value?.key ?? '')
const selected = computed(() => activeLocation.value + '/' + activeKey.value)
const relatedServerEnvironment = computed(() => {
  if (activeLocation.value === 'server' || editorOpen()) return undefined
  const active = entries.value.find(row => row.key === selected.value)
  const remote =
    active?.environmentVersion &&
    catalogs.value.server.find(row => row.environmentVersion === active.environmentVersion && row.serverId)
  return remote && remote.serverId !== active?.serverId ? remote.id : undefined
})
const localBusy = ref(false)
const serverBusy = ref(false)
const directoryBusy = computed(() =>
  activeLocation.value === 'local' ? localBusy.value : activeLocation.value === 'server' && serverBusy.value,
)
watch([entries, editorOpen, directoryBusy], ([rows, editing, busy]) => {
  if (editing || busy || localEdit.value || serverEdit.value) return
  const first = rows.find(row => row.location === preferredLocation) ?? rows[0]
  const current = rows.find(row => row.key === selected.value)
  const previous = chosen.value && environmentGroupKey({ ...chosen.value, key: selected.value })
  const previousMatch = userSelected && resolveEnvironmentEntry(rows, previous, selected.value)
  const preferred = current && userSelected ? current : first
  const next =
    previousMatch ||
    (preferred &&
      (preferred.location === target
        ? preferred
        : resolveEnvironmentEntry(rows, environmentGroupKey(preferred), preferred.key)))
  if (next && (next.key !== selected.value || next.environmentVersion !== chosen.value?.environmentVersion))
    choose(next)
  else if (!next) chosen.value = undefined
})
async function select(key: string, startEdit = false) {
  if (key === selected.value || directoryBusy.value || !(await allowLeave())) return
  const row = entries.value.find(entry => entry.key === key)
  if (row && (!startEdit || row.editable)) {
    userSelected = true
    choose(row, startEdit)
  }
}
function selectWorkspaceEntry(location: 'local' | 'server', key: string) {
  userSelected = true
  const row = entries.value.find(entry => entry.location === location && entry.sourceKey === key)
  if (row) choose(row)
  else chosen.value = { location, key, id: key.slice(key.indexOf('/') + 1) }
}
function selection(location: Location) {
  return activeLocation.value === location ? activeKey.value : null
}
</script>
<template>
  <main class="environment-hub">
    <header class="hub-heading">
      <div class="hub-title">
        <ElIcon><Grid /></ElIcon>
        <h1>环境</h1>
      </div>
      <EnvironmentMediaCache
        v-if="chosen"
        :key="JSON.stringify([selected, chosen.environmentVersion])"
        :selection="chosen"
      />
    </header>
    <div class="hub-body">
      <EnvironmentLayout class="hub-layout">
        <template #directory>
          <EnvironmentDirectory
            show-sources
            :entries="entries"
            :selected="selected"
            :busy="directoryBusy"
            @select="select"
          />
        </template>
        <PublicEnvironments v-if="bundled" bundled :selection="selection('web')" @catalog="catalogs.web = $event" />
        <LocalEnvironmentPage
          v-if="local"
          :selection="selection('local')"
          @catalog="catalogs.local = $event"
          @busy="localBusy = $event"
          v-model:edit-requested="localEdit"
          @select="key => selectWorkspaceEntry('local', key)"
        />
        <ServerEnvironmentPanel
          v-if="!isStaticMode"
          target="server"
          :selection="selection('server')"
          v-model:edit-requested="serverEdit"
          :related-environment-id="relatedServerEnvironment"
          @catalog="catalogs.server = $event"
          @busy="serverBusy = $event"
          @select="key => selectWorkspaceEntry('server', key)"
        />
        <ContentPackagesPanel v-if="activeLocation === 'room' && activeKey === roomRows[0]?.key" location="room" />
        <p v-else-if="activeLocation === 'room'" role="status">此房间环境已不可用。</p>
      </EnvironmentLayout>
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
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 16px max(20px, calc((100% - 1440px) / 2));
  border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
}
.hub-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.hub-title .el-icon {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-size: 18px;
}
.hub-title h1 {
  font-size: 22px;
  font-weight: 600;
  margin: 0;
}
.hub-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: clamp(12px, 2vw, 28px);
}
.hub-layout {
  max-width: 1440px;
  margin-inline: auto;
}
</style>
