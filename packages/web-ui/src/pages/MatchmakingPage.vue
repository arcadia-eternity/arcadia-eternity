<template>
  <div class="max-w-4xl mx-auto px-4 py-6 md:px-6 md:py-8">
    <router-link :to="{ name: 'Lobby' }" class="text-sm text-blue-600">← 返回对战大厅</router-link>
    <h1 class="text-2xl md:text-3xl font-bold text-gray-800 mt-3">普通匹配</h1>
    <p class="text-sm text-gray-600 mt-2 mb-6">
      与使用相同对战环境的玩家交手。每回合 30 秒，总计 25 分钟，结果不计排名。
    </p>

    <section class="bg-white rounded-lg shadow-sm border border-gray-200 p-4 md:p-6">
      <template v-if="matchmaking.waiting">
        <h2 class="text-lg font-medium" role="status" data-testid="matchmaking-waiting">
          {{ matchmaking.statusLabel }}
        </h2>
        <p class="text-sm text-gray-600 mt-2 mb-4">可以离开本页继续等待。匹配成功后会自动进入对战。</p>
        <el-button
          data-testid="cancel-matchmaking-button"
          :disabled="matchmaking.canceling"
          @click="matchmaking.cancel"
        >
          取消匹配
        </el-button>
      </template>
      <p v-else-if="rooms.isSwitchingServer" role="status">正在切换服务器…</p>
      <p v-else-if="rooms.currentRoom" role="status">请先离开当前房间，再开始匹配。</p>
      <p v-else-if="!client.isConnected" role="status">请先连接对战服务器，再开始匹配。</p>
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
        <p v-if="selectedEnvironment?.executionPolicy === 'peer'" class="text-sm text-gray-600 mb-3">
          此环境由玩家主机运行。固定内容与执行材料准备完成后才能匹配。
        </p>
        <p v-if="loading" role="status">正在加载对战内容…</p>
        <TeamSelector
          v-else-if="environmentReady"
          v-model="team"
          data-testid="matchmaking-team-selector"
          @update:is-valid="valid = $event"
        />
        <div class="mt-4">
          <el-button v-if="configurationError && !loading" @click="loadEnvironments">重新加载</el-button>
          <el-button
            type="primary"
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
