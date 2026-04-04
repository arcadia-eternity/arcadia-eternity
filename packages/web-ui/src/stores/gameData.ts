// src/stores/gameData.ts
import { defineStore } from 'pinia'
import { PackLoader, type V2DataPackManifest } from '@arcadia-eternity/pack-loader'
import type { SpeciesSchemaType, SkillSchemaType, MarkSchemaType, Effect, LearnableSkill } from '@arcadia-eternity/schema'
import type { BaseMarkData, BaseSkillData, SpeciesData } from '@arcadia-eternity/battle'
import { AttackTargetOpinion, Category, Element, IgnoreStageStrategy, StackStrategy } from '@arcadia-eternity/const'
import YAML from 'yaml'
import { listWorkspacePacks, resolveWorkspaceFileUrl, type WorkspacePackSummary } from '@/services/packWorkspace'
import { applyRuntimeAssetBase, resolveRuntimePackRef } from '@/utils/packRef'

const BASE_PACK_ID = 'arcadia-eternity.base'

type EffectDefLike = {
  id: string
  triggers: unknown
  priority?: unknown
  apply?: unknown
  condition?: unknown
  consumesStacks?: unknown
  tags?: unknown
}

const ELEMENT_SET = new Set(Object.values(Element))
const CATEGORY_SET = new Set(Object.values(Category))
const TARGET_SET = new Set(Object.values(AttackTargetOpinion))
const IGNORE_STAGE_SET = new Set(Object.values(IgnoreStageStrategy))
const STACK_STRATEGY_SET = new Set(Object.values(StackStrategy))

function normalizeElement(value: unknown): SkillSchemaType['element'] {
  if (typeof value === 'string' && ELEMENT_SET.has(value as Element)) {
    return value as SkillSchemaType['element']
  }
  return Element.Normal as SkillSchemaType['element']
}

function normalizeCategory(value: unknown): SkillSchemaType['category'] {
  if (typeof value === 'string' && CATEGORY_SET.has(value as Category)) {
    return value as SkillSchemaType['category']
  }
  return Category.Status as SkillSchemaType['category']
}

function normalizeTarget(value: unknown): SkillSchemaType['target'] {
  if (typeof value === 'string' && TARGET_SET.has(value as AttackTargetOpinion)) {
    return value as SkillSchemaType['target']
  }
  return undefined
}

function normalizeIgnoreStage(value: unknown): SkillSchemaType['ignoreOpponentStageStrategy'] {
  if (typeof value === 'string' && IGNORE_STAGE_SET.has(value as IgnoreStageStrategy)) {
    return value as SkillSchemaType['ignoreOpponentStageStrategy']
  }
  return IgnoreStageStrategy.none as SkillSchemaType['ignoreOpponentStageStrategy']
}

function normalizeStackStrategy(value: unknown): NonNullable<MarkSchemaType['config']>['stackStrategy'] {
  if (typeof value === 'string' && STACK_STRATEGY_SET.has(value as StackStrategy)) {
    return value as NonNullable<MarkSchemaType['config']>['stackStrategy']
  }
  return StackStrategy.extend as NonNullable<MarkSchemaType['config']>['stackStrategy']
}

interface WorkspaceGameDataLayer {
  folderName: string
  species: Record<string, SpeciesSchemaType>
  skills: Record<string, SkillSchemaType>
  marks: Record<string, MarkSchemaType>
  effects: Record<string, Effect>
}

interface WorkspaceRuntimeState {
  active: boolean
  order: string[]
  layers: Record<string, WorkspaceGameDataLayer>
}

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
  workspaceRuntime: WorkspaceRuntimeState
}

function emptyWorkspaceRuntime(): WorkspaceRuntimeState {
  return {
    active: false,
    order: [],
    layers: {},
  }
}

