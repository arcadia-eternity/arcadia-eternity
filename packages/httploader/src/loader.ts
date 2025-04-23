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
  async loadGameData() {
    try {
      // 按依赖顺序加载数据
      const loadOrder: FileCategory[] = ['effect', 'mark', 'skill', 'species']

      for (const category of loadOrder) {
        console.log(`⏳ 开始加载 ${category} 数据...`)
        await this.load(category)
        console.log(`✅ 完成加载 ${category} 数据`)
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
