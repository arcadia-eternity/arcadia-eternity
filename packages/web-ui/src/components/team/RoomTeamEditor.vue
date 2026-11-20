<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { Value } from '@sinclair/typebox/value'
import { RouterLink, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { nanoid } from 'nanoid'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import { chooseTeamFile } from '@/services/teamFile'
import { usePrivateRoomStore } from '@/stores/privateRoom'
import { useBattleClientStore } from '@/stores/battleClient'
import { usePetStorageStore } from '@/stores/petStorage'
import { useTeamExport } from '@/composition/useTeamExport'
import TeamEditor from './TeamEditor.vue'
import type { TeamEditorDelegate } from './delegate'
import { createTeamPet } from './createTeamPet'

const props = defineProps<{ roomCode: string }>()
const router = useRouter()
const rooms = usePrivateRoomStore()
const client = useBattleClientStore()
const storage = usePetStorageStore()
const { exportTeamConfig } = useTeamExport()
const error = ref('')
const verifiedKey = ref('')
const attempt = ref(0)
const roomPath = computed(() => '/room/' + encodeURIComponent(props.roomCode))
const draft = computed(() =>
  rooms.currentRoom?.config.roomCode === props.roomCode && rooms.roomTeamDraft?.key === rooms.roomEditorKey
    ? rooms.roomTeamDraft
    : undefined,
)
type DraftTeam = { name: string; pets: PetSchemaType[] }
const lastImport = shallowRef<{ key: string; before: DraftTeam; after: DraftTeam }>()
function draftMatches(team: DraftTeam, snapshot: DraftTeam) {
  return team.name === snapshot.name && Value.Equal(team.pets, snapshot.pets)
}
const canUndoImport = computed(
  () => !!draft.value && lastImport.value?.key === draft.value.key && draftMatches(draft.value, lastImport.value.after),
)
watch(
  () => draft.value?.key,
  () => {
    lastImport.value = undefined
  },
)
function undoImport() {
  if (!ready.value || !draft.value || !lastImport.value || !canUndoImport.value) return
  Object.assign(draft.value, Value.Clone(lastImport.value.before))
  lastImport.value = undefined
}
const origin = computed(() => {
  const room = rooms.currentRoom
  if (!room?.personalEnvironment || !draft.value) return undefined
  const { source, descriptor } = room.personalEnvironment
  const name = source.kind === 'file' ? source.name : new URL(source.url).hostname
  return { name, version: descriptor.id }
})
const ready = computed(
  () =>
    !!draft.value &&
    draft.value.key === verifiedKey.value &&
    rooms.currentRoom?.status !== 'started' &&
    rooms.isPlayer &&
    client.currentState.status === 'connected',
)

watch(
  [
    () => client.currentState.status,
    () => client.serverUrl,
    () => client.playerId,
    () => rooms.roomEditorKey,
    () => rooms.isPlayer,
    () => props.roomCode,
    attempt,
  ],
  async ([status], _, onCleanup) => {
    let live = true
    onCleanup(() => {
      live = false
    })
    verifiedKey.value = ''
    error.value = ''
    if (status !== 'connected') return
    try {
      const key = await rooms.openRoomTeamEditor(props.roomCode, () => live)
      if (live) verifiedKey.value = key
    } catch (cause) {
      if (live) error.value = cause instanceof Error ? cause.message : String(cause)
    }
  },
  { immediate: true },
)

const delegate: TeamEditorDelegate = {
  team: computed({
    get: () => draft.value?.pets ?? [],
    set: pets => {
      if (draft.value) draft.value.pets = pets
    },
  }),
  name: computed(() => draft.value?.name ?? '本场队伍'),
  subtitle: computed(() =>
    [
      '房间 ' + props.roomCode,
      rooms.currentRoom?.environment?.environmentName || origin.value?.name,
      draft.value?.version.slice(0, 12),
    ]
      .filter(Boolean)
      .join(' · '),
  ),
  ready,
  persist() {},
  createPet: createTeamPet,
  removePet(id, removed) {
    if (!draft.value) return
    draft.value.pets = draft.value.pets.filter(pet => pet.id !== id)
    removed()
  },
  async importTeam() {
    const target = draft.value
    if (!target) return
    const before = Value.Clone({ name: target.name, pets: target.pets })
    try {
      const imported = await chooseTeamFile()
      if (!imported || target !== draft.value || !ready.value) return
      const pets = imported.pets.map(({ origin: _hint, ...pet }: PetSchemaType & { origin?: unknown }) => ({
        ...pet,
        id: nanoid(),
      }))
      await ElMessageBox.confirm(
        `「${target.name}」${target.pets.length} 只 → 「${imported.name}」${pets.length} 只`,
        '替换本场候选队伍',
        { confirmButtonText: '替换', cancelButtonText: '取消' },
      )
      if (target !== draft.value || !ready.value) return
      if (!draftMatches(target, before)) throw new Error('本场队伍已修改，请重新导入')
      const after = { name: imported.name, pets }
      lastImport.value = { key: target.key, before, after: Value.Clone(after) }
      Object.assign(target, after)
    } catch (error) {
      if (error !== 'cancel' && error !== 'close')
        ElMessage.error(error instanceof Error ? error.message : String(error))
    }
  },
  exportTeam: pets => exportTeamConfig(pets, { name: draft.value?.name ?? '本场队伍', origin: origin.value }),
  saveLabel: '用于本场',
  async save() {
    try {
      await rooms.applyRoomTeamDraft()
      await router.push(roomPath.value)
      return true
    } catch (cause) {
      ElMessage.error(cause instanceof Error ? cause.message : String(cause))
      return false
    }
  },
}

function saveCopy() {
  if (
    draft.value &&
    storage.importTeam({
      name: draft.value.name,
      ruleSetId: 'casual_standard_ruleset',
      pets: draft.value.pets.map(pet => (origin.value ? { ...pet, origin: origin.value } : pet)),
    })
  )
    ElMessage.success('已另存为个人队伍')
}
</script>

<template>
  <nav class="flex flex-wrap items-center gap-y-2 p-3">
    <el-button :tag="RouterLink" :to="roomPath">返回房间</el-button>
    <el-button v-if="ready && canUndoImport" @click="undoImport">撤销本场导入</el-button>
    <el-button v-if="draft" @click="saveCopy">另存为个人队伍</el-button>
  </nav>
  <TeamEditor v-if="ready" :delegate="delegate" />
  <el-card v-else class="m-4" shadow="never" :aria-busy="!error">
    <template #header><h1 class="font-medium">队伍编辑器</h1></template>
    <el-alert v-if="error" :title="error" type="warning" show-icon :closable="false" />
    <el-skeleton
      v-else-if="client.currentState.status === 'connected'"
      animated
      :rows="3"
      aria-label="正在核对房间环境"
    />
    <el-alert v-else title="等待服务器连接" type="info" show-icon :closable="false" />
    <el-button v-if="error" class="mt-3" @click="attempt++">重新核对</el-button>
    <ul v-if="draft && error" class="mt-3">
      <li v-for="pet in draft.pets" :key="pet.id">{{ pet.name }} · {{ pet.species }}</li>
    </ul>
  </el-card>
</template>
