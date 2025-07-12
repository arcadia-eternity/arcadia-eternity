// src/stores/petStorage.ts
import { defineStore } from 'pinia'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import { PetSchema, PetSetSchema } from '@arcadia-eternity/schema'
import { Gender, Nature } from '@arcadia-eternity/const'
import { nanoid } from 'nanoid'
import { z } from 'zod'

interface Team {
  name: string
  pets: PetSchemaType[]
  ruleSetId: string // 队伍对应的规则集ID
}

interface PetStorageState {
  storage: PetSchemaType[]
  teams: Team[]
  currentTeamIndex: number
  initialized: boolean
}

// Zod 校验 schema
const TeamSchema = z.object({
  name: z.string().min(1, '队伍名称不能为空'),
  pets: PetSetSchema.max(6, '队伍最多只能有6只精灵'),
  ruleSetId: z.string().min(1, '规则集ID不能为空'),
})

const PetStorageStateSchema = z.object({
  storage: PetSetSchema,
  teams: z.array(TeamSchema).min(1, '至少需要一个队伍'),
  currentTeamIndex: z.number().int().min(0, '当前队伍索引不能为负数'),
})

// 定义持久化数据的类型（不包含initialized）
type PersistentPetStorageData = Omit<PetStorageState, 'initialized'>

// 校验函数
function validatePetStorageData(data: unknown): { valid: boolean; data?: PersistentPetStorageData; errors?: string[] } {
  try {
    const validatedData = PetStorageStateSchema.parse(data)

    // 额外校验：确保 currentTeamIndex 不超出 teams 数组范围
    if (validatedData.currentTeamIndex >= validatedData.teams.length) {
      return {
        valid: false,
        errors: [
          `当前队伍索引 ${validatedData.currentTeamIndex} 超出了队伍数量范围 (0-${validatedData.teams.length - 1})`,
        ],
      }
    }

    return { valid: true, data: validatedData }
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.issues.map(err => {
        const path = err.path.length > 0 ? err.path.join('.') : '根对象'
        return `${path}: ${err.message}`
      })
      return { valid: false, errors }
    }
    return { valid: false, errors: ['未知的校验错误'] }
  }
}

