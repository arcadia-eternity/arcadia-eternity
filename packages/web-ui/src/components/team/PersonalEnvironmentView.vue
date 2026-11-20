<script setup lang="ts">
import { Refresh, Loading } from '@element-plus/icons-vue'
import { createReusableTemplate } from '@vueuse/core'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { EnvironmentPreference } from '@arcadia-eternity/local-profile'
import type { ManagedEnvironmentInstallation, ServerEnvironmentDescriptor } from '@arcadia-eternity/protocol'
import { useAuthStore } from '@/stores/auth'
import { useBattleClientStore } from '@/stores/battleClient'
import { useGameDataStore } from '@/stores/gameData'
import { usePetStorageStore } from '@/stores/petStorage'
import { acquireLocalContent } from '@/services/localContent'
import { hasPreparedWebEnvironment, readPreparedWebCatalog } from '@/services/preparedWebEnvironment'
import { listServerEnvironments, prepareServerEnvironment } from '@/services/serverEnvironment'
import { getDesktopApi } from '@/utils/env'
import PersonalTeamEditor from './PersonalTeamEditor.vue'
import StorageManager from '@/pages/storageManager.vue'

defineProps<{ warehouse: boolean }>()
const data = useGameDataStore()
const storage = usePetStorageStore()
const client = useBattleClientStore()
const auth = useAuthStore()
const desktop = getDesktopApi()
const preference = computed(() => storage.library.teams[storage.currentTeamIndex]?.environmentPreference)
const key = (value?: EnvironmentPreference) => (value ? JSON.stringify([value.source, value.environmentId]) : 'current')
type Choice = {
  name: string
  revision: string
  preference: EnvironmentPreference
  server?: ServerEnvironmentDescriptor
}
const local = shallowRef<Choice[]>([])
const published = shallowRef<Choice[]>([])
const choices = computed(() => [...local.value, ...published.value])
const selected = computed(() => choices.value.find(choice => key(choice.preference) === key(preference.value)))
const defaultName = ref(desktop ? '本机当前环境' : '网页默认环境')
const [DefinePicker, EnvironmentPicker] = createReusableTemplate()
const pickerOpen = ref(false)
const refresh = ref(0)
const discovering = ref(false)
const discoveryError = ref('')
const serverSource = computed(() => 'server:' + (auth.serverInfo?.serverId || client.serverUrl))

watch(
  [
    () => pickerOpen.value || !!preference.value,
    refresh,
    () => client.serverUrl,
    () => client.isConnected,
    serverSource,
  ],
  async ([needed, , url, connected, source], previous, cleanup) => {
    if (!connected || url !== previous?.[2] || source !== previous?.[4]) published.value = []
    discovering.value = false
    if (!needed) return
    const controller = new AbortController()
    cleanup(() => controller.abort())
    discovering.value = true
    discoveryError.value = ''
    const loads: Promise<void>[] = []
    if (desktop?.localEnvironment)
      loads.push(
        desktop.localEnvironment({ action: 'snapshot' }).then(response => {
          if (controller.signal.aborted) return
          if (response.error) throw new Error(response.error.message)
          const snapshot = response.result as { workspaceId: string; installations: ManagedEnvironmentInstallation[] }
          local.value = snapshot.installations.flatMap(item =>
            item.status === 'ready'
              ? [
                  {
                    name: item.document.name,
                    revision: JSON.stringify([item.draftRevision, item.contentRevision]),
                    preference: { source: 'desktop:' + snapshot.workspaceId, environmentId: item.environmentId },
                  },
                ]
              : [],
          )
        }),
      )
    else if (hasPreparedWebEnvironment())
      loads.push(
        readPreparedWebCatalog().then(catalog => {
          if (controller.signal.aborted) return
          const definitions = catalog.builtins ?? []
          defaultName.value = definitions.find(doc => doc.id === catalog.defaultEnvironment)?.name ?? '网页默认环境'
          local.value = definitions
            .filter(doc => doc.id !== catalog.defaultEnvironment)
            .map(doc => ({
              name: doc.name,
              revision: doc.gameplayRevision,
              preference: { source: 'web', environmentId: doc.id },
            }))
        }),
      )
    if (client.isConnected) {
      const source = serverSource.value
      loads.push(
        listServerEnvironments(client.serverUrl, fetch, controller.signal).then(items => {
          if (controller.signal.aborted) return
          published.value = items.map(server => ({
            name: server.environmentName ?? (server.packages.map(pkg => pkg.name).join('、') || server.id.slice(0, 12)),
            revision: server.id,
            preference: { source, environmentId: server.environmentId ?? server.id },
            server,
          }))
        }),
      )
    } else published.value = []
    const results = await Promise.allSettled(loads)
    if (controller.signal.aborted) return
    discovering.value = false
    discoveryError.value = results
      .flatMap(result => (result.status === 'rejected' ? [String(result.reason)] : []))
      .join('、')
  },
  { immediate: true },
)

const busy = ref(false)
const displayed = ref(false)
const problem = ref('')
const version = ref('')
let disposeDisplay: (() => void) | undefined
onScopeDispose(() => disposeDisplay?.())
const retry = ref(0)
const target = computed(() => {
  if (!preference.value) return 'current'
  const choice = selected.value
  if (!choice) return discovering.value ? 'discovering' : 'missing'
  return JSON.stringify([key(choice.preference), choice.revision, choice.server && client.serverUrl])
})

