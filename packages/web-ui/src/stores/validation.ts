import { defineStore } from 'pinia'
import { ref, computed, markRaw } from 'vue'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import { ClientRuleIntegration, GlobalRuleRegistry } from '@arcadia-eternity/rules'
import { useGameDataStore } from '@/stores/gameData'

export interface RuleSet {
  id: string
  name: string
  description: string
  ruleCount: number
}

export interface RuleInfo {
  id: string
  name: string
  description: string
  enabled: boolean
  priority: number
  tags: string[]
  impact: string // 规则的具体影响描述
}

export interface ValidationError {
  type: string
  code: string
  message: string
  objectId?: string
  objectType?: string
  context?: Record<string, any>
}

export interface ValidationWarning {
  type: string
  code: string
  message: string
  objectId?: string
  objectType?: string
  context?: Record<string, any>
}

export interface ValidationResult {
  isValid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

export const useValidationStore = defineStore('validation', () => {
  // 状态
  const availableRuleSets = ref<RuleSet[]>([])
  const selectedRuleSetId = ref<string>('casual_standard_ruleset')
  const isInitialized = ref<boolean>(false)
  const isLoading = ref<boolean>(false)

  // 计算属性
  const selectedRuleSet = computed(() => availableRuleSets.value.find(r => r.id === selectedRuleSetId.value))

  // 初始化规则系统
  const initialize = async (): Promise<void> => {
    if (isInitialized.value) return

    isLoading.value = true
    try {
      const gameDataStore = useGameDataStore()

      // 首先确保 GlobalRuleRegistry 已初始化
      if (!GlobalRuleRegistry.isReady()) {
        await GlobalRuleRegistry.initialize()
      }

      // 获取可用规则集
      const ruleSets = await ClientRuleIntegration.getAvailableRuleSets()

      // 获取规则集的详细信息
      const registry = GlobalRuleRegistry.getRegistry()
      availableRuleSets.value = markRaw(
        ruleSets.map(id => {
          const ruleSet = registry.getRuleSet(id)
          const ruleCount = ruleSet ? ruleSet.getRules().length : 0

          return {
            id,
            name: id === 'competitive_ruleset' ? '竞技规则' : '休闲规则',
            description: id === 'competitive_ruleset' ? '严格的竞技对战规则集' : '休闲模式的规则集合',
            ruleCount,
          }
        }),
      )

      // 确保种族数据提供者已正确初始化
      await ClientRuleIntegration.initializeSpeciesDataProvider(gameDataStore)

      isInitialized.value = true
    } catch (error) {
      console.error('初始化规则系统失败:', error)
      // 提供默认规则集（尝试从注册表获取实际数量）
      try {
        // 尝试初始化 GlobalRuleRegistry
        if (!GlobalRuleRegistry.isReady()) {
          await GlobalRuleRegistry.initialize()
        }

        const registry = GlobalRuleRegistry.getRegistry()
        availableRuleSets.value = markRaw([
          {
            id: 'casual_standard_ruleset',
            name: '休闲规则',
            description: '休闲模式的规则集合',
            ruleCount: registry.getRuleSet('casual_standard_ruleset')?.getRules().length || 0,
          },
          {
            id: 'competitive_ruleset',
            name: '竞技规则',
            description: '严格的竞技对战规则集',
            ruleCount: registry.getRuleSet('competitive_ruleset')?.getRules().length || 0,
          },
        ])
      } catch (registryError) {
        console.warn('无法从注册表获取规则集信息，使用默认值:', registryError)
        // 如果连注册表都无法访问，使用完全默认的值
        availableRuleSets.value = markRaw([
          { id: 'casual_standard_ruleset', name: '休闲规则', description: '休闲模式的规则集合', ruleCount: 0 },
          { id: 'competitive_ruleset', name: '竞技规则', description: '严格的竞技对战规则集', ruleCount: 0 },
        ])
      }
      isInitialized.value = true
    } finally {
      isLoading.value = false
    }
  }

  // 设置选中的规则集
  const setSelectedRuleSet = (ruleSetId: string): void => {
    if (availableRuleSets.value.find(r => r.id === ruleSetId)) {
      selectedRuleSetId.value = ruleSetId
    }
  }

  // 验证队伍
  const validateTeam = async (team: PetSchemaType[], ruleSetId?: string): Promise<ValidationResult> => {
    const targetRuleSetId = ruleSetId || selectedRuleSetId.value

    if (!isInitialized.value) {
      return {
        isValid: false,
        errors: [
          {
            type: 'system_error',
            code: 'NOT_INITIALIZED',
            message: '验证系统未初始化',
          },
        ],
        warnings: [],
      }
    }

    if (!targetRuleSetId) {
      return {
        isValid: false,
        errors: [
          {
            type: 'config_error',
            code: 'NO_RULESET',
            message: '未选择规则集',
          },
        ],
        warnings: [],
      }
    }

    try {
      // 设置规则集并验证队伍
      await ClientRuleIntegration.setTeamBuilderRuleSetIds([targetRuleSetId])
      const validation = await ClientRuleIntegration.validateTeam(team)

      return {
        isValid: validation.isValid,
        errors: validation.errors || [],
        warnings: validation.warnings || [],
      }
    } catch (error) {
      console.error('队伍验证失败:', error)
      return {
        isValid: false,
        errors: [
          {
            type: 'system_error',
            code: 'VALIDATION_ERROR',
            message: '验证过程中发生错误',
          },
        ],
        warnings: [],
      }
    }
  }

  // 检查队伍是否与规则集匹配
  const isTeamCompatibleWithRuleSet = (team: { ruleSetId?: string }, ruleSetId: string): boolean => {
    const teamRuleSetId = team.ruleSetId || 'casual_standard_ruleset'
    return teamRuleSetId === ruleSetId
  }

  // 根据规则集ID获取规则集名称
  const getRuleSetName = (ruleSetId: string): string => {
    const ruleSet = availableRuleSets.value.find(r => r.id === ruleSetId)
    return ruleSet?.name || ruleSetId
  }

  // 获取规则集描述
  const getRuleSetDescription = (ruleSetId: string): string => {
    const ruleSet = availableRuleSets.value.find(r => r.id === ruleSetId)
    return ruleSet?.description || ''
  }

  // 获取规则集中的所有规则详细信息
  const getRuleSetRules = (ruleSetId: string): RuleInfo[] => {
    if (!isInitialized.value) {
      return []
    }

    try {
      const registry = GlobalRuleRegistry.getRegistry()
      const ruleSet = registry.getRuleSet(ruleSetId)

      if (!ruleSet) {
        return []
      }

      return ruleSet.getRules().map(rule => ({
        id: rule.id,
        name: rule.name,
        description: rule.description || '',
        enabled: rule.enabled,
        priority: rule.priority,
        tags: rule.tags || [],
        impact: generateRuleImpactDescription(rule),
      }))
    } catch (error) {
      console.error('获取规则集规则失败:', error)
      return []
    }
  }

  // 生成规则影响描述
  const generateRuleImpactDescription = (rule: any): string => {
    // 根据规则ID和类型生成具体的影响描述
    switch (rule.id) {
      case 'standard_team_size_rule':
        return '限制队伍大小为1-6只精灵'
      case 'competitive_team_size_rule':
        return '要求队伍必须有6只精灵'
      case 'standard_level_limit_rule':
        return '限制精灵等级不超过100级'
      case 'competitive_level_limit_rule':
        return '限制精灵等级为50级'
      case 'standard_ev_limit_rule':
        return '限制每只精灵学习力总和不超过510，单项不超过252'
      case 'competitive_pet_species_unique_rule':
        return '禁止队伍中出现相同种族的精灵'
      case 'standard_competitive_timer_rule':
        return '每回合限时60秒，总时间限制10分钟'
      case 'casual_timer_rule':
        return '每回合限时90秒，总时间限制15分钟'
      case 'standard_skill_availability_rule':
        return '验证精灵技能的合法性和可学习性'
      case 'competitive_skill_availability_rule':
        return '严格验证精灵技能，禁止使用某些技能'
      case 'standard_gender_restriction_rule':
        return '根据精灵种族限制性别选择'
      case 'competitive_full_team_rule':
        return '要求必须选择完整的6只精灵参战，并且允许选择初始出战精灵'
      default:
        return rule.description || '该规则会影响队伍构建或战斗行为'
    }
  }

  // 验证单个精灵
  const validatePet = async (
    pet: PetSchemaType,
    team: PetSchemaType[],
    ruleSetId?: string,
  ): Promise<ValidationResult> => {
    const targetRuleSetId = ruleSetId || selectedRuleSetId.value

    if (!isInitialized.value) {
      return {
        isValid: false,
        errors: [
          {
            type: 'system_error',
            code: 'NOT_INITIALIZED',
            message: '验证系统未初始化',
          },
        ],
        warnings: [],
      }
    }

    if (!targetRuleSetId) {
      return {
        isValid: false,
        errors: [
          {
            type: 'config_error',
            code: 'NO_RULESET',
            message: '未选择规则集',
          },
        ],
        warnings: [],
      }
    }

    try {
      // 设置规则集并验证精灵
      await ClientRuleIntegration.setTeamBuilderRuleSetIds([targetRuleSetId])
      const validation = await ClientRuleIntegration.validatePet(pet, team)

      return {
        isValid: validation.isValid,
        errors: validation.errors || [],
        warnings: validation.warnings || [],
      }
    } catch (error) {
      console.error('精灵验证失败:', error)
      return {
        isValid: false,
        errors: [
          {
            type: 'system_error',
            code: 'VALIDATION_ERROR',
            message: '验证过程中发生错误',
          },
        ],
        warnings: [],
      }
    }
  }

  // 获取允许的性别列表
  const getAllowedGendersForSpecies = async (speciesId: string): Promise<string[]> => {
    if (!isInitialized.value) {
      return ['Male', 'Female', 'NoGender']
    }

    try {
      const allowedGenders = await ClientRuleIntegration.getAllowedGendersForSpecies(speciesId)
      return allowedGenders
    } catch (error) {
      console.warn('获取性别限制失败:', error)
      return ['Male', 'Female', 'NoGender']
    }
  }

  // 检查是否可以添加更多精灵
  const canAddMorePets = async (team: PetSchemaType[]): Promise<boolean> => {
    if (!isInitialized.value) {
      return team.length < 6 // 默认限制
    }

    try {
      const canAdd = await ClientRuleIntegration.canAddMorePets(team)
      return canAdd
    } catch (error) {
      console.warn('检查队伍大小限制失败:', error)
      return team.length < 6 // 默认限制
    }
  }

  // 获取规则限制信息
  const getRuleLimitations = async () => {
    if (!isInitialized.value) {
      return { teamSize: { max: 6, min: 1 } }
    }

    try {
      const limitations = await ClientRuleIntegration.getRuleLimitations()
      return limitations
    } catch (error) {
      console.warn('获取规则限制失败:', error)
      return { teamSize: { max: 6, min: 1 } }
    }
  }

  // 自动修复队伍
  const autoFixTeam = async (team: PetSchemaType[]): Promise<any> => {
    if (!isInitialized.value) {
      throw new Error('验证系统未初始化')
    }

    try {
      const result = await ClientRuleIntegration.autoFixTeam(team)
      return result
    } catch (error) {
      console.error('自动修复失败:', error)
      throw error
    }
  }

  // 获取种族的额外可学习技能
  const getSpeciesExtraLearnableSkills = async (speciesId: string): Promise<any[]> => {
    if (!isInitialized.value) {
      return []
    }

    try {
      const extraSkills = await ClientRuleIntegration.getSpeciesExtraLearnableSkills(speciesId)
      return extraSkills
    } catch (error) {
      console.warn('获取额外技能失败:', error)
      return []
    }
  }

  return {
    // 状态
    availableRuleSets,
    selectedRuleSetId,
    isInitialized,
    isLoading,

    // 计算属性
    selectedRuleSet,

    // 方法
    initialize,
    setSelectedRuleSet,
    validateTeam,
    validatePet,
    isTeamCompatibleWithRuleSet,
    getRuleSetName,
    getRuleSetDescription,
    getRuleSetRules,
    getAllowedGendersForSpecies,
    canAddMorePets,
    getRuleLimitations,
    autoFixTeam,
    getSpeciesExtraLearnableSkills,
  }
})
