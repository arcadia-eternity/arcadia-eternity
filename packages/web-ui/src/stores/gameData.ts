// src/stores/gameData.ts
import { defineStore } from 'pinia'
import { NativePackLoader } from '@arcadia-eternity/pack-loader/native'
import { nativeBuildIdentity } from '@arcadia-eternity/data-pack-base/build'
import { createOfficialContent } from '@arcadia-eternity/data-pack-base/native'
import { SpeciesSchema, SkillSchema, MarkSchema, parseWithErrors } from '@arcadia-eternity/schema'
import type { SpeciesSchemaType, SkillSchemaType, MarkSchemaType, Effect } from '@arcadia-eternity/schema'
import type { ServerEnvironmentContent } from '@arcadia-eternity/protocol'
import YAML from 'yaml'
import { listWorkspacePacks, resolveWorkspaceFileUrl, type WorkspacePackSummary } from '@/services/packWorkspace'
import { applyRuntimeAssetBase, resolveRuntimePackRef } from '@/utils/packRef'

const BASE_PACK_ID = 'arcadia-eternity.base'

function createMetadataLoader() {
  return new NativePackLoader(nativeBuildIdentity, createOfficialContent)
}

interface WorkspaceGameDataLayer {
  folderName: string
  species: Record<string, SpeciesSchemaType>
  skills: Record<string, SkillSchemaType>
  marks: Record<string, MarkSchemaType>
  effects: Record<string, Effect>
  sourceFiles: Record<string, Record<string, string>>
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
  nativeEffectIds: string[]
  loaded: boolean
  gameDataLoaded: boolean
  error: string | null
  workspaceRuntime: WorkspaceRuntimeState
  serverFallback: Pick<
    GameDataState,
    | 'species'
    | 'skills'
    | 'marks'
    | 'effects'
    | 'nativeEffectIds'
    | 'workspaceRuntime'
    | 'loaded'
    | 'gameDataLoaded'
    | 'error'
  > | null
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
    nativeEffectIds: [],
    gameDataLoaded: false,
    workspaceRuntime: emptyWorkspaceRuntime(),
    serverFallback: null,
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
    getRecordSourceFile:
      state =>
      (kind: string, recordId: string): string | null => {
        const layerOrder = state.workspaceRuntime.order
        for (let i = layerOrder.length - 1; i >= 0; i--) {
          const layer = state.workspaceRuntime.layers[layerOrder[i]]
          if (layer?.sourceFiles?.[kind]?.[recordId]) {
            return layer.sourceFiles[kind][recordId]
          }
        }
        return null
      },
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
      this.nativeEffectIds = []
      this.workspaceRuntime = emptyWorkspaceRuntime()
      this.serverFallback = null
    },

    /** Server room data is display-only; no native effect factory is loaded in the browser. */
    applyServerEnvironment(content: ServerEnvironmentContent) {
      const species = this.normalizeData(content.species.map(raw => parseWithErrors(SpeciesSchema, raw)))
      const skills = this.normalizeData(content.skills.map(raw => parseWithErrors(SkillSchema, raw)))
      const marks = this.normalizeData(content.marks.map(raw => parseWithErrors(MarkSchema, raw)))
      const previous = this.serverFallback ?? {
        species: this.species,
        skills: this.skills,
        marks: this.marks,
        effects: this.effects,
        nativeEffectIds: this.nativeEffectIds,
        workspaceRuntime: this.workspaceRuntime,
        loaded: this.loaded,
        gameDataLoaded: this.gameDataLoaded,
        error: this.error,
      }
      this.species = species
      this.skills = skills
      this.marks = marks
      this.effects = { byId: {}, allIds: [] }
      this.nativeEffectIds = []
      this.workspaceRuntime = emptyWorkspaceRuntime()
      this.loaded = true
      this.gameDataLoaded = true
      this.error = null
      this.serverFallback = previous
    },

    clearServerEnvironment() {
      const previous = this.serverFallback
      if (!previous) return
      this.species = previous.species
      this.skills = previous.skills
      this.marks = previous.marks
      this.effects = previous.effects
      this.nativeEffectIds = previous.nativeEffectIds
      this.workspaceRuntime = previous.workspaceRuntime
      this.loaded = previous.loaded
      this.gameDataLoaded = previous.gameDataLoaded
      this.error = previous.error
      this.serverFallback = null
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
        const isNetworkError =
          error instanceof TypeError ||
          String(error).includes('Failed to fetch') ||
          String(error).includes('NetworkError')
        if (isNetworkError) {
          console.warn('游戏数据加载失败：服务器未响应，部分功能不可用')
        } else {
          console.error('❌ Game data initialization failed:', error)
        }
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
      const loader = createMetadataLoader()
      const packRef = await resolveWorkspaceFileUrl(`packs/${encodeURIComponent(folderName)}/pack.json`)
      const result = await loader.loadMetadata(packRef, {
        source: 'http',
        enforceLockfile: true,
      })

      // Build sourceFile mapping: kind → recordId → relativePath
      const sourceFiles: Record<string, Record<string, string>> = {}
      if (result.pack) {
        const kinds = ['species', 'skills', 'marks', 'effects'] as const
        const manifestUrl = toAbsoluteHttpUrl(packRef)
        const dataRoot = resolveDirectoryUrl(result.pack.paths?.dataDir ?? '.', manifestUrl)
        const dataDir = result.pack.paths?.dataDir

        for (const kind of kinds) {
          const kindSourceMap: Record<string, string> = {}
          const filePaths = result.pack.data[kind] as string[] | undefined
          if (Array.isArray(filePaths)) {
            for (const fileRef of filePaths) {
              const fileUrl = new URL(fileRef, dataRoot).toString()
              const relativePath = dataDir && dataDir !== '.' ? `${dataDir}/${fileRef}` : fileRef
              try {
                const records = await fetchArray(fileUrl)
                for (const record of records) {
                  const id = String(record?.id ?? '').trim()
                  if (id) {
                    kindSourceMap[id] = relativePath
                  }
                }
              } catch (e) {
                console.warn(`[gameData] Failed to build source map for ${kind}/${fileRef}:`, e)
              }
            }
          }
          sourceFiles[kind] = kindSourceMap
        }
      }

      return {
        folderName,
        species: this.normalizeData(result.data.species.map(raw => parseWithErrors(SpeciesSchema, raw))).byId,
        skills: this.normalizeData(result.data.skills.map(raw => parseWithErrors(SkillSchema, raw))).byId,
        marks: this.normalizeData(result.data.marks.map(raw => parseWithErrors(MarkSchema, raw))).byId,
        effects: {},
        sourceFiles,
      }
    },

    async loadFromPackRef(packRef: string) {
      const loader = createMetadataLoader()
      const result = await loader.loadMetadata(packRef, {
        source: 'http',
        enforceLockfile: true,
      })
      this.species = this.normalizeData(result.data.species.map(raw => parseWithErrors(SpeciesSchema, raw)))
      this.skills = this.normalizeData(result.data.skills.map(raw => parseWithErrors(SkillSchema, raw)))
      this.marks = this.normalizeData(result.data.marks.map(raw => parseWithErrors(MarkSchema, raw)))
      this.effects = { byId: {}, allIds: [] }
      this.refreshNativeEffectReferences()

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
      const mergedSourceFiles: Record<string, Record<string, string>> = {
        species: {},
        skills: {},
        marks: {},
        effects: {},
      }

      for (const folderName of this.workspaceRuntime.order) {
        const layer = this.workspaceRuntime.layers[folderName]
        if (!layer) continue
        Object.assign(speciesById, layer.species)
        Object.assign(skillsById, layer.skills)
        Object.assign(marksById, layer.marks)
        Object.assign(effectsById, layer.effects)
        for (const kind of ['species', 'skills', 'marks', 'effects']) {
          Object.assign(mergedSourceFiles[kind], layer.sourceFiles?.[kind])
        }
      }

      this.species = this.normalizeRecordData(speciesById)
      this.skills = this.normalizeRecordData(skillsById)
      this.marks = this.normalizeRecordData(marksById)
      this.effects = this.normalizeRecordData(effectsById)
      this.refreshNativeEffectReferences()
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

    refreshNativeEffectReferences() {
      // Build after merging layers: native callbacks may refer to marks defined by another layer.
      const content = createOfficialContent(
        {
          marks: this.marks.allIds.map(id => ({ ...JSON.parse(JSON.stringify(this.marks.byId[id])), effect: [] })),
          skills: [],
          species: [],
        },
        'web-native-effects',
      )
      this.nativeEffectIds = content.effects.map(effect => effect.id)
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
      const nativeEffects = new Set(this.nativeEffectIds)
      this.skills.allIds.forEach(skillId => {
        const skill = this.skills.byId[skillId]
        if (skill?.effect && Array.isArray(skill.effect)) {
          skill.effect.forEach((effectId: string) => {
            if (!this.effects.byId[effectId] && !nativeEffects.has(effectId)) {
              errors.push(`技能 ${skillId} 引用了不存在的效果 ${effectId}`)
            }
          })
        }
      })

      this.marks.allIds.forEach(markId => {
        const mark = this.marks.byId[markId]
        if (mark?.effect && Array.isArray(mark.effect)) {
          mark.effect.forEach((effectId: string) => {
            if (!this.effects.byId[effectId] && !nativeEffects.has(effectId)) {
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
