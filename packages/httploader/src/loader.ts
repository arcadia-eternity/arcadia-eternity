import axios from 'axios'
import YAML from 'yaml'
import { DataRepository } from '@arcadia-eternity/data-repository'
import { extractMetadata } from '@arcadia-eternity/schema'
import type { Effect, MarkSchemaType } from '@arcadia-eternity/schema'
import { MarkParser, EffectParser, SkillParser, SpeciesParser } from '@arcadia-eternity/parser'

type FileCategory =
  | 'effect'
  | 'effect_ability'
  | 'effect_emblem'
  | 'effect_mark'
  | 'effect_skill'
  | 'effect_global'
  | 'skill'
  | 'species'
  | 'mark'
  | 'mark_ability'
  | 'mark_emblem'
  | 'mark_global'

const dataRepo = DataRepository.getInstance()

export class HttpLoader {
  private baseUrl: string

  constructor(config: { baseUrl: string }) {
    this.baseUrl = config.baseUrl
  }

  // 新增游戏数据加载入口
  async loadGameData(
    options: {
      validateCrossReferences?: boolean
      continueOnError?: boolean
    } = {},
  ) {
    try {
      const { validateCrossReferences = true, continueOnError = false } = options

      // 按依赖顺序加载数据
      const loadOrder: FileCategory[] = ['effect', 'mark', 'skill', 'species']
      const errors: string[] = []

      console.log(`📋 数据加载顺序: ${loadOrder.join(' → ')}`)

      for (const category of loadOrder) {
        console.log(`⏳ 开始加载 ${category} 数据...`)

        try {
          await this.load(category)
          console.log(`✅ 完成加载 ${category} 数据`)
        } catch (error) {
          const errorMessage = `加载 ${category} 数据失败: ${error instanceof Error ? error.message : error}`
          errors.push(errorMessage)
          console.error(`❌ ${errorMessage}`)

          if (!continueOnError) {
            throw error
          }
        }
      }

      // 验证交叉引用
      if (validateCrossReferences) {
        console.log('🔍 执行交叉引用验证...')
        const validationResult = this.validateCrossReferences()

        if (!validationResult.isValid) {
          console.error('❌ 发现交叉引用错误:')
          validationResult.errors.forEach(error => {
            console.error(`  - ${error.message}`)
            errors.push(error.message)
          })

          if (!continueOnError) {
            throw new Error(`发现 ${validationResult.errors.length} 个交叉引用错误`)
          }
        }

        if (validationResult.warnings.length > 0) {
          console.warn('⚠️ 发现警告:')
          validationResult.warnings.forEach(warning => {
            console.warn(`  - ${warning.message}`)
          })
        }
      }

      // 输出加载统计
      const dataRepo = DataRepository.getInstance()
      console.log('📊 数据加载统计:')
      console.log(`  - 效果: ${dataRepo.effects.size} 个`)
      console.log(`  - 标记: ${dataRepo.marks.size} 个`)
      console.log(`  - 技能: ${dataRepo.skills.size} 个`)
      console.log(`  - 物种: ${dataRepo.species.size} 个`)

      if (errors.length > 0) {
        console.warn(`⚠️ 加载过程中发现 ${errors.length} 个问题`)
      }

      console.log('🎉 所有数据加载完成')
    } catch (error) {
      console.error('🔥 数据初始化失败:', error instanceof Error ? error.message : error)
      throw error
    }
  }

  async load<T>(category: FileCategory | 'mark' | 'effect'): Promise<T[]> {
    // 处理需要合并加载的类型
    if (category === 'mark') {
      const [baseMarks, abilityMarks, emblemMarks, globalMarks] = await Promise.all([
        this.loadSingle<MarkSchemaType>('mark'),
        this.loadSingle<MarkSchemaType>('mark_ability'),
        this.loadSingle<MarkSchemaType>('mark_emblem'),
        this.loadSingle<MarkSchemaType>('mark_global'),
      ])
      const allMarks = [...baseMarks, ...abilityMarks, ...emblemMarks, ...globalMarks]
      this.checkDuplicateIds(allMarks, 'Mark')
      return allMarks as T[]
    }

    if (category === 'effect') {
      const [abilityEffects, emblemEffects, markEffects, skillEffects] = await Promise.all([
        this.loadSingle<Effect>('effect_ability'),
        this.loadSingle<Effect>('effect_emblem'),
        this.loadSingle<Effect>('effect_mark'),
        this.loadSingle<Effect>('effect_skill'),
        this.loadSingle<Effect>('effect_global'),
      ])
      const allEffects = [...abilityEffects, ...emblemEffects, ...markEffects, ...skillEffects]
      this.checkDuplicateIds(allEffects, 'Effect')
      return allEffects as T[]
    }

    // 处理单个类型加载
    return this.loadSingle<T>(category)
  }

