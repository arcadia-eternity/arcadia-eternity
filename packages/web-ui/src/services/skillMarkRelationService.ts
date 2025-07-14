import type { SkillSchemaType, MarkSchemaType, Effect } from '@arcadia-eternity/schema'
import type { OperatorDSL } from '@arcadia-eternity/schema'

export interface SkillMarkRelation {
  markId: string
  relationType: 'adds' | 'removes' | 'modifies' | 'consumes' | 'tags'
  confidence: number // 0-1, 关联度
  source: 'effect' | 'tags' | 'manual'
  effectId?: string
  description?: string
}

export interface SkillMarkAnalysis {
  skillId: string
  relatedMarks: SkillMarkRelation[]
  totalRelations: number
}

export class SkillMarkRelationService {
  private skillsData: Record<string, SkillSchemaType> = {}
  private marksData: Record<string, MarkSchemaType> = {}
  private effectsData: Record<string, Effect> = {}

  // 缓存分析结果
  private analysisCache = new Map<string, SkillMarkAnalysis>()

  constructor(
    skillsData: Record<string, SkillSchemaType>,
    marksData: Record<string, MarkSchemaType>,
    effectsData: Record<string, Effect>,
  ) {
    this.skillsData = skillsData
    this.marksData = marksData
    this.effectsData = effectsData
  }

  /**
   * 分析技能与印记的关联关系
   */
  analyzeSkillMarkRelations(skillId: string): SkillMarkAnalysis {
    // 检查缓存
    if (this.analysisCache.has(skillId)) {
      return this.analysisCache.get(skillId)!
    }

    const skill = this.skillsData[skillId]
    if (!skill) {
      return { skillId, relatedMarks: [], totalRelations: 0 }
    }

    const relations: SkillMarkRelation[] = []

    // 1. 基于effects分析
    if (skill.effect && skill.effect.length > 0) {
      for (const effectId of skill.effect) {
        const effect = this.effectsData[effectId]
        if (effect) {
          const effectRelations = this.analyzeEffectForMarks(effectId, effect)
          relations.push(...effectRelations)
        }
      }
    }

    // 2. 基于tags分析
    if (skill.tags && skill.tags.length > 0) {
      const tagRelations = this.analyzeTagsForMarks(skill.tags)
      relations.push(...tagRelations)
    }

    // 去重和排序
    const uniqueRelations = this.deduplicateRelations(relations)
    uniqueRelations.sort((a, b) => b.confidence - a.confidence)

    const analysis: SkillMarkAnalysis = {
      skillId,
      relatedMarks: uniqueRelations,
      totalRelations: uniqueRelations.length,
    }

    // 缓存结果
    this.analysisCache.set(skillId, analysis)
    return analysis
  }

  /**
   * 分析单个effect中的印记操作
   */
  private analyzeEffectForMarks(effectId: string, effect: Effect): SkillMarkRelation[] {
    const relations: SkillMarkRelation[] = []

    if (!effect.apply) return relations

    // 处理单个或多个apply操作
    const applies = Array.isArray(effect.apply) ? effect.apply : [effect.apply]

    for (const apply of applies) {
      const markRelations = this.extractMarkFromOperator(apply, effectId)
      relations.push(...markRelations)
    }

    return relations
  }

  /**
   * 从操作符中提取印记信息
   */
  private extractMarkFromOperator(operator: OperatorDSL, effectId: string): SkillMarkRelation[] {
    const relations: SkillMarkRelation[] = []

    switch (operator.type) {
      case 'addMark':
        if (operator.mark && typeof operator.mark === 'object' && 'value' in operator.mark) {
          const markId = operator.mark.value as string
          if (this.marksData[markId]) {
            relations.push({
              markId,
              relationType: 'adds',
              confidence: 0.9,
              source: 'effect',
              effectId,
              description: `通过效果 ${effectId} 添加印记`,
            })
          }
        }
        break

      case 'consumeStacks':
        // 这种情况通常是消耗当前印记的层数，需要从context推断
        relations.push({
          markId: 'unknown', // 需要运行时确定
          relationType: 'consumes',
          confidence: 0.7,
          source: 'effect',
          effectId,
          description: `通过效果 ${effectId} 消耗印记层数`,
        })
        break

      case 'destroyMark':
        // 销毁印记操作
        relations.push({
          markId: 'unknown', // 需要运行时确定
          relationType: 'removes',
          confidence: 0.8,
          source: 'effect',
          effectId,
          description: `通过效果 ${effectId} 移除印记`,
        })
        break

      case 'conditional':
        // 递归处理条件操作
        if ('then' in operator && operator.then) {
          const thenApplies = Array.isArray(operator.then) ? operator.then : [operator.then]
          for (const thenApply of thenApplies) {
            relations.push(...this.extractMarkFromOperator(thenApply, effectId))
          }
        }
        if ('else' in operator && operator.else) {
          const elseApplies = Array.isArray(operator.else) ? operator.else : [operator.else]
          for (const elseApply of elseApplies) {
            relations.push(...this.extractMarkFromOperator(elseApply, effectId))
          }
        }
        break
    }

    return relations
  }

  /**
   * 基于标签分析印记关联
   */
  private analyzeTagsForMarks(skillTags: string[]): SkillMarkRelation[] {
    const relations: SkillMarkRelation[] = []

    for (const [markId, mark] of Object.entries(this.marksData)) {
      if (!mark.tags) continue

      // 计算标签重叠度
      const commonTags = skillTags.filter(tag => mark.tags!.includes(tag))
      if (commonTags.length > 0) {
        const confidence = Math.min(0.6, commonTags.length * 0.2) // 基于标签的关联度较低
        relations.push({
          markId,
          relationType: 'tags',
          confidence,
          source: 'tags',
          description: `共享标签: ${commonTags.join(', ')}`,
        })
      }
    }

    return relations
  }

  /**
   * 去重关联关系
   */
  private deduplicateRelations(relations: SkillMarkRelation[]): SkillMarkRelation[] {
    const seen = new Map<string, SkillMarkRelation>()

    for (const relation of relations) {
      const key = `${relation.markId}-${relation.relationType}`
      const existing = seen.get(key)

      if (!existing || relation.confidence > existing.confidence) {
        seen.set(key, relation)
      }
    }

    return Array.from(seen.values())
  }

  /**
   * 获取印记的相关技能
   */
  analyzeMarkSkillRelations(markId: string): string[] {
    const relatedSkills: string[] = []

    for (const skillId of Object.keys(this.skillsData)) {
      const analysis = this.analyzeSkillMarkRelations(skillId)
      if (analysis.relatedMarks.some(r => r.markId === markId)) {
        relatedSkills.push(skillId)
      }
    }

    return relatedSkills
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.analysisCache.clear()
  }

  /**
   * 更新数据并清除缓存
   */
  updateData(
    skillsData: Record<string, SkillSchemaType>,
    marksData: Record<string, MarkSchemaType>,
    effectsData: Record<string, Effect>,
  ): void {
    this.skillsData = skillsData
    this.marksData = marksData
    this.effectsData = effectsData
    this.clearCache()
  }
}
