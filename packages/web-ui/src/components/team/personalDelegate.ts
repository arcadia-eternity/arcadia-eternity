import { computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { nanoid } from 'nanoid'
import { Gender, Nature } from '@arcadia-eternity/const'
import { usePetStorageStore } from '@/stores/petStorage'
import { usePlayerStore } from '@/stores/player'
import { usePetManagement } from '@/composition/usePetManagement'
import { useTeamExport } from '@/composition/useTeamExport'
import type { TeamEditorDelegate } from './delegate'

export function usePersonalTeamEditor(): TeamEditorDelegate {
  const storage = usePetStorageStore()
  const player = usePlayerStore()
  const management = usePetManagement()
  const exporter = useTeamExport()
  return {
    team: computed({
      get: () => storage.getCurrentTeam(),
      set: value => storage.updateTeamOrder(storage.currentTeamIndex, value),
    }),
    name: computed(() => storage.teams[storage.currentTeamIndex]?.name || '未知队伍'),
    subtitle: computed(() => player.name || '未命名训练师'),
    ready: computed(() => storage.initialized),
    persist: () => storage.saveToLocal(),
    createPet() {
      return {
        id: nanoid(),
        name: '迪兰特',
        species: 'pet_dilante',
        level: 100,
        evs: { hp: 4, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 },
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
        skills: ['skill_wujindaxuanwo', 'skill_ruodianbiaoji', 'skill_feiliupubu', 'skill_yanmo'], // 4个普通技能，必杀技能会在handleSpeciesChange中自动添加
        gender: Gender.Male,
        nature: Nature.Modest,
        ability: 'mark_ability_zhongjie',
        emblem: 'mark_emblem_zhuiji',
        height: 102,
        weight: 31,
      }
    },
    removePet: management.deletePet,
    removeLabel: '永久删除',
    storageRoute: '/storage',
    moveToStorage: management.moveToStorage,
    importTeam: management.importTeamConfig,
    exportTeam: exporter.exportTeamConfig,
    save: () => storage.validateAndSave(),
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
