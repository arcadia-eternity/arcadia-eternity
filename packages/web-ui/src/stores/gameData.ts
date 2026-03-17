// src/stores/gameData.ts
import { defineStore } from 'pinia'
import { PackLoader, type V2DataPackManifest } from '@arcadia-eternity/pack-loader'
import type { SpeciesSchemaType, SkillSchemaType, MarkSchemaType, Effect, LearnableSkill } from '@arcadia-eternity/schema'
import type { BaseMarkData, BaseSkillData, SpeciesData } from '@arcadia-eternity/battle'
import type { EffectDef } from '@arcadia-eternity/engine'
import YAML from 'yaml'
import { applyRuntimeAssetBase, resolveRuntimePackRef } from '@/utils/packRef'

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
      const loader = new PackLoader()
      const packRef = await resolveRuntimePackRef()
      applyRuntimeAssetBase(packRef)

      try {
        const result = await loader.load(packRef, {
          source: 'http',
          continueOnError: false,
          validateReferences: true,
          enforceLockfile: true,
        })
        const learnableSkillsMap = await loadLearnableSkillsMap(packRef, result.pack)
        const rawSpecies = Array.from(result.repository.allSpecies()).map(species => {
          const learnableSkills = learnableSkillsMap.get(species.id)
          if (!learnableSkills) {
            throw new Error(`Species '${species.id}' missing learnable_skills in pack source`)
          }
          return speciesToSchema(species, learnableSkills)
        })
        const rawSkills = Array.from(result.repository.allSkills()).map(skillToSchema)
        const rawMarks = Array.from(result.repository.allMarks()).map(markToSchema)
        const rawEffects = Array.from(result.repository.allEffects()).map(effectToSchema)

        // 标准化数据结构
        this.species = this.normalizeData(rawSpecies)
        this.skills = this.normalizeData(rawSkills)
        this.marks = this.normalizeData(rawMarks)
        this.effects = this.normalizeData(rawEffects)

        // 验证数据完整性
        this.validateDataIntegrity()

        console.log('Pack loaded', {
          packId: result.pack?.id,
          packVersion: result.pack?.version,
          hasLockfile: result.lockfile !== undefined,
          lockfileVersion: result.lockfile?.lockfileVersion,
          lockfileIssueCount: result.lockfileIssues?.length ?? 0,
          assetConflictCount: result.assetConflicts?.length ?? 0,
        })
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

  },
})

function markToSchema(mark: BaseMarkData): MarkSchemaType {
  return {
    id: mark.id,
    iconRef: mark.iconRef,
    config: mark.config,
    tags: mark.tags,
    effect: mark.effectIds,
  }
}

function skillToSchema(skill: BaseSkillData): SkillSchemaType {
  return {
    id: skill.id,
    sfxRef: skill.sfxRef,
    element: skill.element,
    category: skill.category,
    power: skill.power,
    rage: skill.rage,
    accuracy: skill.accuracy,
    priority: skill.priority,
    target: skill.target,
    multihit: skill.multihit,
    sureHit: skill.sureHit,
    sureCrit: skill.sureCrit,
    ignoreShield: skill.ignoreShield,
    ignoreOpponentStageStrategy: skill.ignoreOpponentStageStrategy,
    tags: skill.tags,
    effect: skill.effectIds,
  }
}

function speciesToSchema(species: SpeciesData, learnableSkills: LearnableSkill[]): SpeciesSchemaType {
  return {
    id: species.id,
    num: species.num,
    assetRef: species.assetRef,
    element: species.element,
    baseStats: species.baseStats,
    genderRatio: species.genderRatio,
    heightRange: species.heightRange,
    weightRange: species.weightRange,
    learnable_skills: learnableSkills,
    ability: species.abilityIds,
    emblem: species.emblemIds,
  }
}

async function loadLearnableSkillsMap(
  packRef: string,
  manifest: V2DataPackManifest | undefined,
): Promise<Map<string, LearnableSkill[]>> {
  if (!manifest) return new Map()
  const map = new Map<string, LearnableSkill[]>()
  const manifestUrl = toAbsoluteHttpUrl(packRef)
  const dataRoot = resolveDirectoryUrl(manifest.paths?.dataDir ?? '.', manifestUrl)

  for (const file of manifest.data.species) {
    const fileUrl = new URL(file, dataRoot).toString()
    const rows = await fetchArray(fileUrl)
    for (const row of rows) {
      const speciesId = row.id as string | undefined
      if (!speciesId) continue
      const learnableSkills = (Array.isArray(row.learnable_skills) ? row.learnable_skills : []) as LearnableSkill[]
      map.set(speciesId, learnableSkills)
    }
  }

  return map
}

function resolveDirectoryUrl(dir: string, baseUrl: string): URL {
  const normalizedDir = dir === '.' ? './' : `${dir.replace(/\/+$/, '')}/`
  return new URL(normalizedDir, baseUrl)
}

function toAbsoluteHttpUrl(urlOrPath: string): string {
  return new URL(urlOrPath, getHttpBaseUrl()).toString()
}

function getHttpBaseUrl(): string {
  const maybeLocation = (globalThis as { location?: { href?: string } }).location
  if (typeof maybeLocation?.href === 'string' && maybeLocation.href.length > 0) {
    return maybeLocation.href
  }
  return 'http://localhost/'
}

async function fetchArray(url: string): Promise<Record<string, unknown>[]> {
  try {
    const text = await fetchText(url)
    const isJson = url.toLowerCase().endsWith('.json')
    const parsed = isJson ? JSON.parse(text) : YAML.parse(text, { merge: true })
    if (!Array.isArray(parsed)) {
      throw new Error(`Expected array content from ${url}`)
    }
    return parsed as Record<string, unknown>[]
  } catch (error) {
    if (url.endsWith('.yaml')) {
      const jsonUrl = url.replace(/\.yaml$/, '.json')
      const text = await fetchText(jsonUrl)
      const parsed = JSON.parse(text)
      if (!Array.isArray(parsed)) {
        throw new Error(`Expected array content from ${jsonUrl}`)
      }
      return parsed as Record<string, unknown>[]
    }
    throw error
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`)
  }
  return response.text()
}

function effectToSchema(effect: EffectDef): Effect {
  return {
    id: effect.id,
    trigger: effect.triggers,
    priority: effect.priority,
    apply: effect.apply as Effect['apply'],
    condition: effect.condition as Effect['condition'],
    consumesStacks: effect.consumesStacks,
    tags: effect.tags,
  } as Effect
}
