import { computed, ref, shallowReactive, watch } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createTeamPet } from './createTeamPet'
import { usePetStorageStore } from '@/stores/petStorage'
import { usePlayerStore } from '@/stores/player'
import { usePetManagement } from '@/composition/usePetManagement'
import { canonical } from '@arcadia-eternity/local-profile'
import { flushProfile } from '@/services/profile'
import { useTeamExport } from '@/composition/useTeamExport'
import type { TeamEditorDelegate } from './delegate'

// Drafts are session state. Shared builds are committed only after choosing a save scope.
const usePersonalTeamDrafts = defineStore('personalTeamDrafts', () => {
  const storage = usePetStorageStore()
  const draft = ref(storage.getCurrentTeam())
  const source = computed(() => storage.library.teams[storage.currentTeamIndex])
  const stamp = computed(() =>
    canonical([
      source.value.id,
      source.value.memberIds.map(id => [
        id,
        storage.storage.find(pet => pet.id === id)?.revision,
        storage.affectedTeams(id).map(team => team.id),
      ]),
    ]),
  )
  const baseStamp = ref(stamp.value)
  const original = ref(canonical(draft.value))
  const dirty = computed(() => original.value !== canonical(draft.value))
  const savedBuild = computed(() => canonical(storage.currentTeam))
  const stale = computed(() => dirty.value && (baseStamp.value !== stamp.value || original.value !== savedBuild.value))
  const parked = shallowReactive(new Map<string, { team: PetSchemaType[]; original: string; stamp: string }>())

  function reload() {
    draft.value = storage.getCurrentTeam()
    original.value = canonical(draft.value)
    baseStamp.value = stamp.value
  }
  watch(
    () => source.value.id,
    (id, previousId) => {
      if (dirty.value && storage.library.teams.some(team => team.id === previousId))
        parked.set(previousId, { team: draft.value, original: original.value, stamp: baseStamp.value })
      const saved = parked.get(id)
      if (saved) {
        original.value = saved.original
        baseStamp.value = saved.stamp
        draft.value = saved.team
        parked.delete(id)
      } else reload()
    },
    { flush: 'sync' },
  )
  watch(
    () => storage.library.teams.map(team => team.id),
    ids => {
      for (const id of parked.keys()) if (!ids.includes(id)) parked.delete(id)
    },
  )
  watch([stamp, savedBuild], () => {
    if (!dirty.value) reload()
  })
  watch(
    () => dirty.value || parked.size > 0,
    (pending, _, cleanup) => {
      if (!pending) return
      const desktop = window.arcadiaDesktop ?? window.arcadiaRemotePlay
      desktop?.setTeamDraftPending?.(true)
      const confirmExit = (event: BeforeUnloadEvent) => {
        event.preventDefault()
        event.returnValue = ''
      }
      window.addEventListener('beforeunload', confirmExit)
      cleanup(() => {
        window.removeEventListener('beforeunload', confirmExit)
        desktop?.setTeamDraftPending?.(false)
      })
    },
  )
  const affected = computed(() => {
    const teams = new Map<string, string>()
    const before = new Map(storage.getCurrentTeam().map(pet => [pet.id, canonical(pet)]))
    for (const pet of draft.value) {
      if (!before.has(pet.id) || before.get(pet.id) === canonical(pet)) continue
      for (const team of storage.affectedTeams(pet.id)) if (team.id !== source.value.id) teams.set(team.id, team.name)
    }
    const counts = new Map<string, number>()
    for (const name of teams.values()) counts.set(name, (counts.get(name) ?? 0) + 1)
    return [...teams].map(([id, name]) => (counts.get(name)! > 1 ? `${name}（${id}）` : name))
  })
  function commit(scope: 'original' | 'copy' = 'copy') {
    if (stale.value) {
      ElMessage.warning('队伍或精灵引用已变化，请先保留配法或放弃草稿')
      return false
    }
    if (!dirty.value) return storage.saveToLocal()
    const saved = storage.updateTeamOrder(storage.currentTeamIndex, draft.value, scope)
    if (saved) reload()
    return saved
  }
  return { draft, source, affected, dirty, stale, commit, reload }
})

export function usePersonalTeamEditor(): TeamEditorDelegate {
  const storage = usePetStorageStore()
  const drafts = usePersonalTeamDrafts()
  const { draft, source, affected, dirty, stale } = storeToRefs(drafts)
  const { commit, reload } = drafts
  const player = usePlayerStore()
  const management = usePetManagement()
  const exporter = useTeamExport()
  return {
    team: draft,
    affected,
    stale,
    async discardDraft() {
      const draftTeam = source.value.id
      try {
        await ElMessageBox.confirm('放弃「' + source.value.name + '」尚未保存的配法？', '放弃草稿', {
          confirmButtonText: '放弃草稿',
          cancelButtonText: '继续编辑',
          type: 'warning',
        })
      } catch {
        return
      }
      if (source.value.id === draftTeam) reload()
    },
    warehouse: {
      pets: computed(() => storage.storage),
      teamsUsing: id => storage.affectedTeams(id),
      replace(current, next) {
        if (dirty.value) {
          ElMessage.warning('请先保存当前修改，再更换队伍成员')
          return false
        }
        if (!storage.replaceMember(source.value.id, current, next)) return false
        reload()
        return true
      },
    },
    name: computed(() => storage.teams[storage.currentTeamIndex]?.name || '未知队伍'),
    subtitle: computed(() => player.name || '未命名训练师'),
    ready: computed(() => storage.initialized),
    persist: () => {
      if (!stale.value && !affected.value.length && dirty.value) commit()
    },
    createPet: createTeamPet,
    removePet(id, removed) {
      const previous = draft.value
      draft.value = previous.filter(pet => pet.id !== id)
      if (affected.value.length || commit()) removed()
      else draft.value = previous
    },
    removeLabel: '移出本队',
    storageRoute: '/storage',
    importTeam: management.importTeamConfig,
    exportTeam: exporter.exportTeamConfig,
    async save(scope) {
      if (!commit(scope)) return false
      await flushProfile()
      return true
    },
    clearLabel: '清理所有数据',
    async clear() {
      try {
        await ElMessageBox.confirm('此操作将清空所有队伍和仓库数据，无法撤销！确定要继续吗？', '清理所有数据', {
          confirmButtonText: '确定清理',
          cancelButtonText: '取消',
          type: 'warning',
          customStyle: { zIndex: '10000' },
        })
        storage.clearStorage()
        ElMessage.success('所有数据已清理完成！')
        return true
      } catch {
        return false
      }
    },
  }
}
