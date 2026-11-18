<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'
import { computed, ref, shallowRef, watch } from 'vue'
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

const data = useGameDataStore()
const storage = usePetStorageStore()
const client = useBattleClientStore()
const auth = useAuthStore()
const desktop = getDesktopApi()
const preference = computed(() => storage.library.teams[storage.currentTeamIndex]?.environmentPreference)
const key = (value?: EnvironmentPreference) => (value ? JSON.stringify([value.source, value.environmentId]) : '')
type Choice = { name: string; preference: EnvironmentPreference; server?: ServerEnvironmentDescriptor }
const local = shallowRef<Choice[]>([])
const published = shallowRef<Choice[]>([])
const choices = computed(() => [...local.value, ...published.value])
const attempt = ref(0)
const ready = ref(false)
const emit = defineEmits<{ ready: [value: boolean] }>()
watch(ready, value => emit('ready', value), { flush: 'sync' })
const problem = ref('')
const discoveryError = ref('')
const version = ref('')
const serverSource = computed(() => 'server:' + (auth.serverInfo?.serverId || client.serverUrl))

watch(
  [attempt, () => client.serverUrl, () => client.isConnected, serverSource],
  async (_, __, cleanup) => {
    const controller = new AbortController()
    cleanup(() => controller.abort())
    local.value = []
    published.value = []
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
                    preference: { source: 'desktop:' + snapshot.workspaceId, environmentId: item.environmentId },
                  },
                ]
              : [],
          )
        }),
      )
    if (client.isConnected)
      loads.push(
        listServerEnvironments(client.serverUrl, fetch, controller.signal).then(items => {
          if (controller.signal.aborted) return
          published.value = items.map(server => ({
            name: server.environmentName ?? (server.packages.map(pkg => pkg.name).join('、') || server.id.slice(0, 12)),
            preference: { source: serverSource.value, environmentId: server.environmentId ?? server.id },
            server,
          }))
        }),
      )
    const results = await Promise.allSettled(loads)
    if (!controller.signal.aborted)
      discoveryError.value = results.flatMap(r => (r.status === 'rejected' ? [String(r.reason)] : [])).join('、')
  },
  { immediate: true },
)

const selected = computed(() => choices.value.find(choice => key(choice.preference) === key(preference.value)))
watch(
  [() => key(preference.value), selected, attempt],
  async (_, __, cleanup) => {
    const controller = new AbortController()
    let restore: (() => void) | undefined
    let release: (() => Promise<void>) | undefined
    cleanup(() => {
      controller.abort()
      restore?.()
      void release?.().catch(console.error)
    })
    ready.value = false
    problem.value = ''
    version.value = ''
    const choice = selected.value
    try {
      if (preference.value && !choice) throw new Error('所选环境不可用，可重新加载或选择其他环境')
      if (choice?.server) {
        const prepared = await prepareServerEnvironment(client.serverUrl, choice.server, fetch, controller.signal)
        controller.signal.throwIfAborted()
        restore = data.useLocalBattleContent(prepared.content, choice.server.rules, true)
        version.value = choice.server.gameplayRevision ?? choice.server.id
      } else if (desktop) {
        const captured = await acquireLocalContent(choice?.preference.environmentId)
        if (!captured) throw new Error('本地环境不可用')
        if (controller.signal.aborted) return await captured.release()
        release = captured.release
        restore = data.useLocalBattleContent(captured.content, captured.rules)
        version.value = captured.gameplayRevision ?? ''
      } else if (hasPreparedWebEnvironment()) {
        const catalog = await readPreparedWebCatalog()
        controller.signal.throwIfAborted()
        restore = data.useLocalBattleContent(catalog.content, catalog.rules)
        version.value = catalog.gameplayRevision
      } else {
        if (data.serverFallback) await data.reload()
        else await data.whenReady()
        controller.signal.throwIfAborted()
      }
      ready.value = true
    } catch (cause) {
      if (!controller.signal.aborted) problem.value = cause instanceof Error ? cause.message : String(cause)
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
</script>

<template>
  <div class="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-3">
    <span class="text-sm font-medium">对战环境</span>
    <el-select
      aria-label="查看环境"
      :model-value="key(preference) || 'current'"
      style="width: min(16rem, 100%)"
      @change="select"
    >
      <el-option value="current" :label="desktop ? '本机当前环境' : '网页默认环境'" />
      <el-option
        v-if="preference && !selected"
        :value="key(preference)"
        :label="preference.environmentId + '（不可用）'"
        disabled
      />
      <el-option
        v-for="choice in choices"
        :key="key(choice.preference)"
        :value="key(choice.preference)"
        :label="(choice.server ? '服务器 · ' : '本机 · ') + choice.name"
      />
    </el-select>
    <el-button :icon="Refresh" circle aria-label="刷新环境" title="刷新环境" @click="attempt++" />
    <el-text v-if="version" size="small" type="info" :title="version">版本 {{ version.slice(0, 8) }}</el-text>
    <span v-if="discoveryError" role="status">{{ discoveryError }}</span>
  </div>
  <slot v-if="ready" />
  <div v-else class="p-3">
    <p role="status">{{ problem || '正在加载环境…' }}</p>
    <slot name="unresolved" />
  </div>
</template>
