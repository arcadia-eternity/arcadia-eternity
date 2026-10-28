<template>
  <section class="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6 text-left" aria-label="普通匹配">
    <h2 class="text-lg font-medium text-gray-800">普通匹配</h2>
    <p class="text-sm text-gray-600 mt-1 mb-3">自动寻找使用相同对战内容的玩家，由服务器运行对战。</p>
    <el-button type="primary" data-testid="open-matchmaking-button" :disabled="unavailable" @click="openDialog">
      {{ searching ? '查看匹配' : '普通匹配' }}
    </el-button>
    <el-dialog
      v-model="open"
      title="普通匹配"
      width="min(640px, 95vw)"
      :show-close="!waiting"
      :close-on-click-modal="!waiting"
      :close-on-press-escape="!waiting"
    >
      <div v-if="waiting" role="status" data-testid="matchmaking-waiting">
        {{ busy ? '正在准备匹配…' : '正在寻找对手…' }}
      </div>
      <div v-else>
        <label class="block mb-3"
          >对战内容
          <el-select
            v-model="environmentId"
            :disabled="loading"
            data-testid="matchmaking-environment-select"
            class="w-full"
            @change="prepareEnvironment"
          >
            <el-option
              v-for="environment in rooms.environments"
              :key="environment.id"
              :value="environment.id"
              :label="
                environment.packages.length
                  ? environment.packages.map(pack => `${pack.name} ${pack.version}`).join('、')
                  : '官方内容'
              "
            />
          </el-select>
        </label>
        <p v-if="loading" role="status">正在加载对战内容…</p>
        <TeamSelector v-else v-model="team" data-testid="matchmaking-team-selector" @update:is-valid="valid = $event" />
        <p class="text-xs text-gray-500 mt-3">每回合 30 秒，总计 25 分钟。普通匹配不计排名。</p>
      </div>
      <p v-if="error" role="alert" class="text-sm text-red-700 mt-3">{{ error }}</p>
      <template #footer>
        <el-button v-if="waiting" data-testid="cancel-matchmaking-button" @click="cancel">取消匹配</el-button>
        <template v-else>
          <el-button @click="open = false">关闭</el-button>
          <el-button
            type="primary"
            data-testid="start-matchmaking-button"
            :disabled="loading || !environmentReady || !valid || unavailable"
            @click="start"
            >开始匹配</el-button
          >
        </template>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import TeamSelector from './TeamSelector.vue'
import { usePrivateRoomStore } from '@/stores/privateRoom'
import { useBattleClientStore } from '@/stores/battleClient'
import { usePetStorageStore } from '@/stores/petStorage'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import type { ErrorResponse } from '@arcadia-eternity/protocol'

const props = defineProps<{ autoOpen?: boolean }>()
const rooms = usePrivateRoomStore()
const client = useBattleClientStore()
const storage = usePetStorageStore()
const open = ref(false)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const environmentId = ref('')
const team = ref<{ name: string; pets: unknown[] } | null>(null)
const valid = ref(false)
const environmentReady = ref(false)
const searching = computed(() => client.currentState.matchmaking === 'searching')
const waiting = computed(() => busy.value || searching.value)
const unavailable = computed(
  () => rooms.isSwitchingServer || client.currentState.status !== 'connected' || !!rooms.currentRoom,
)
let generation = 0

async function prepareEnvironment() {
  const attempt = ++generation
  loading.value = true
  valid.value = false
  environmentReady.value = false
  error.value = ''
  try {
    await rooms.prepareMatchmakingEnvironment(environmentId.value)
    if (attempt === generation) environmentReady.value = true
  } catch (cause) {
    if (attempt === generation) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (attempt === generation) loading.value = false
  }
}
async function openDialog() {
  const attempt = ++generation
  open.value = true
  if (searching.value) return
  loading.value = true
  error.value = ''
  try {
    await rooms.refreshEnvironments()
    if (attempt !== generation || !open.value) return
    environmentId.value = rooms.environments.some(item => item.id === environmentId.value)
      ? environmentId.value
      : (rooms.environments.find(item => !item.packages.length)?.id ?? '')
    const last = storage.getLastMatchingConfig()
    team.value = storage.teams[last?.teamIndex ?? storage.currentTeamIndex] ?? null
    await prepareEnvironment()
  } catch (cause) {
    if (attempt === generation) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      loading.value = false
    }
  }
}
async function start() {
  if (!team.value || !valid.value || waiting.value) return
  const attempt = ++generation
  busy.value = true
  error.value = ''
  try {
    storage.saveLastMatchingConfig(
      storage.teams.findIndex(item => item.name === team.value?.name),
      'standard',
    )
    await rooms.joinMatchmaking(team.value.pets as PetSchemaType[], environmentId.value)
  } catch (cause) {
    if (attempt === generation) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (attempt === generation) busy.value = false
  }
}
async function cancel() {
  ++generation
  try {
    await rooms.cancelMatchmaking()
    busy.value = false
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
const matchingError = (response: ErrorResponse) => {
  error.value = response.code === 'MATCHMAKING_CANCELED' ? '' : `匹配未完成（${response.code}），请重试`
  busy.value = false
}
client.on('matchmakingError', matchingError)
watch(
  () => props.autoOpen && client.currentState.status === 'connected' && !rooms.currentRoom,
  value => {
    if (value) void openDialog()
  },
  { immediate: true },
)
watch(
  () => client.serverUrl,
  () => {
    ++generation
    busy.value = false
    open.value = false
  },
)
watch(open, value => {
  if (!value) {
    ++generation
    void rooms.cancelMatchmaking().catch(() => undefined)
  }
})
watch(
  () => client.currentState.status,
  (status, previous) => {
    if (previous === 'connected' && status !== 'connected' && open.value) {
      ++generation
      busy.value = false
      error.value = '连接已断开，请重新连接后匹配'
      void rooms.cancelMatchmaking().catch(() => undefined)
    }
  },
)
onBeforeUnmount(() => {
  ++generation
  client.off('matchmakingError', matchingError)
  if ((waiting.value || loading.value) && client.currentState.matchmaking !== 'matched')
    void rooms.cancelMatchmaking().catch(() => undefined)
})
</script>
