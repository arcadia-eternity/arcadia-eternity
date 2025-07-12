import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { PetSchemaType } from '@arcadia-eternity/schema'

export interface RuleSet {
  id: string
  name: string
  description: string
  enabled: boolean
  ruleCount: number
  rules: {
    teamSize: { min: number; max: number }
    levelLimit: { min: number; max: number }
    evLimit: { total: number; individual: number }
    timerEnabled: boolean
  }
}

export const useRuleSetStore = defineStore('ruleSet', () => {
  // 状态
  const ruleSets = ref<RuleSet[]>([
    {
      id: 'casual_standard_ruleset',
      name: '休闲规则',
      description: '休闲模式的规则集合，适合日常对战',
      enabled: true,
      ruleCount: 4,
      rules: {
        teamSize: { min: 1, max: 6 },
        levelLimit: { min: 1, max: 100 },
        evLimit: { total: 510, individual: 252 },
        timerEnabled: false
      }
    },
    {
      id: 'competitive_ruleset',
      name: '竞技规则',
      description: '严格的竞技对战规则集，确保公平竞争环境',
      enabled: true,
      ruleCount: 4,
      rules: {
        teamSize: { min: 6, max: 6 },
        levelLimit: { min: 100, max: 100 },
        evLimit: { total: 510, individual: 252 },
        timerEnabled: true
      }
    }
  ])

  const selectedRuleSetId = ref<string>('casual_standard_ruleset')

  // 计算属性
  const availableRuleSets = computed(() => 
    ruleSets.value.filter(ruleSet => ruleSet.enabled)
  )

  const selectedRuleSet = computed(() => 
    ruleSets.value.find(ruleSet => ruleSet.id === selectedRuleSetId.value)
  )

  // 验证函数
  const validateTeam = (team: PetSchemaType[], ruleSetId?: string): { isValid: boolean; errors: string[] } => {
    const ruleSet = ruleSetId 
      ? ruleSets.value.find(r => r.id === ruleSetId)
      : selectedRuleSet.value

    if (!ruleSet) {
      return { isValid: false, errors: ['规则集不存在'] }
    }

    const errors: string[] = []

    // 验证队伍大小
    if (team.length < ruleSet.rules.teamSize.min) {
      errors.push(`队伍至少需要${ruleSet.rules.teamSize.min}只精灵`)
    }
    if (team.length > ruleSet.rules.teamSize.max) {
      errors.push(`队伍最多只能有${ruleSet.rules.teamSize.max}只精灵`)
    }

    // 验证等级
    for (const pet of team) {
      if (pet.level < ruleSet.rules.levelLimit.min) {
        errors.push(`${pet.name}等级过低，最低要求${ruleSet.rules.levelLimit.min}级`)
      }
      if (pet.level > ruleSet.rules.levelLimit.max) {
        errors.push(`${pet.name}等级过高，最高限制${ruleSet.rules.levelLimit.max}级`)
      }

      // 验证学习力
      const totalEVs = Object.values(pet.evs).reduce((sum, ev) => sum + ev, 0)
      if (totalEVs > ruleSet.rules.evLimit.total) {
        errors.push(`${pet.name}学习力总和超限，最大${ruleSet.rules.evLimit.total}`)
      }

      for (const [stat, ev] of Object.entries(pet.evs)) {
        if (ev > ruleSet.rules.evLimit.individual) {
          errors.push(`${pet.name}的${stat}学习力超限，最大${ruleSet.rules.evLimit.individual}`)
        }
      }
    }

    return { isValid: errors.length === 0, errors }
  }

  // 动作
  const setSelectedRuleSet = (ruleSetId: string) => {
    if (ruleSets.value.find(r => r.id === ruleSetId)) {
      selectedRuleSetId.value = ruleSetId
    }
  }

  const addRuleSet = (ruleSet: RuleSet) => {
    if (!ruleSets.value.find(r => r.id === ruleSet.id)) {
      ruleSets.value.push(ruleSet)
    }
  }

  const updateRuleSet = (ruleSetId: string, updates: Partial<RuleSet>) => {
    const index = ruleSets.value.findIndex(r => r.id === ruleSetId)
    if (index !== -1) {
      ruleSets.value[index] = { ...ruleSets.value[index], ...updates }
    }
  }

  return {
    // 状态
    ruleSets,
    selectedRuleSetId,
    
    // 计算属性
    availableRuleSets,
    selectedRuleSet,
    
    // 方法
    validateTeam,
    setSelectedRuleSet,
    addRuleSet,
    updateRuleSet
  }
})
