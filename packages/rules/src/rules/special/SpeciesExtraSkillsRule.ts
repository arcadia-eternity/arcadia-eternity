import type { LearnableSkill } from '@arcadia-eternity/schema'
import type { RuleContext } from '../../interfaces/Rule'
import { RulePriority } from '../../interfaces/Rule'
import { AbstractRule } from '../../core/AbstractRule'

/**
 * 种族额外技能规则
 * 为特定种族添加额外的可学习技能选项（仅在队伍构建验证过程中生效）
 */
export class SpeciesExtraSkillsRule extends AbstractRule {
  private speciesSkillMap: Map<string, LearnableSkill[]> = new Map()

  constructor(
    id: string = 'species_extra_skills_rule',
    name: string = '种族额外技能规则',
    options: {
      description?: string
      priority?: number
      version?: string
      author?: string
      tags?: string[]
      enabled?: boolean
    } = {},
  ) {
    super(id, name, {
      description: options.description || '为特定种族添加额外的可学习技能选项',
      priority: options.priority ?? RulePriority.NORMAL,
      version: options.version ?? '1.0.0',
      author: options.author,
      tags: options.tags ?? ['species', 'skills', 'extra'],
      enabled: options.enabled ?? true,
    })
  }

  /**
   * 为指定种族添加额外技能
   * @param speciesId 种族ID
   * @param skills 额外技能列表
   */
  addSpeciesSkills(speciesId: string, skills: LearnableSkill[]): void {
    const existingSkills = this.speciesSkillMap.get(speciesId) || []
    this.speciesSkillMap.set(speciesId, [...existingSkills, ...skills])
  }

  /**
   * 为指定种族设置额外技能（覆盖现有的）
   * @param speciesId 种族ID
   * @param skills 额外技能列表
   */
  setSpeciesSkills(speciesId: string, skills: LearnableSkill[]): void {
    this.speciesSkillMap.set(speciesId, [...skills])
  }

  /**
   * 移除指定种族的额外技能
   * @param speciesId 种族ID
   * @param skillIds 要移除的技能ID列表，如果不提供则移除所有
   */
  removeSpeciesSkills(speciesId: string, skillIds?: string[]): void {
    if (!skillIds) {
      this.speciesSkillMap.delete(speciesId)
      return
    }

    const existingSkills = this.speciesSkillMap.get(speciesId) || []
    const filteredSkills = existingSkills.filter(skill => !skillIds.includes(skill.skill_id))

    if (filteredSkills.length === 0) {
      this.speciesSkillMap.delete(speciesId)
    } else {
      this.speciesSkillMap.set(speciesId, filteredSkills)
    }
  }

  /**
   * 清空所有种族的额外技能
   */
  clearAllSpeciesSkills(): void {
    this.speciesSkillMap.clear()
  }

  /**
   * 获取指定种族的额外技能
   * @param speciesId 种族ID
   * @returns 额外技能列表
   */
  getSpeciesSkills(speciesId: string): LearnableSkill[] {
    return [...(this.speciesSkillMap.get(speciesId) || [])]
  }

  /**
   * 获取所有配置的种族ID列表
   * @returns 种族ID列表
   */
  getConfiguredSpeciesIds(): string[] {
    return Array.from(this.speciesSkillMap.keys())
  }

  /**
   * 检查指定种族是否有额外技能配置
   * @param speciesId 种族ID
   * @returns 是否有额外技能
   */
  hasSpeciesSkills(speciesId: string): boolean {
    return this.speciesSkillMap.has(speciesId) && this.speciesSkillMap.get(speciesId)!.length > 0
  }

  /**
   * 实现Rule接口的getSpeciesExtraLearnableSkills方法
   * @param speciesId 种族ID
   * @param context 规则上下文
   * @returns 额外可学习技能列表
   */
  getSpeciesExtraLearnableSkills(speciesId: string, context?: RuleContext): LearnableSkill[] {
    return this.getSpeciesSkills(speciesId)
  }

  /**
   * 批量配置种族额外技能
   * @param config 配置对象，键为种族ID，值为技能列表
   */
  batchConfigureSpeciesSkills(config: Record<string, LearnableSkill[]>): void {
    for (const [speciesId, skills] of Object.entries(config)) {
      this.setSpeciesSkills(speciesId, skills)
    }
  }

  /**
   * 获取规则的配置摘要
   * @returns 配置摘要
   */
  getConfigSummary(): {
    totalSpecies: number
    totalExtraSkills: number
    speciesConfig: Array<{
      speciesId: string
      skillCount: number
      skills: LearnableSkill[]
    }>
  } {
    const speciesConfig = Array.from(this.speciesSkillMap.entries()).map(([speciesId, skills]) => ({
      speciesId,
      skillCount: skills.length,
      skills: [...skills],
    }))

    return {
      totalSpecies: this.speciesSkillMap.size,
      totalExtraSkills: speciesConfig.reduce((sum, config) => sum + config.skillCount, 0),
      speciesConfig,
    }
  }
}
