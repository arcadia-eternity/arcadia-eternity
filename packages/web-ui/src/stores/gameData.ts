// src/stores/gameData.ts
import { defineStore } from 'pinia'
import { GameDataLoader } from '@/utils/gameLoader'
import type { SpeciesSchemaType, SkillSchemaType, MarkSchemaType, Effect } from '@arcadia-eternity/schema'

interface GameDataState {
  species: {
    byId: Record<string, SpeciesSchemaType>
    allIds: string[] // 维护有序ID列表
  }
  skills: {
    byId: Record<string, SkillSchemaType>
    allIds: string[]
  }
  marks: {
    byId: Record<string, MarkSchemaType>
    allIds: string[]
  }
  effects: {
    byId: Record<string, Effect>
    allIds: string[]
  }
  loaded: boolean
  gameDataLoaded: boolean
  error: string | null
}

export const useGameDataStore = defineStore('gameData', {
  state: (): GameDataState => ({
    loaded: false,
    error: null,
    species: {
      byId: {},
      allIds: [],
    },
    skills: {
      byId: {},
      allIds: [],
    },
    marks: {
      byId: {},
      allIds: [],
    },
    effects: {
      byId: {},
      allIds: [],
    },
    gameDataLoaded: false,
  }),

  getters: {
    speciesList: state => state.species.allIds.map(id => state.species.byId[id]),
    skillList: state => state.skills.allIds.map(id => state.skills.byId[id]),
    marksList: state => state.marks.allIds.map(id => state.marks.byId[id]),
    effectsList: state => state.effects.allIds.map(id => state.effects.byId[id]),
    getSpecies: state => (id: string) => state.species.byId[id],
    getSkill: state => (id: string) => state.skills.byId[id],
    getMark: state => (id: string) => state.marks.byId[id],
    getEffect: state => (id: string) => state.effects.byId[id],
  },

  actions: {
    async initialize() {
      if (this.loaded) return
      const loader = new GameDataLoader({
        devBasePath: '/data',
        prodBaseUrl: import.meta.env.VITE_API_BASE || '/data',
      })

      try {
        // 并行加载所有数据
        const [rawSpecies, rawSkills, rawMarks, rawEffects] = await Promise.all([
          this.loadSpecies(loader),
          this.loadSkills(loader),
          this.loadMarks(loader),
          this.loadEffects(loader),
        ])

        // 标准化数据结构
        this.species = this.normalizeData(rawSpecies)
        this.skills = this.normalizeData(rawSkills)
        this.marks = this.normalizeData(rawMarks)
        this.effects = this.normalizeData(rawEffects)

        // 验证数据完整性
        this.validateDataIntegrity()

        console.log('🎮 Game data store installed')

        this.loaded = true
      } catch (error) {
        this.error = error instanceof Error ? error.message : '未知错误'
        console.error('❌ Game data initialization failed:', error)
        throw error
      }
    },

    normalizeRecordData<T>(item: Record<string, T>) {
      return {
        byId: item,
        allIds: Object.keys(item),
      }
    },

    // 新增数据结构标准化方法
    normalizeData<T extends { id: string }>(
      items: T[],
    ): {
      byId: Record<string, T>
      allIds: string[]
    } {
      return {
        byId: items.reduce(
          (acc, item) => {
            if (acc[item.id]) {
              console.warn(`发现重复ID: ${item.id}`)
            }
            acc[item.id] = item
            return acc
          },
          {} as Record<string, T>,
        ),
        allIds: items.map(item => item.id),
      }
    },

    // 增强的数据完整性检查
    validateDataIntegrity() {
      const errors: string[] = []

      // 基本数据完整性检查
      const validate = (data: { allIds: string[]; byId: Record<string, unknown> }, type: string) => {
        data.allIds.forEach(id => {
          if (!data.byId[id]) {
            errors.push(`${type}数据不完整，缺失ID: ${id}`)
          }
        })
      }

      validate(this.species, '物种')
      validate(this.skills, '技能')
      validate(this.marks, '标记')
      validate(this.effects, '效果')

      // 交叉引用验证
      this.validateCrossReferences(errors)

      if (errors.length > 0) {
        console.error('❌ 数据验证失败:')
        errors.forEach(error => console.error(`  - ${error}`))
        throw new Error(`发现 ${errors.length} 个数据问题`)
      }
    },

    // 交叉引用验证
    validateCrossReferences(errors: string[]) {
      // 验证技能引用的效果
      this.skills.allIds.forEach(skillId => {
        const skill = this.skills.byId[skillId]
        if (skill?.effect && Array.isArray(skill.effect)) {
          skill.effect.forEach((effectId: string) => {
            if (!this.effects.byId[effectId]) {
              errors.push(`技能 ${skillId} 引用了不存在的效果 ${effectId}`)
            }
          })
        }
      })

      // 验证标记引用的效果
      this.marks.allIds.forEach(markId => {
        const mark = this.marks.byId[markId]
        if (mark?.effect && Array.isArray(mark.effect)) {
          mark.effect.forEach((effectId: string) => {
            if (!this.effects.byId[effectId]) {
              errors.push(`标记 ${markId} 引用了不存在的效果 ${effectId}`)
            }
          })
        }
      })

      // 验证物种引用的技能和标记
      this.species.allIds.forEach(speciesId => {
        const species = this.species.byId[speciesId]

        // 验证可学习技能
        if (species?.learnable_skills && Array.isArray(species.learnable_skills)) {
          species.learnable_skills.forEach((learnableSkill: { skill_id: string }) => {
            if (!this.skills.byId[learnableSkill.skill_id]) {
              errors.push(`物种 ${speciesId} 引用了不存在的技能 ${learnableSkill.skill_id}`)
            }
          })
        }

        // 验证能力标记
        if (species?.ability && Array.isArray(species.ability)) {
          species.ability.forEach((abilityId: string) => {
            if (!this.marks.byId[abilityId]) {
              errors.push(`物种 ${speciesId} 引用了不存在的能力标记 ${abilityId}`)
            }
          })
        }

        // 验证徽章标记
        if (species?.emblem && Array.isArray(species.emblem)) {
          species.emblem.forEach((emblemId: string) => {
            if (!this.marks.byId[emblemId]) {
              errors.push(`物种 ${speciesId} 引用了不存在的徽章标记 ${emblemId}`)
            }
          })
        }
      })
    },

    // 修改后的加载方法（保持返回原始数组）
    async loadSpecies(loader: GameDataLoader): Promise<SpeciesSchemaType[]> {
      const data = await loader.load<SpeciesSchemaType[]>('species')
      return data
    },

    async loadSkills(loader: GameDataLoader): Promise<SkillSchemaType[]> {
      const data = await loader.load<SkillSchemaType[]>('skill')
      return data
    },

    async loadMarks(loader: GameDataLoader): Promise<MarkSchemaType[]> {
      const [data, data1, data2, data3] = await Promise.all([
        loader.load<MarkSchemaType[]>('mark'),
        loader.load<MarkSchemaType[]>('mark_ability'),
        loader.load<MarkSchemaType[]>('mark_emblem'),
        loader.load<MarkSchemaType[]>('mark_global'),
      ])

      // 合并前检查ID冲突
      const allMarks = [...data, ...data1, ...data2, ...data3]
      const ids = new Set<string>()
      allMarks.forEach(mark => {
        if (ids.has(mark.id)) {
          throw new Error(`发现重复的Mark ID: ${mark.id}`)
        }
        ids.add(mark.id)
      })

      return allMarks
    },

    async loadEffects(loader: GameDataLoader): Promise<Effect[]> {
      const [data1, data2, data3, data4, data5] = await Promise.all([
        loader.load<Effect[]>('effect_ability'),
        loader.load<Effect[]>('effect_emblem'),
        loader.load<Effect[]>('effect_mark'),
        loader.load<Effect[]>('effect_skill'),
        loader.load<Effect[]>('effect_global'),
      ])
      // 合并前检查ID冲突
      const allEffects = [...data1, ...data2, ...data3, ...data4, ...data5]
      const ids = new Set<string>()
      allEffects.forEach(effect => {
        if (ids.has(effect.id)) {
          throw new Error(`发现重复的Effect ID: ${effect.id}`)
        }
        ids.add(effect.id)
      })
      return allEffects
    },
  },
})
