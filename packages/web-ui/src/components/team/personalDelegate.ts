import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createTeamPet } from './createTeamPet'
import { usePetStorageStore } from '@/stores/petStorage'
import { usePlayerStore } from '@/stores/player'
import { usePetManagement } from '@/composition/usePetManagement'
import { canonical } from '@arcadia-eternity/local-profile'
import { flushProfile } from '@/services/profile'
import { useTeamExport } from '@/composition/useTeamExport'
import type { TeamEditorDelegate } from './delegate'

export function usePersonalTeamEditor(): TeamEditorDelegate {
  const storage = usePetStorageStore()
  const player = usePlayerStore()
  const management = usePetManagement()
  const exporter = useTeamExport()
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
  let baseStamp = stamp.value
  let original = canonical(draft.value)
  function reload() {
    draft.value = storage.getCurrentTeam()
    original = canonical(draft.value)
    baseStamp = stamp.value
  }
  watch(() => source.value.id, reload, { flush: 'sync' })
  watch(stamp, () => {
    if (original === canonical(draft.value)) reload()
  })
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
    if (baseStamp !== stamp.value) {
      ElMessage.warning('队伍或精灵引用已变化，请重新打开队伍再保存')
      return false
    }
    if (original === canonical(draft.value)) return storage.saveToLocal()
    const saved = storage.updateTeamOrder(storage.currentTeamIndex, draft.value, scope)
    if (saved) reload()
    return saved
  }
  return {
    team: draft,
    affected,
    warehouse: {
      pets: computed(() => storage.storage),
      teamsUsing: id => storage.affectedTeams(id),
      replace(current, next) {
        if (baseStamp !== stamp.value || original !== canonical(draft.value)) {
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
      if (!affected.value.length && original !== canonical(draft.value)) commit()
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
