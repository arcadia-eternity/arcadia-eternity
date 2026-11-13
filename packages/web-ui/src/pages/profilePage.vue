<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'
import { ElMessageBox } from 'element-plus'
import { MAX_BACKUP_BYTES, parseBackup, rawProfileBytes } from '@arcadia-eternity/local-profile'
import { usePlayerStore } from '@/stores/player'
import { usePetStorageStore } from '@/stores/petStorage'
import { useGameSettingStore } from '@/stores/gameSetting'
import { useBattleClientStore } from '@/stores/battleClient'
import { usePrivateRoomStore } from '@/stores/privateRoom'
import { useGameDataStore } from '@/stores/gameData'
import {
  profileStatus,
  profileFailure,
  profileMigrationNotice,
  rawLegacyProfileData,
  profileSwitching,
  currentProfileData,
  initializeProfile,
  useTemporaryProfile,
  exportProfile,
  inspectProfile,
  commitProfile,
  profileRecovery,
  withProfileSwitch,
  saveRemoteProfile,
  retryProfileSave,
  rawProfileData,
  repairProfile,
} from '@/services/profile'

const player = usePlayerStore(),
  pets = usePetStorageStore(),
  settings = useGameSettingStore()
const client = useBattleClientStore(),
  rooms = usePrivateRoomStore(),
  catalog = useGameDataStore()
const preview = ref<Awaited<ReturnType<typeof inspectProfile>> | null>(null)
const error = ref(''),
  busy = ref(false)
