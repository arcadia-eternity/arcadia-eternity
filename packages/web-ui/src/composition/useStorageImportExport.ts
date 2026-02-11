import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { nanoid } from 'nanoid'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import { PetSchema, parseWithErrors } from '@arcadia-eternity/schema'
import { usePetStorageStore } from '@/stores/petStorage'

// 仓库数据结构定义
interface StorageData {
  version: string
  exportDate: string
  storage: PetSchemaType[]
  teams: Array<{
    name: string
    pets: PetSchemaType[]
  }>
}

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
      const storageData: StorageData = {
        version: '1.0.0',
        exportDate: new Date().toISOString(),
        storage: petStorage.storage,
        teams: petStorage.teams,
      }

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
        version: '1.0.0',
        exportDate: new Date().toISOString(),
        storage: petStorage.storage,
        teams: [],
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
  function validateImportData(data: any): StorageData | null {
    try {
      // 基本结构验证
      if (!data || typeof data !== 'object') {
        throw new Error('无效的数据格式')
      }

      // 检查必要字段
      if (!data.storage || !Array.isArray(data.storage)) {
        throw new Error('缺少有效的仓库数据')
      }

      if (!data.teams || !Array.isArray(data.teams)) {
        throw new Error('缺少有效的队伍数据')
      }

      // 验证精灵数据
      const validatedStorage: PetSchemaType[] = []
      for (const pet of data.storage) {
        try {
          const validatedPet = parseWithErrors(PetSchema, pet)
          validatedStorage.push(validatedPet)
        } catch (error) {
          console.warn('跳过无效精灵数据:', pet, error)
        }
      }

      // 验证队伍数据
      const validatedTeams: Array<{ name: string; pets: PetSchemaType[] }> = []
      for (const team of data.teams) {
        if (!team.name || typeof team.name !== 'string') {
          console.warn('跳过无效队伍数据:', team)
          continue
        }

        const validatedPets: PetSchemaType[] = []
        if (Array.isArray(team.pets)) {
          for (const pet of team.pets) {
            try {
              const validatedPet = parseWithErrors(PetSchema, pet)
              validatedPets.push(validatedPet)
            } catch (error) {
              console.warn('跳过队伍中的无效精灵数据:', pet, error)
            }
          }
        }

        validatedTeams.push({
          name: team.name,
          pets: validatedPets,
        })
      }

      return {
        version: data.version || '1.0.0',
        exportDate: data.exportDate || new Date().toISOString(),
        storage: validatedStorage,
        teams: validatedTeams,
      }
    } catch (error) {
      ElMessage.error(`数据验证失败: ${error instanceof Error ? error.message : '未知错误'}`)
      return null
    }
  }

  /**
   * 生成唯一ID
   */
  function generateUniqueIds(pets: PetSchemaType[]): PetSchemaType[] {
    return pets.map(pet => ({
      ...pet,
      id: nanoid(),
    }))
  }

  /**
   * 执行导入操作
   */
  async function performImport(data: StorageData, options: ImportOptions): Promise<void> {
    try {
      if (options.mode === 'replace') {
        // 替换模式：清空现有数据
        const confirmReplace = await ElMessageBox.confirm(
          '替换模式将清空所有现有数据，此操作无法撤销！确定要继续吗？',
          '确认替换',
          {
            confirmButtonText: '确定替换',
            cancelButtonText: '取消',
            type: 'warning',
            customStyle: { zIndex: '10000' },
          },
        )

        if (confirmReplace) {
          petStorage.clearStorage()
        } else {
          return
        }
      }

      let importedPetsCount = 0
      let importedTeamsCount = 0

      // 导入仓库精灵
      if (options.importStorage && data.storage.length > 0) {
        const uniquePets = generateUniqueIds(data.storage)
        petStorage.storage.push(...uniquePets)
        importedPetsCount = uniquePets.length
      }

      // 导入队伍
      if (options.importTeams && data.teams.length > 0) {
        for (const teamData of data.teams) {
          // 检查队伍名称是否已存在
          let teamName = teamData.name
          let counter = 1
          while (petStorage.teams.some(t => t.name === teamName)) {
            teamName = `${teamData.name} (${counter})`
            counter++
          }

          // 创建新队伍（不包含默认精灵）
          petStorage.createNewTeam(teamName, 'casual', false)
          const newTeamIndex = petStorage.teams.length - 1

          // 添加精灵到队伍
          if (teamData.pets.length > 0) {
            const uniquePets = generateUniqueIds(teamData.pets)
            // 先添加到仓库，再移动到队伍
            petStorage.storage.push(...uniquePets)
            for (const pet of uniquePets) {
              petStorage.moveToTeam(pet.id, newTeamIndex)
            }
          }

          importedTeamsCount++
        }
      }

      petStorage.saveToLocal()

      // 显示导入结果
      const messages = []
      if (importedPetsCount > 0) {
        messages.push(`${importedPetsCount} 只精灵`)
      }
      if (importedTeamsCount > 0) {
        messages.push(`${importedTeamsCount} 个队伍`)
      }

      ElMessage.success(`导入成功！已导入 ${messages.join('、')}`)
    } catch (error) {
      console.error('导入失败:', error)
      ElMessage.error('导入失败，请重试')
    }
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
