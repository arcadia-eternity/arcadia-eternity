import { ref, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { nanoid } from 'nanoid'
import { parse } from 'yaml'
import { z } from 'zod'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import { PetSetSchema } from '@arcadia-eternity/schema'
import { Gender } from '@arcadia-eternity/const'
import { usePetStorageStore } from '@/stores/petStorage'
import { useGameDataStore } from '@/stores/gameData'

export interface ContextMenuItem {
  label: string
  iconPath: string
  action: () => void
  disabled?: boolean
  danger?: boolean
}

export interface ContextMenuState {
  visible: boolean
  position: { x: number; y: number }
  items: ContextMenuItem[]
}

export function usePetManagement() {
  const petStorage = usePetStorageStore()
  const gameDataStore = useGameDataStore()

  // 右键菜单状态
  const contextMenu = ref<ContextMenuState>({
    visible: false,
    position: { x: 0, y: 0 },
    items: [],
  })

  // 精灵详情状态
  const showPetDetail = ref(false)
  const selectedPetForDetail = ref<PetSchemaType | null>(null)

  /**
   * 获取默认性别
   */
  function getDefaultGender(speciesId: string): Gender {
    const species = gameDataStore.getSpecies(speciesId)
    if (!species?.genderRatio) return Gender.NoGender
    return species.genderRatio[0] > 0 ? Gender.Female : Gender.Male
  }

  /**
   * 导入队伍配置 (YAML/JSON格式)
   */
  async function importTeamConfig(): Promise<void> {
    try {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,.yaml,.yml'

      input.onchange = async e => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return

        const reader = new FileReader()
        reader.onload = async e => {
          try {
            const content = e.target?.result?.toString() || ''
            const parsedData = parse(content, {
              strict: true,
              maxAliasCount: 100,
            })

            const importedTeam = PetSetSchema.parse(parsedData)

            if (importedTeam.length < 1 || importedTeam.length > 6) {
              throw new Error('队伍数量必须在1-6之间')
            }

            const newTeam = importedTeam.map(pet => ({
              ...pet,
              id: nanoid(),
              skills: pet.skills.slice(0, 5),
              gender: pet.gender ?? getDefaultGender(pet.species),
              height: pet.height ?? gameDataStore.getSpecies(pet.species)?.heightRange[1] ?? 0,
              weight: pet.weight ?? gameDataStore.getSpecies(pet.species)?.weightRange[1] ?? 0,
            }))

            // 创建新队伍
            const teamName = `导入队伍 ${new Date().toLocaleString()}`
            petStorage.createNewTeam(teamName)
            const newTeamIndex = petStorage.teams.length - 1

            // 将导入的精灵添加到新队伍
            newTeam.forEach(pet => {
              petStorage.storage.push(pet)
              petStorage.moveToTeam(pet.id, newTeamIndex)
            })

            // 切换到新导入的队伍
            petStorage.switchTeam(newTeamIndex)

            petStorage.saveToLocal()
            ElMessage.success(`成功导入 ${newTeam.length} 只精灵到新队伍 "${teamName}"并已切换到该队伍（${file.name}）`)
          } catch (err) {
            console.error('导入失败:', err)
            const errorMsg =
              err instanceof z.ZodError ? `YAML/JSON格式校验失败: ${err.errors[0].message}` : (err as Error).message

            ElMessage.error(`导入失败: ${errorMsg}`)
          }
        }
        reader.readAsText(file)
      }

      input.click()
    } catch (err) {
      ElMessage.error('导入过程中发生错误')
    }
  }

  /**
   * 导入队伍 (JSON格式，包含队伍名称)
   */
  function importTeam(): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'

    input.onchange = event => {
      const file = (event.target as HTMLInputElement).files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = e => {
        try {
          const teamData = JSON.parse(e.target?.result as string)

          if (!teamData.name || !Array.isArray(teamData.pets)) {
            throw new Error('无效的队伍文件格式')
          }

          petStorage.createNewTeam(teamData.name)
          const newTeamIndex = petStorage.teams.length - 1

          teamData.pets.forEach((pet: PetSchemaType) => {
            const petCopy = { ...pet, id: nanoid() }
            petStorage.storage.push(petCopy)
            petStorage.moveToTeam(petCopy.id, newTeamIndex)
          })

          // 切换到新导入的队伍
          petStorage.switchTeam(newTeamIndex)

          petStorage.saveToLocal()
          ElMessage.success(`成功导入队伍 "${teamData.name}"并已切换到该队伍！`)
        } catch (error) {
          console.error('导入失败:', error)
          ElMessage.error('导入失败：文件格式错误或数据无效')
        }
      }
      reader.readAsText(file)
    }

    input.click()
  }

  /**
   * 移动精灵到仓库
   */
  function moveToStorage(petId: string, onSuccess?: () => void): void {
    const success = petStorage.moveToPC(petId)

    if (success) {
      onSuccess?.()
      ElMessage.success('精灵已移入仓库')
    } else {
      ElMessage.error('移动精灵失败，请重试')
    }
  }

  /**
   * 添加精灵到当前队伍
   */
  function addToCurrentTeam(pet: PetSchemaType, onSuccess?: () => void): void {
    const currentTeam = petStorage.teams[petStorage.currentTeamIndex]
    if (currentTeam.pets.length >= 6) {
      ElMessage.warning('当前队伍已满')
      return
    }

    const petInStorage = petStorage.storage.find(p => p.id === pet.id)
    const petInTeams = petStorage.teams.some(team => team.pets.some(p => p.id === pet.id))

    if (!petInStorage && !petInTeams) {
      ElMessage.error('精灵不存在')
      return
    }

    try {
      const success = petStorage.moveToTeam(pet.id, petStorage.currentTeamIndex)

      if (success) {
        onSuccess?.()
        ElMessage.success(`精灵 ${pet.name} 已加入队伍`)
      } else {
        ElMessage.error('移动精灵失败，请重试')
      }
    } catch (error) {
      ElMessage.error('移动精灵失败，请重试')
    }
  }

  /**
   * 移动精灵到指定队伍
   */
  function moveToTeam(petId: string, teamIndex: number, onSuccess?: () => void): void {
    petStorage.moveToTeam(petId, teamIndex)
    onSuccess?.()
    ElMessage.success(`精灵已移动到 ${petStorage.teams[teamIndex].name}`)
  }

  /**
   * 删除精灵
   */
  async function deletePet(petId: string, onSuccess?: () => void): Promise<void> {
    try {
      // 添加调试日志
      console.log('开始删除精灵确认流程:', petId)

      const result = await ElMessageBox.confirm('确定要永久删除此精灵吗？此操作无法撤销！', '删除精灵', {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        customStyle: {
          zIndex: '10000', // 确保确认框在最顶层
        },
        // 移动端优化
        center: true,
        showClose: true,
        // 防止被其他事件干扰
        closeOnClickModal: false,
        closeOnPressEscape: true,
        beforeClose: (action, _instance, done) => {
          console.log('确认框关闭动作:', action)
          done()
        },
      })

      console.log('用户确认删除:', result)
      petStorage.removeFromStorage(petId)
      petStorage.saveToLocal()
      onSuccess?.()
      ElMessage.success('精灵删除成功')
    } catch (error) {
      console.log('删除操作被取消或出错:', error)
      // 用户取消或出错
    }
  }

  /**
   * 复制精灵
   */
  function copyPet(pet: PetSchemaType): void {
    try {
      const petCopy = JSON.parse(JSON.stringify(pet))
      petCopy.id = nanoid()
      petCopy.name = `${pet.name} (副本)`

      petStorage.storage.push(petCopy)
      petStorage.saveToLocal()
      ElMessage.success('精灵复制成功！')
    } catch (error) {
      console.error('复制失败:', error)
      ElMessage.error('复制失败，请重试')
    }
  }

  /**
   * 显示精灵详情
   */
  function showPetDetails(pet: PetSchemaType): void {
    selectedPetForDetail.value = pet
    showPetDetail.value = true
  }

  /**
   * 显示仓库精灵右键菜单
   */
  function showContextMenu(event: MouseEvent, pet: PetSchemaType, onSuccess?: () => void): void {
    event.preventDefault()

    const currentTeam = petStorage.teams[petStorage.currentTeamIndex]
    const canAddToTeam = currentTeam.pets.length < 6

    contextMenu.value = {
      visible: true,
      position: { x: event.clientX, y: event.clientY },
      items: [
        {
          label: '快速移动到当前队伍',
          iconPath: 'M17 8l4 4m0 0l-4 4m4-4H3',
          action: () => addToCurrentTeam(pet, onSuccess),
          disabled: !canAddToTeam,
        },
        {
          label: '查看详情',
          iconPath:
            'M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
          action: () => showPetDetails(pet),
        },
        {
          label: '复制精灵',
          iconPath:
            'M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z',
          action: () => copyPet(pet),
        },
        {
          label: '永久删除',
          iconPath:
            'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
          action: () => deletePet(pet.id, onSuccess),
          danger: true,
        },
      ],
    }
  }

  /**
   * 显示队伍精灵右键菜单
   */
  function showTeamPetContextMenu(
    event: MouseEvent,
    pet: PetSchemaType,
    teamIndex: number,
    onSuccess?: () => void,
  ): void {
    event.preventDefault()

    const otherTeams = petStorage.teams.filter((_, index) => index !== teamIndex && _.pets.length < 6)

    const menuItems: ContextMenuItem[] = [
      {
        label: '查看详情',
        iconPath:
          'M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
        action: () => showPetDetails(pet),
      },
      {
        label: '复制精灵',
        iconPath:
          'M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z',
        action: () => copyPet(pet),
      },
      {
        label: '移回仓库',
        iconPath: 'M7 16l-4-4m0 0l4-4m-4 4h18',
        action: () => moveToStorage(pet.id, onSuccess),
      },
    ]

    // 添加移动到其他队伍的选项
    otherTeams.forEach(team => {
      const realIndex = petStorage.teams.findIndex(t => t === team)
      menuItems.splice(-1, 0, {
        label: `移动到 ${team.name}`,
        iconPath: 'M17 8l4 4m0 0l-4 4m4-4H3',
        action: () => moveToTeam(pet.id, realIndex, onSuccess),
      })
    })

    contextMenu.value = {
      visible: true,
      position: { x: event.clientX, y: event.clientY },
      items: menuItems,
    }
  }

  return {
    // 状态
    contextMenu,
    showPetDetail,
    selectedPetForDetail,

    // 方法
    importTeamConfig,
    importTeam,
    moveToStorage,
    addToCurrentTeam,
    moveToTeam,
    deletePet,
    copyPet,
    showPetDetails,
    showContextMenu,
    showTeamPetContextMenu,
    getDefaultGender,

    // 关闭菜单
    closeContextMenu: () => {
      contextMenu.value.visible = false
    },
  }
}
