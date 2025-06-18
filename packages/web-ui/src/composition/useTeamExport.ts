// src/composables/useTeamExport.ts
import { ElMessage } from 'element-plus'
import { stringify } from 'yaml'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import { usePetStorageStore } from '@/stores/petStorage'

export function useTeamExport() {
  const petStorage = usePetStorageStore()

  /**
   * 导出队伍配置为YAML格式 (teamBuilder使用)
   */
  function exportTeamConfig(team: PetSchemaType[]): void {
    try {
      const filename = `team-${new Date().toISOString().slice(0, 10)}.yaml`

      // 创建数据副本
      const exportData = team.map(pet => ({
        ...pet,
        id: undefined,
        maxHp: undefined,
      }))

      // 使用YAML序列化
      const content = stringify(exportData, {
        indent: 2,
        aliasDuplicateObjects: false,
      })

      // 创建下载链接
      const blob = new Blob([content], {
        type: 'application/yaml',
      })

      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = filename
      link.click()

      URL.revokeObjectURL(link.href)

      ElMessage.success('队伍配置已导出为YAML格式')
    } catch (err) {
      console.error('导出失败:', err)
      ElMessage.error('导出失败，请检查队伍数据')
    }
  }

  /**
   * 导出队伍为JSON格式 (storageManager使用)
   */
  function exportTeam(index: number): void {
    try {
      const team = petStorage.teams[index]
      if (!team || team.pets.length === 0) {
        ElMessage.warning('队伍为空，无法导出')
        return
      }

      const teamData = {
        name: team.name,
        pets: team.pets,
      }

      const dataStr = JSON.stringify(teamData, null, 2)
      const dataBlob = new Blob([dataStr], { type: 'application/json' })
      const url = URL.createObjectURL(dataBlob)

      const link = document.createElement('a')
      link.href = url
      link.download = `${team.name}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      ElMessage.success('队伍导出成功！')
    } catch (error) {
      console.error('导出失败:', error)
      ElMessage.error('导出失败，请重试')
    }
  }

  return {
    exportTeamConfig,
    exportTeam,
  }
}