function isWorkspacePackRef(packRef: string): boolean {
  try {
    const url = new URL(packRef, getHttpBaseUrl())
    return url.pathname.endsWith('/packs/workspace/pack.json')
  } catch {
    return packRef.replace(/[?#].*$/, '').endsWith('/packs/workspace/pack.json')
  }
}

function normalizeFolderName(folderName: string): string {
  return folderName.trim().toLowerCase()
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
    workspaceRuntime: emptyWorkspaceRuntime(),
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
    reset() {
      this.loaded = false
      this.gameDataLoaded = false
      this.error = null
      this.species = { byId: {}, allIds: [] }
      this.skills = { byId: {}, allIds: [] }
      this.marks = { byId: {}, allIds: [] }
      this.effects = { byId: {}, allIds: [] }
      this.workspaceRuntime = emptyWorkspaceRuntime()
    },

    async initialize(options?: { forceReload?: boolean }) {
      const forceReload = options?.forceReload === true
      if (this.loaded && !forceReload) return
      if (forceReload) {
        this.reset()
      }

      const packRef = await resolveRuntimePackRef({ forceRefresh: forceReload })
      applyRuntimeAssetBase(packRef)

      try {
        if (isWorkspacePackRef(packRef)) {
          const enabledPacks = await this.loadEnabledWorkspacePacks()
          if (enabledPacks.length > 0) {
            await this.initializeFromWorkspacePacks(enabledPacks)
            this.loaded = true
            this.gameDataLoaded = true
            this.error = null
            console.log('🎮 Game data store installed (workspace incremental mode)')
            return
          }
        }

        await this.loadFromPackRef(packRef)
        this.loaded = true
        this.gameDataLoaded = true
        this.error = null
        console.log('🎮 Game data store installed')
      } catch (error) {
        this.error = error instanceof Error ? error.message : '未知错误'
        this.loaded = false
        this.gameDataLoaded = false
        console.error('❌ Game data initialization failed:', error)
        throw error
      }
    },

    async reload() {
      await this.initialize({ forceReload: true })
    },

    async applyWorkspacePackToggle(input: { folderName: string; enabled: boolean }) {
      if (!this.loaded) {
        await this.initialize({ forceReload: true })
        return
      }

      if (!this.workspaceRuntime.active) {
        await this.reload()
        return
      }

      const enabledPacks = await this.loadEnabledWorkspacePacks()
      if (enabledPacks.length === 0) {
        await this.reload()
        return
      }

      const nextOrder = enabledPacks.map(pack => pack.folderName)
      const nextLayers: Record<string, WorkspaceGameDataLayer> = {}
      for (const folderName of nextOrder) {
        const existing = this.workspaceRuntime.layers[folderName]
        if (existing) {
          nextLayers[folderName] = existing
        }
      }

      const targetFolder = normalizeFolderName(input.folderName)
      for (const pack of enabledPacks) {
        const isTarget = normalizeFolderName(pack.folderName) === targetFolder
        if (!nextLayers[pack.folderName] || (input.enabled && isTarget)) {
          nextLayers[pack.folderName] = await this.loadWorkspaceLayer(pack.folderName)
        }
      }

      this.workspaceRuntime = {
        active: true,
        order: nextOrder,
        layers: nextLayers,
      }
      this.rebuildFromWorkspaceLayers()
      this.loaded = true
      this.gameDataLoaded = true
      this.error = null
    },

    async loadEnabledWorkspacePacks(): Promise<WorkspacePackSummary[]> {
      const allPacks = await listWorkspacePacks()
      if (allPacks.length === 0) return []

      const enabledPacks = allPacks.filter(pack => pack.enabled)
      if (enabledPacks.length === 0) return []
      if (!enabledPacks.some(pack => pack.id === BASE_PACK_ID)) {
        throw new Error('默认数据包必须保持启用')
      }

      return enabledPacks
    },

    async initializeFromWorkspacePacks(enabledPacks: WorkspacePackSummary[]) {
      const layers: Record<string, WorkspaceGameDataLayer> = {}
      for (const pack of enabledPacks) {
        layers[pack.folderName] = await this.loadWorkspaceLayer(pack.folderName)
      }

      this.workspaceRuntime = {
        active: true,
        order: enabledPacks.map(pack => pack.folderName),
        layers,
      }
      this.rebuildFromWorkspaceLayers()
    },

    async loadWorkspaceLayer(folderName: string): Promise<WorkspaceGameDataLayer> {
      const loader = new PackLoader()
      const packRef = await resolveWorkspaceFileUrl(`packs/${encodeURIComponent(folderName)}/pack.json`)
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

      return {
        folderName,
        species: this.normalizeData(rawSpecies).byId,
        skills: this.normalizeData(Array.from(result.repository.allSkills()).map(skillToSchema)).byId,
        marks: this.normalizeData(Array.from(result.repository.allMarks()).map(markToSchema)).byId,
        effects: this.normalizeData(Array.from(result.repository.allEffects()).map(effectToSchema)).byId,
      }
    },

    async loadFromPackRef(packRef: string) {
      const loader = new PackLoader()
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

      this.species = this.normalizeData(rawSpecies)
      this.skills = this.normalizeData(rawSkills)
      this.marks = this.normalizeData(rawMarks)
      this.effects = this.normalizeData(rawEffects)

      this.workspaceRuntime = emptyWorkspaceRuntime()
      this.validateDataIntegrity()

      console.log('Pack loaded', {
        packId: result.pack?.id,
        packVersion: result.pack?.version,
        hasLockfile: result.lockfile !== undefined,
        lockfileVersion: result.lockfile?.lockfileVersion,
        lockfileIssueCount: result.lockfileIssues?.length ?? 0,
        assetConflictCount: result.assetConflicts?.length ?? 0,
      })
    },

    rebuildFromWorkspaceLayers() {
      const speciesById: Record<string, SpeciesSchemaType> = {}
      const skillsById: Record<string, SkillSchemaType> = {}
      const marksById: Record<string, MarkSchemaType> = {}
      const effectsById: Record<string, Effect> = {}

      for (const folderName of this.workspaceRuntime.order) {
        const layer = this.workspaceRuntime.layers[folderName]
        if (!layer) continue
        Object.assign(speciesById, layer.species)
        Object.assign(skillsById, layer.skills)
        Object.assign(marksById, layer.marks)
        Object.assign(effectsById, layer.effects)
      }

      this.species = this.normalizeRecordData(speciesById)
      this.skills = this.normalizeRecordData(skillsById)
      this.marks = this.normalizeRecordData(marksById)
      this.effects = this.normalizeRecordData(effectsById)
      this.validateDataIntegrity()
    },

    normalizeRecordData<T>(item: Record<string, T>) {
      return {
        byId: item,
        allIds: Object.keys(item),
      }
    },

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

    validateDataIntegrity() {
      const errors: string[] = []

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

      this.validateCrossReferences(errors)

      if (errors.length > 0) {
        console.error('❌ 数据验证失败:')
        errors.forEach(error => console.error(`  - ${error}`))
        throw new Error(`发现 ${errors.length} 个数据问题`)
      }
    },

    validateCrossReferences(errors: string[]) {
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

      this.species.allIds.forEach(speciesId => {
        const species = this.species.byId[speciesId]

        if (species?.learnable_skills && Array.isArray(species.learnable_skills)) {
          species.learnable_skills.forEach((learnableSkill: { skill_id: string }) => {
            if (!this.skills.byId[learnableSkill.skill_id]) {
              errors.push(`物种 ${speciesId} 引用了不存在的技能 ${learnableSkill.skill_id}`)
            }
          })
        }

        if (species?.ability && Array.isArray(species.ability)) {
          species.ability.forEach((abilityId: string) => {
            if (!this.marks.byId[abilityId]) {
              errors.push(`物种 ${speciesId} 引用了不存在的能力标记 ${abilityId}`)
            }
          })
        }

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
    config: {
      ...mark.config,
      stackStrategy: normalizeStackStrategy(mark.config.stackStrategy),
    },
    tags: mark.tags,
    effect: mark.effectIds,
  }
}

function skillToSchema(skill: BaseSkillData): SkillSchemaType {
  return {
    id: skill.id,
    sfxRef: skill.sfxRef,
    element: normalizeElement(skill.element),
    category: normalizeCategory(skill.category),
    power: skill.power,
    rage: skill.rage,
    accuracy: skill.accuracy,
    priority: skill.priority,
    target: normalizeTarget(skill.target),
    multihit: skill.multihit,
    sureHit: skill.sureHit,
    sureCrit: skill.sureCrit,
    ignoreShield: skill.ignoreShield,
    ignoreOpponentStageStrategy: normalizeIgnoreStage(skill.ignoreOpponentStageStrategy),
    tags: skill.tags,
    effect: skill.effectIds,
  }
}

function speciesToSchema(species: SpeciesData, learnableSkills: LearnableSkill[]): SpeciesSchemaType {
  return {
    id: species.id,
    num: species.num,
    assetRef: species.assetRef,
    element: normalizeElement(species.element),
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

function effectToSchema(effect: EffectDefLike): Effect {
  return {
    id: effect.id,
    trigger: Array.isArray(effect.triggers) ? effect.triggers : [],
    priority: typeof effect.priority === 'number' ? effect.priority : 0,
    apply: effect.apply as Effect['apply'],
    condition: effect.condition as Effect['condition'],
    consumesStacks: typeof effect.consumesStacks === 'boolean' ? effect.consumesStacks : undefined,
    tags: Array.isArray(effect.tags) ? effect.tags.filter((tag): tag is string => typeof tag === 'string') : [],
  } as Effect
}