const remote = !!window.arcadiaRemotePlay
const status = computed(
  () =>
    ({ loading: '正在读取', saved: '已保存', unsaved: '未保存', 'memory-only': '仅本次窗口', blocked: '需要恢复' })[
      profileStatus.value
    ],
)
const missing = computed(() => {
  if (!preview.value || !catalog.loaded) return []
  const entries = [...preview.value.data.library.storage, ...preview.value.data.library.teams.flatMap(t => t.pets)]
  const ids = new Set<string>()
  for (const pet of entries) {
    if (!catalog.species.byId[pet.species]) ids.add(pet.species)
    for (const id of pet.skills) if (!catalog.skills.byId[id]) ids.add(id)
    for (const id of [pet.ability, pet.emblem]) if (id && !catalog.marks.byId[id]) ids.add(id)
  }
  return [...ids]
})
const changedSettings = computed(() => {
  if (!preview.value) return []
  const labels = {
    battleRenderer: '渲染方式',
    battleMotion: '动画',
    mute: '静音',
    musicMute: '音乐静音',
    soundMute: '音效静音',
    musicVolume: '音乐音量',
    soundVolume: '音效音量',
    background: '背景',
    battleMusic: '战斗音乐',
    visibleLogTypes: '战斗日志',
  }
  return (Object.keys(labels) as (keyof typeof labels)[])
    .filter(
      key =>
        JSON.stringify(preview.value!.data.settings[key]) !==
        JSON.stringify(preview.value!.current?.data.settings[key]),
    )
    .map(key => labels[key])
})
async function perform(action: () => Promise<void>) {
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '操作失败'
  } finally {
    busy.value = false
  }
}
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([typeof value === 'string' ? rawProfileBytes(value).slice().buffer : JSON.stringify(value, null, 2)], {
      type: 'application/json',
    }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function hydrate() {
  const switching = profileSwitching.value
  profileSwitching.value = true
  try {
    player.loadFromLocal()
    pets.loadFromLocal()
    settings.reloadFromLocal()
  } finally {
    profileSwitching.value = switching
  }
}
async function load(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  input.value = ''
  if (!file) return
  await perform(async () => {
    if (file.size > MAX_BACKUP_BYTES) throw new Error('资料文件超过 20 MiB')
    await nextTick()
    const bytes = await file.text()
    if (profileStatus.value === 'blocked') {
      const raw = await rawProfileData()
      if (raw !== null) {
        if (rooms.currentRoom || client.currentState.matchmaking !== 'idle' || client.currentState.battle !== 'idle')
          throw new Error('请先退出房间、匹配或对局')
        const backup = parseBackup(bytes)
        await ElMessageBox.confirm(
          `${backup.data.profile.name} · ${backup.data.profile.id} · ${backup.data.library.teams.length} 支队伍`,
          '导出损坏数据并恢复',
          { confirmButtonText: '导出并恢复', cancelButtonText: '取消' },
        )
        download(raw, 'profile-corrupt.json')
        await ElMessageBox.confirm('请确认损坏数据已下载保存。', '替换损坏资料', {
          confirmButtonText: '已保存，继续恢复',
          cancelButtonText: '取消',
        })
        const connected = client.isConnected || client.isConnecting
        client.disconnect()
        try {
          await withProfileSwitch(async () => {
            await repairProfile(bytes, raw)
            hydrate()
          })
        } finally {
          if (connected) await client.connect()
        }
        return
      }
    }
    preview.value = await inspectProfile(bytes)
  })
}
async function restore() {
  await perform(async () => {
    if (rooms.currentRoom || client.currentState.matchmaking !== 'idle' || client.currentState.battle !== 'idle')
      throw new Error('请先退出房间、匹配或对局')
    const plan = preview.value
    if (!plan) return
    const changedUid = currentProfileData().profile.id !== plan.data.profile.id
    const connected = client.isConnected || client.isConnecting
    await ElMessageBox.confirm(
      '当前资料将保留为恢复点；已有恢复点会被替换。',
      changedUid && connected ? '替换并重连' : '恢复资料',
      { confirmButtonText: '恢复资料', cancelButtonText: '取消' },
    )
    if (changedUid) client.disconnect()
    try {
      await withProfileSwitch(async () => {
        await commitProfile(plan)
        hydrate()
        preview.value = null
      }, changedUid)
    } finally {
      if (changedUid && connected) {
        try {
          await client.connect()
        } catch (cause) {
          error.value = `资料状态已保留，重连失败：${cause instanceof Error ? cause.message : '请重试'}`
        }
      }
    }
  })
}
async function recover() {
  await perform(async () => {
    const previous = await profileRecovery()
    if (!previous) throw new Error('没有恢复点')
    const backup = await exportProfile()
    preview.value = await inspectProfile(JSON.stringify({ ...backup, data: previous.data }))
  })
}
async function retry(prefer?: 'player' | 'player-data') {
  await perform(async () => {
    if (rooms.currentRoom || client.currentState.matchmaking !== 'idle' || client.currentState.battle !== 'idle')
      throw new Error('请先退出房间、匹配或对局')
    const connected = client.isConnected || client.isConnecting
    client.disconnect()
    await withProfileSwitch(async () => {
      await initializeProfile(prefer)
      hydrate()
    })
    if (connected && profileStatus.value !== 'blocked') await client.connect()
  })
}
</script>

<template>
  <section class="max-w-3xl mx-auto p-6 space-y-5">
    <h1 class="text-2xl font-bold">个人资料</h1>
    <p>
      {{ player.name }} <code>{{ player.id }}</code>
    </p>
    <p role="status">{{ status }}</p>
    <p v-if="error || profileFailure" role="alert">{{ error || profileFailure }}</p>
    <div class="flex flex-wrap gap-3">
      <el-button
        :disabled="busy"
        @click="perform(async () => download(await exportProfile(), 'backup.arcadia-profile.json'))"
        >导出资料</el-button
      >
      <label v-if="!remote"
        >导入资料<input type="file" accept=".json" :disabled="busy || profileSwitching" @change="load"
      /></label>
      <el-button v-if="!remote" :disabled="busy" @click="recover">恢复上一份</el-button>
      <el-button v-if="remote" :disabled="busy" @click="perform(saveRemoteProfile)">保存到个人资料</el-button>
      <el-button v-if="profileStatus === 'unsaved'" @click="perform(retryProfileSave)">重试保存</el-button>
      <el-button v-if="!client.isConnected" @click="perform(() => client.connect())">重新连接</el-button>
    </div>
    <p v-if="profileMigrationNotice" role="alert">{{ profileMigrationNotice }}</p>
    <el-button
      v-if="!remote && (profileStatus === 'blocked' || profileMigrationNotice)"
      @click="perform(async () => download(rawLegacyProfileData(), 'profile-legacy-raw.json'))"
      >导出旧原始数据</el-button
    >
    <div v-if="profileStatus === 'blocked'" class="flex flex-wrap gap-3">
      <el-button @click="retry()">重新读取</el-button>
      <el-button v-if="profileFailure.includes('身份不一致')" @click="retry('player')">使用 player 资料</el-button>
      <el-button v-if="profileFailure.includes('身份不一致')" @click="retry('player-data')"
        >使用 player-data 资料</el-button
      >
      <el-button @click="useTemporaryProfile()">临时使用</el-button>
    </div>
    <template v-if="preview">
      <h2 class="text-xl">恢复预览</h2>
      <p>
        {{ preview.data.profile.name }} <code>{{ preview.data.profile.id }}</code>
      </p>
      <p v-if="preview.current">
        当前：{{ preview.current.data.profile.name }} <code>{{ preview.current.data.profile.id }}</code>
      </p>
      <p>仓库 {{ preview.data.library.storage.length }}　队伍 {{ preview.data.library.teams.length }}</p>
      <p v-if="changedSettings.length">设置变化：{{ changedSettings.join('、') }}</p>
      <p v-if="preview.unchanged">资料相同</p>
      <p v-if="preview.data.profile.id !== player.id && client.isConnected">更换 UID 需要重新连接</p>
      <p v-if="!catalog.loaded">内容未检查</p>
      <p v-if="missing.length">缺失内容：{{ missing.join('、') }}</p>
      <p>规则集将在选择环境后校验</p>
      <el-button :disabled="busy" @click="restore">恢复此资料</el-button>
      <el-button @click="preview = null">取消</el-button>
    </template>
  </section>
</template>