  private async loadSingle<T>(category: FileCategory): Promise<T[]> {
    try {
      const requestUrl = `${this.baseUrl}/${category}.json`
      const apiResponse = await axios.get(requestUrl)
      const parsedData = apiResponse.data
      // const fileMetadata = extractMetadata(yamlContent)

      // if (fileMetadata.metaType !== category) {
      //   throw new Error(`元数据类型不匹配: 请求类型 ${category}, 元数据类型 ${fileMetadata.metaType}`)
      // }

      // const parsedData = YAML.parse(yamlContent, { merge: true })
      this.registerData(category, parsedData)

      console.log(`✅ 成功加载 ${category} (${parsedData.length} 条记录)`)
      return parsedData
    } catch (error) {
      console.error(`💥 加载失败 ${category}:`, error instanceof Error ? error.message : error)
      throw error
    }
  }

  private registerData(category: FileCategory, data: any[]) {
    switch (category) {
      case 'mark':
      case 'mark_ability':
      case 'mark_emblem':
      case 'mark_global':
        data.forEach(item => {
          const mark = MarkParser.parse(item)
          dataRepo.registerMark(mark.id, mark)
        })
        break
      case 'effect':
      case 'effect_ability':
      case 'effect_emblem':
      case 'effect_mark':
      case 'effect_skill':
      case 'effect_global':
        data.forEach(item => {
          const effect = EffectParser.parse(item)
          dataRepo.registerEffect(effect.id, effect)
        })
        break
      case 'skill':
        data.forEach(item => {
          const skill = SkillParser.parse(item)
          dataRepo.registerSkill(skill.id, skill)
        })
        break
      case 'species':
        data.forEach(item => {
          const species = SpeciesParser.parse(item)
          dataRepo.registerSpecies(species.id, species)
        })
        break
    }
  }

  // 验证交叉引用
  private validateCrossReferences() {
    const errors: Array<{
      type: string
      category: string
      itemId: string
      referencedId: string
      referencedType: string
      message: string
    }> = []
    const warnings: Array<{ type: string; category: string; itemId: string; message: string }> = []

    // 验证技能引用的效果
    for (const skill of dataRepo.skills.values()) {
      if (skill.effects && skill.effects.length > 0) {
        for (const effect of skill.effects) {
          if (!dataRepo.effects.has(effect.id)) {
            errors.push({
              type: 'missing_reference',
              category: 'skill',
              itemId: skill.id,
              referencedId: effect.id,
              referencedType: 'effect',
              message: `技能 ${skill.id} 引用了不存在的效果 ${effect.id}`,
            })
          }
        }
      }
    }

    // 验证标记引用的效果
    for (const mark of dataRepo.marks.values()) {
      if (mark.effects && mark.effects.length > 0) {
        for (const effect of mark.effects) {
          if (!dataRepo.effects.has(effect.id)) {
            errors.push({
              type: 'missing_reference',
              category: 'mark',
              itemId: mark.id,
              referencedId: effect.id,
              referencedType: 'effect',
              message: `标记 ${mark.id} 引用了不存在的效果 ${effect.id}`,
            })
          }
        }
      }
    }

    // 验证物种引用的标记
    for (const species of dataRepo.species.values()) {
      // 验证能力标记
      if (species.ability) {
        for (const abilityMark of species.ability) {
          if (!dataRepo.marks.has(abilityMark.id)) {
            errors.push({
              type: 'missing_reference',
              category: 'species',
              itemId: species.id,
              referencedId: abilityMark.id,
              referencedType: 'mark',
              message: `物种 ${species.id} 引用了不存在的能力标记 ${abilityMark.id}`,
            })
          }
        }
      }

      // 验证徽章标记
      if (species.emblem) {
        for (const emblemMark of species.emblem) {
          if (!dataRepo.marks.has(emblemMark.id)) {
            errors.push({
              type: 'missing_reference',
              category: 'species',
              itemId: species.id,
              referencedId: emblemMark.id,
              referencedType: 'mark',
              message: `物种 ${species.id} 引用了不存在的徽章标记 ${emblemMark.id}`,
            })
          }
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    }
  }

  private checkDuplicateIds(items: Array<{ id: string }>, type: string) {
    const ids = new Set<string>()
    items.forEach(item => {
      if (ids.has(item.id)) {
        throw new Error(`${type} ID冲突: ${item.id}`)
      }
      ids.add(item.id)
    })
  }
}