watch(
  [target, () => key(preference.value), retry],
  async ([targetKey], _, cleanup) => {
    const controller = new AbortController()
    cleanup(() => controller.abort())
    busy.value = true
    problem.value = ''
    if (targetKey === 'discovering') return
    const choice = selected.value
    try {
      if (preference.value && !choice) throw new Error('所选环境不可用，请重试或选择其他环境')
      if (choice?.server) {
        const prepared = await prepareServerEnvironment(client.serverUrl, choice.server, fetch, controller.signal)
        controller.signal.throwIfAborted()
        disposeDisplay?.()
        disposeDisplay = data.useLocalBattleContent(prepared.content, choice.server.rules, true)
        version.value = choice.server.gameplayRevision ?? choice.server.id
      } else {
        if (!choice) {
          disposeDisplay?.()
          disposeDisplay = undefined
        }
        if (choice || (desktop && data.serverFallback)) {
          const captured = await acquireLocalContent(choice?.preference.environmentId)
          if (!captured) throw new Error('本地环境不可用')
          try {
            controller.signal.throwIfAborted()
            disposeDisplay?.()
            const restore = data.useLocalBattleContent(captured.content, captured.rules)
            disposeDisplay = () => {
              restore()
              void captured.release().catch(console.error)
            }
            version.value = captured.gameplayRevision ?? ''
          } catch (cause) {
            await captured.release()
            throw cause
          }
        } else if (data.serverFallback && hasPreparedWebEnvironment()) {
          const catalog = await readPreparedWebCatalog()
          controller.signal.throwIfAborted()
          disposeDisplay = data.useLocalBattleContent(catalog.content, catalog.rules)
          version.value = catalog.gameplayRevision
        } else {
          if (data.serverFallback) await data.reload()
          else if (!data.loaded) await data.whenReady()
          controller.signal.throwIfAborted()
          version.value = data.defaultGameplayRevision ?? ''
        }
      }
      displayed.value = true
    } catch (cause) {
      if (!controller.signal.aborted) problem.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (!controller.signal.aborted) busy.value = false
    }
  },
  { immediate: true },
)

function select(value: string) {
  storage.setEnvironmentPreference(
    storage.currentTeamIndex,
    choices.value.find(choice => key(choice.preference) === value)?.preference,
  )
}
function retrySelection() {
  refresh.value++
  if (problem.value) retry.value++
}
</script>

<template>
  <DefinePicker>
    <div class="environment-field" @dblclick.stop>
      <span class="text-xs text-(--el-text-color-regular)">对战环境</span>
      <el-select
        size="small"
        aria-label="对战环境"
        :model-value="key(preference)"
        @visible-change="pickerOpen = $event"
        @change="select"
      >
        <el-option value="current" :label="defaultName" />
        <el-option v-if="preference && !selected" :value="key(preference)" :label="preference.environmentId" disabled />
        <el-option
          v-for="choice in choices"
          :key="key(choice.preference)"
          :value="key(choice.preference)"
          :label="(choice.server ? '服务器 · ' : desktop ? '本机 · ' : '') + choice.name"
        />
        <template #footer>
          <div class="flex items-center justify-between gap-2">
            <el-text size="small" type="info">{{
              version && !busy && !problem ? '版本 ' + version.slice(0, 8) : ''
            }}</el-text>
            <el-button text size="small" :icon="Refresh" :loading="discovering" @click="retrySelection"
              >刷新环境</el-button
            >
          </div>
        </template>
      </el-select>
      <el-icon v-if="busy" class="animate-spin" role="status" aria-label="正在切换环境"><Loading /></el-icon>
      <el-button v-if="problem || discoveryError" link type="primary" @click="retrySelection">重试</el-button>
    </div>
    <el-alert v-if="discoveryError" class="mt-1" :title="discoveryError" type="warning" :closable="false" />
  </DefinePicker>
  <div>
    <component
      v-if="(displayed || problem) && storage.initialized"
      :is="warehouse ? StorageManager : PersonalTeamEditor"
      :unavailable="problem"
      :environment-busy="busy"
    >
      <template #environment><EnvironmentPicker /></template>
    </component>
    <el-card v-else class="environment-placeholder" shadow="never" aria-busy="true">
      <template #header
        ><h1 class="font-medium">{{ warehouse ? '精灵仓库' : '队伍编辑器' }}</h1></template
      >
      <el-alert v-if="storage.loadFailed" type="error" title="无法读取仓库数据" show-icon :closable="false" />
      <el-skeleton v-else animated :rows="3" aria-label="正在加载环境" />
      <EnvironmentPicker v-if="preference" />
    </el-card>
  </div>
</template>

<style scoped>
.environment-field {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-block: 8px;
}
.environment-field > span {
  flex-shrink: 0;
}
.environment-field .el-select {
  min-width: 0;
  width: min(100%, 14rem);
}
.environment-placeholder {
  max-width: 76rem;
  margin: 1rem auto;
}
</style>
