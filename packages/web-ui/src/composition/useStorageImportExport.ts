import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { nanoid } from 'nanoid'
import { PetSchema, parseWithErrors } from '@arcadia-eternity/schema'
import { usePetStorageStore } from '@/stores/petStorage'

import {
  migrateEmbeddedLibrary,
  newPersonalTeam,
  validateLibrary,
  type PersonalLibrary,
} from '@arcadia-eternity/local-profile'
type StorageData = PersonalLibrary
// 导入选项
interface ImportOptions {
  mode: 'merge' | 'replace'
  importStorage: boolean
  importTeams: boolean
}

export function useStorageImportExport() {
  const petStorage = usePetStorageStore()
  const showImportDialog = ref(false)
  const pendingImportData = ref<StorageData | null>(null)
  const importOptions = ref<ImportOptions>({
    mode: 'merge',
    importStorage: true,
    importTeams: true,
  })

  /**
   * 导出完整仓库数据
   */
  function exportFullStorage(): void {
    try {
      const storageData = { format: 'arcadia.storage', library: petStorage.library }

      const dataStr = JSON.stringify(storageData, null, 2)
      const dataBlob = new Blob([dataStr], { type: 'application/json' })
      const url = URL.createObjectURL(dataBlob)

      const link = document.createElement('a')
      link.href = url
      link.download = `arcadia-storage-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      ElMessage.success('仓库数据导出成功！')
    } catch (error) {
      console.error('导出失败:', error)
      ElMessage.error('导出失败，请重试')
    }
  }

  /**
   * 导出仅仓库精灵数据
   */
  function exportStorageOnly(): void {
    try {
      if (petStorage.storage.length === 0) {
        ElMessage.warning('仓库为空，无法导出')
        return
      }

      const storageData = {
        format: 'arcadia.storage',
        library: { ...petStorage.library, teams: [], currentTeamIndex: 0 },
      }

      const dataStr = JSON.stringify(storageData, null, 2)
      const dataBlob = new Blob([dataStr], { type: 'application/json' })
      const url = URL.createObjectURL(dataBlob)

      const link = document.createElement('a')
      link.href = url
      link.download = `arcadia-storage-pets-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      ElMessage.success('仓库精灵数据导出成功！')
    } catch (error) {
      console.error('导出失败:', error)
      ElMessage.error('导出失败，请重试')
    }
  }

  /**
   * 验证导入数据格式
   */
  function validateImportData(data: unknown): StorageData | null {
    try {
      if (!data || typeof data !== 'object') throw new Error('无效的数据格式')
      const record = data as Record<string, unknown>
      let library: PersonalLibrary
      if (record.format === 'arcadia.storage') {
        library = record.library as PersonalLibrary
      } else {
        if (
          record.format !== undefined ||
          (record.version !== undefined && record.version !== '1.0.0') ||
          !Array.isArray(record.storage) ||
          !Array.isArray(record.teams)
        )
          throw new Error('仓库格式无效')
        const readPet = (pet: unknown) => parseWithErrors(PetSchema, pet)
        library = migrateEmbeddedLibrary({
          storage: record.storage.map(readPet),
          currentTeamIndex: 0,
          teams: record.teams.map(team => ({
            name: team.name,
            ruleSetId: team.ruleSetId ?? 'casual_standard_ruleset',
            pets: team.pets.map(readPet),
          })),
        })
      }
      if (!library.teams.length) {
        const checked = validateLibrary({ ...library, teams: [newPersonalTeam('仓库', 'casual_standard_ruleset')] })
        return { ...checked, teams: [] }
      }
      return validateLibrary(library)
    } catch (error) {
      ElMessage.error(`数据验证失败: ${error instanceof Error ? error.message : '未知错误'}`)
      return null
    }
  }

  async function performImport(data: StorageData, options: ImportOptions): Promise<void> {
    if (!options.importStorage && !options.importTeams) throw new Error('请选择导入内容')
    if (options.mode === 'replace')
      await ElMessageBox.confirm('替换当前仓库及所有队伍？', '替换仓库', {
        confirmButtonText: '替换',
        cancelButtonText: '取消',
        type: 'warning',
      })
    const next: PersonalLibrary =
      options.mode === 'replace'
        ? { version: 2, currentTeamIndex: 0, storage: [], teams: [] }
        : JSON.parse(JSON.stringify(petStorage.library))
    const teams = options.importTeams ? data.teams : []
    const selected = new Set(teams.flatMap(team => team.memberIds))
    const mapping = new Map<string, string>()
    for (const pet of data.storage) {
      if (!options.importStorage && !selected.has(pet.id)) continue
      const id = nanoid()
      mapping.set(pet.id, id)
      next.storage.push({ ...pet, id, revision: 1 })
    }
    const offset = next.teams.length
    for (const team of teams)
      next.teams.push({ ...team, id: nanoid(), revision: 1, memberIds: team.memberIds.map(id => mapping.get(id)!) })
    if (!next.teams.length) next.teams.push(newPersonalTeam('默认队伍', 'casual_standard_ruleset'))
    if (teams.length) next.currentTeamIndex = offset + data.currentTeamIndex
    if (!petStorage.applyLibrary(next)) throw new Error('仓库未保存')
    ElMessage.success(`已导入 ${mapping.size} 只精灵、${teams.length} 支队伍`)
  }

  /**
   * 导入仓库数据
   */
  function importStorage(): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'

    input.onchange = async event => {
      const file = (event.target as HTMLInputElement).files?.[0]
      if (!file) return

      try {
        const text = await file.text()
        const data = JSON.parse(text)
        const validatedData = validateImportData(data)

        if (!validatedData) {
          return
        }

        // 显示导入选项对话框，存储待导入数据
        pendingImportData.value = validatedData
        showImportDialog.value = true
      } catch (error) {
        console.error('文件读取失败:', error)
        ElMessage.error('文件读取失败，请检查文件格式')
      }
    }

    input.click()
  }

  /**
   * 确认导入
   */
  async function confirmImport(): Promise<void> {
    if (!pendingImportData.value) {
      ElMessage.error('没有待导入的数据')
      return
    }

    try {
      await performImport(pendingImportData.value, importOptions.value)
      showImportDialog.value = false
      pendingImportData.value = null
    } catch (error) {
      console.error('导入确认失败:', error)
      ElMessage.error('导入失败，请重试')
    }
  }

  /**
   * 取消导入
   */
  function cancelImport(): void {
    showImportDialog.value = false
    pendingImportData.value = null
  }

  return {
    // 状态
    showImportDialog,
    pendingImportData,
    importOptions,

    // 导出功能
    exportFullStorage,
    exportStorageOnly,

    // 导入功能
    importStorage,
    confirmImport,
    cancelImport,

    // 工具函数
    validateImportData,
    performImport,
  }
}
