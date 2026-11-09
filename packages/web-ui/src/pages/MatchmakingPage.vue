<template>
  <div class="max-w-4xl mx-auto px-4 py-6 md:px-6 md:py-8">
    <router-link :to="{ name: 'Lobby' }" class="inline-flex items-center gap-1 text-sm text-blue-600">
      <ArrowLeft class="h-4 w-4" aria-hidden="true" />
      对战大厅
    </router-link>
    <h1 class="text-2xl md:text-3xl font-bold text-gray-800 mt-3 mb-2">普通匹配</h1>
    <ul class="mb-6 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
      <li>每回合 30 秒</li>
      <li>总计 25 分钟</li>
      <li>不计排名</li>
    </ul>

    <section class="bg-white rounded-lg shadow-sm border border-gray-200 p-4 md:p-6">
      <template v-if="matchmaking.waiting">
        <h2 class="text-lg font-medium" role="status" data-testid="matchmaking-waiting">
          {{ matchmaking.statusLabel }}
        </h2>
        <p class="text-sm text-gray-600 mt-2 mb-4">可离开此页，匹配成功后会自动进入对战。</p>
        <el-button
          data-testid="cancel-matchmaking-button"
          :disabled="matchmaking.canceling"
          @click="matchmaking.cancel"
        >
          取消匹配
        </el-button>
      </template>
      <p v-else-if="rooms.isSwitchingServer" role="status">正在切换服务器…</p>
      <p v-else-if="rooms.currentRoom" role="status">匹配前请退出房间。</p>
      <div v-else-if="!client.isConnected" class="flex flex-wrap items-center justify-between gap-3">
        <p role="status">服务器未连接</p>
        <router-link to="/servers" class="inline-flex min-h-11 items-center gap-1 font-medium text-blue-700">
          服务器列表
          <ArrowRight class="h-4 w-4" aria-hidden="true" />
        </router-link>
      </div>
      <template v-else>
        <div class="mb-4">
          <label for="matchmaking-environment" class="block font-medium mb-2">对战环境</label>
          <el-select
            id="matchmaking-environment"
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
                (environment.packages.length
                  ? environment.packages.map(pack => `${pack.name} ${pack.version}`).join('、')
                  : '官方内容') + (environment.executionPolicy === 'peer' ? ' · 玩家主机' : ' · 服务器')
              "
            />
          </el-select>
        </div>
        <p v-if="loading" role="status">正在加载对战内容…</p>
        <TeamSelector
          v-else-if="environmentReady"
          v-model="team"
          data-testid="matchmaking-team-selector"
          @update:is-valid="valid = $event"
        />
        <div class="mt-5 flex justify-end border-t border-gray-200 pt-4">
          <el-button v-if="configurationError" size="large" @click="loadEnvironments">重新加载</el-button>
          <el-button
            v-else
            type="primary"
            size="large"
            :icon="Search"
            data-testid="start-matchmaking-button"
            :disabled="loading || !environmentReady || !valid"
            @click="start"
          >
            开始匹配
          </el-button>
        </div>
      </template>
      <p v-if="configurationError || matchmaking.error" role="alert" class="text-sm text-red-700 mt-3">
        {{ configurationError || matchmaking.error }}
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowLeft, ArrowRight, Search } from '@element-plus/icons-vue'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import TeamSelector from '@/components/TeamSelector.vue'
import { usePrivateRoomStore } from '@/stores/privateRoom'
import { useBattleClientStore } from '@/stores/battleClient'
import { usePetStorageStore } from '@/stores/petStorage'
import { useMatchmakingStore } from '@/stores/matchmaking'
import { useGameDataStore } from '@/stores/gameData'

const rooms = usePrivateRoomStore()
const client = useBattleClientStore()
const storage = usePetStorageStore()
const matchmaking = useMatchmakingStore()
const gameData = useGameDataStore()
const loading = ref(false)
const configurationError = ref('')
const environmentId = ref('')
const selectedEnvironment = computed(() => rooms.environments.find(item => item.id === environmentId.value))
const team = ref<{ name: string; pets: unknown[] } | null>(null)
const valid = ref(false)
const environmentReady = ref(false)
let previewSpecies: typeof gameData.species | undefined
let generation = 0

async function prepareEnvironment() {
  const attempt = ++generation
  loading.value = true
  valid.value = false
  environmentReady.value = false
  configurationError.value = ''
  try {
    const { content } = await rooms.prepareMatchmakingEnvironment(environmentId.value)
    if (attempt === generation) {
      gameData.applyServerEnvironment(content)
      previewSpecies = gameData.species
      environmentReady.value = true
    }
  } catch (cause) {
    if (attempt === generation) configurationError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (attempt === generation) loading.value = false
  }
}

async function loadEnvironments() {
  const attempt = ++generation
  loading.value = true
  configurationError.value = ''
  try {
    await rooms.refreshEnvironments()
    if (attempt !== generation) return
    environmentId.value =
      selectedEnvironment.value?.id ?? rooms.defaultEnvironment?.id ?? rooms.environments[0]?.id ?? ''
    const last = storage.getLastMatchingConfig()
    team.value = storage.teams[last?.teamIndex ?? storage.currentTeamIndex] ?? null
    await prepareEnvironment()
  } catch (cause) {
    if (attempt === generation) {
      configurationError.value = cause instanceof Error ? cause.message : String(cause)
      loading.value = false
    }
  }
}

function start() {
  if (!team.value || !valid.value || !environmentReady.value || loading.value) return
  storage.saveLastMatchingConfig(
    storage.teams.findIndex(item => item === team.value),
    'standard',
  )
  void matchmaking.start(team.value.pets as PetSchemaType[], environmentId.value)
}

watch(
  () => [matchmaking.unavailable, matchmaking.waiting, client.serverUrl] as const,
  ([unavailable, waiting]) => {
    if (!unavailable && !waiting) void loadEnvironments()
    else {
      ++generation
      configurationError.value = ''
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  ++generation
  if (loading.value && !matchmaking.waiting) rooms.cancelMatchmakingPreparation()
  if (previewSpecies && gameData.species === previewSpecies && !rooms.currentRoom) gameData.clearServerEnvironment()
})
</script>