const getDefaultTeam = (): Team => ({
  name: '默认队伍',
  ruleSetId: 'casual_standard_ruleset', // 默认使用休闲规则集
  pets: [
    {
      id: nanoid(),
      name: '休罗斯',
      species: 'pet_xiuluosi',
      level: 100,
      evs: { hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      skills: ['skill_dixiulazhinu', 'skill_lieyanjuexiji', 'skill_qili', 'skill_fenlitupo', 'skill_yanggong'],
      gender: Gender.Male,
      nature: Nature.Jolly,
      ability: 'mark_ability_yanhuo',
      emblem: 'mark_emblem_nuhuo',
      height: 77,
      weight: 39,
    },
    {
      id: nanoid(),
      name: '迪兰特',
      species: 'pet_dilante',
      level: 100,
      evs: { hp: 4, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      skills: ['skill_wujindaxuanwo', 'skill_ruodianbiaoji', 'skill_feiliupubu', 'skill_yanmo', 'skill_shuihuajianshe'],
      gender: Gender.Male,
      nature: Nature.Modest,
      ability: 'mark_ability_zhongjie',
      emblem: 'mark_emblem_zhuiji',
      height: 102,
      weight: 31,
    },
    {
      id: nanoid(),
      name: '拉奥叶',
      species: 'pet_laaoye',
      level: 100,
      evs: { hp: 4, atk: 0, def: 252, spa: 0, spd: 252, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      skills: ['skill_laaodehuhuan', 'skill_xueruo', 'skill_qianyesha', 'skill_jishengzhongzi', 'skill_jishengzhadan'],
      gender: Gender.Female,
      nature: Nature.Bold,
      ability: 'mark_ability_jianren',
      emblem: 'mark_emblem_zhiyu',
      height: 83,
      weight: 33,
    },
  ],
})

export const usePetStorageStore = defineStore('petStorage', {
  state: (): PetStorageState => ({
    storage: [],
    teams: [getDefaultTeam()],
    currentTeamIndex: 0,
    initialized: false,
  }),

  actions: {
    loadFromLocal() {
      const saved = localStorage.getItem('petStorage')
      if (saved) {
        try {
          const parsedData = JSON.parse(saved)

          // 数据迁移：为没有gameMode的队伍添加默认gameMode
          if (parsedData.teams && Array.isArray(parsedData.teams)) {
            let needsMigration = false
            parsedData.teams = parsedData.teams.map((team: any) => {
              if (!team.gameMode) {
                needsMigration = true
                return {
                  ...team,
                  gameMode: 'casual', // 为旧队伍设置默认的休闲模式
                }
              }
              return team
            })

            if (needsMigration) {
              console.log('检测到旧版本队伍数据，已自动迁移到新格式')
            }
          }

          const validation = validatePetStorageData(parsedData)

          if (validation.valid && validation.data) {
            // 只更新持久化的数据，不包含initialized
            this.storage = validation.data.storage
            this.teams = validation.data.teams
            this.currentTeamIndex = validation.data.currentTeamIndex
            this.initialized = true // 加载完成后设置为已初始化

            // 如果进行了数据迁移，保存更新后的数据
            if (parsedData.teams && Array.isArray(parsedData.teams)) {
              const hasMigration = parsedData.teams.some((team: any) => team.gameMode === 'casual')
              if (hasMigration) {
                this.saveToLocal()
              }
            }
          } else {
            // 校验失败，显示错误提示并重置为默认数据
            const errorMessage = validation.errors?.join('; ') || '数据格式错误'
            ElMessage.error(`精灵仓库数据校验失败: ${errorMessage}`)
            console.error('精灵仓库数据校验失败:', validation.errors)

            // 重置为默认数据
            this.resetToDefault()
            ElMessage.warning('已重置为默认数据')
          }
        } catch (error) {
          // JSON 解析失败
          ElMessage.error('精灵仓库数据解析失败，已重置为默认数据')
          console.error('精灵仓库数据解析失败:', error)
          this.resetToDefault()
        }
      }
    },

    resetToDefault() {
      this.storage = []
      this.teams = [getDefaultTeam()]
      this.currentTeamIndex = 0
      this.initialized = true // 重置后也设置为已初始化
      this.saveToLocal()
    },

    // 校验当前状态并保存
    validateAndSave(): boolean {
      const currentState = {
        storage: this.storage,
        teams: this.teams,
        currentTeamIndex: this.currentTeamIndex,
      }

      const validation = validatePetStorageData(currentState)

      if (validation.valid) {
        this.saveToLocal()
        return true
      } else {
        // 校验失败，只显示错误提示，不自动重置数据
        const errorMessage = validation.errors?.join('; ') || '数据格式错误'
        ElMessage.error(`数据校验失败: ${errorMessage}`)
        console.error('精灵仓库数据校验失败:', validation.errors)
        return false
      }
    },

    saveToLocal() {
      localStorage.setItem(
        'petStorage',
        JSON.stringify({
          storage: this.storage,
          teams: this.teams,
          currentTeamIndex: this.currentTeamIndex,
        }),
      )
    },

    clearStorage() {
      this.storage = []
      this.teams = []
      this.currentTeamIndex = 0
      this.createNewTeam()
      this.validateAndSave()
    },

    updateTeamOrder(teamIndex: number, newOrder: PetSchemaType[]) {
      if (teamIndex >= 0 && teamIndex < this.teams.length) {
        this.teams[teamIndex].pets = newOrder
        this.validateAndSave()
      }
    },

    // 其他方法保持原有逻辑，移除playerId参数
    addToStorage(pet: PetSchemaType) {
      // 先校验单个精灵数据
      try {
        PetSchema.parse(pet)
        this.storage.push(pet)
        this.validateAndSave()
      } catch (error) {
        if (error instanceof z.ZodError) {
          const errorMessage = error.issues.map(err => err.message).join('; ')
          ElMessage.error(`精灵数据校验失败: ${errorMessage}`)
          console.error('精灵数据校验失败:', error.issues)
        } else {
          ElMessage.error('添加精灵失败')
          console.error('添加精灵失败:', error)
        }
      }
    },

    createNewTeam(name?: string, ruleSetId: string = 'casual_standard_ruleset', includeDefaultPets: boolean = true) {
      const teamName = name || `队伍 ${this.teams.length + 1}`

      if (includeDefaultPets) {
        this.teams.push({
          ...getDefaultTeam(),
          name: teamName,
          ruleSetId,
        })
      } else {
        // 创建空队伍，不包含默认精灵
        this.teams.push({
          name: teamName,
          ruleSetId,
          pets: [],
        })
      }

      this.currentTeamIndex = this.teams.length - 1
      this.validateAndSave()
    },

    switchTeam(index: number) {
      if (index >= 0 && index < this.teams.length) {
        this.currentTeamIndex = index
        this.validateAndSave()
        return true
      }
      return false
    },

    // 规则集相关方法
    getCurrentTeamRuleSetId(): string {
      const team = this.teams[this.currentTeamIndex]
      return team?.ruleSetId || 'casual_standard_ruleset'
    },

    getTeamRuleSetId(index: number): string {
      const team = this.teams[index]
      return team?.ruleSetId || 'casual_standard_ruleset'
    },

    updateTeamRuleSetId(index: number, ruleSetId: string) {
      if (index >= 0 && index < this.teams.length) {
        this.teams[index].ruleSetId = ruleSetId
        this.validateAndSave()
      }
    },

    moveToTeam(petId: string, targetTeamIndex: number) {
      // 检查目标队伍是否存在且未满
      if (!this.teams[targetTeamIndex] || this.teams[targetTeamIndex].pets.length >= 6) {
        console.error('Target team does not exist or is full:', targetTeamIndex)
        return false
      }

      let pet: PetSchemaType | undefined = undefined

      // 首先从其他队伍中查找并移除精灵
      this.teams.forEach(team => {
        const index = team.pets.findIndex(p => p.id === petId)
        if (index > -1) {
          pet = team.pets[index]
          team.pets.splice(index, 1)
        }
      })

      // 如果在队伍中没找到，从仓库中查找
      if (!pet) {
        const storageIndex = this.storage.findIndex(p => p.id === petId)
        if (storageIndex > -1) {
          pet = this.storage[storageIndex]
          this.storage.splice(storageIndex, 1)
        }
      } else {
        // 如果从队伍中找到了，也要从仓库中移除（如果存在）
        const storageIndex = this.storage.findIndex(p => p.id === petId)
        if (storageIndex > -1) {
          this.storage.splice(storageIndex, 1)
        }
      }

      // 添加到目标队伍
      if (pet) {
        this.teams[targetTeamIndex].pets.push(pet)
        this.validateAndSave()
        return true
      } else {
        return false
      }
    },

    getCurrentTeam(): PetSchemaType[] {
      return this.teams[this.currentTeamIndex].pets
    },

    moveToPC(petId: string) {
      let moved = false
      this.teams.forEach(team => {
        const index = team.pets.findIndex(p => p.id === petId)
        if (index > -1) {
          const [removedPet] = team.pets.splice(index, 1)
          // 添加到仓库（如果不存在）
          if (!this.storage.some(p => p.id === petId)) {
            this.storage.push(removedPet)
            moved = true
          }
        }
      })
      if (moved) {
        this.validateAndSave()
      }
      return moved
    },

    updateTeam(index: number, newTeam: PetSchemaType[]) {
      if (index >= 0 && index < this.teams.length) {
        this.teams[index].pets = newTeam
        this.validateAndSave()
      }
    },

    deleteTeam(index: number) {
      if (this.teams.length <= 1) return
      this.teams.splice(index, 1)
      this.currentTeamIndex = Math.min(this.currentTeamIndex, this.teams.length - 1)
      this.validateAndSave()
    },

    getTeam(index: number) {
      return this.teams[index] || []
    },

    removeFromStorage(petId: string) {
      let removed = false
      this.teams.forEach(team => {
        const index = team.pets.findIndex(p => p.id === petId)
        if (index > -1) {
          team.pets.splice(index, 1)
          removed = true
        }
      })
      const index = this.storage.findIndex(p => p.id === petId)
      if (index > -1) {
        this.storage.splice(index, 1)
        removed = true
      }
      if (removed) {
        this.validateAndSave()
      }
    },
  },
  getters: {
    currentTeam(): PetSchemaType[] {
      return this.teams[this.currentTeamIndex].pets
    },
  },
})
