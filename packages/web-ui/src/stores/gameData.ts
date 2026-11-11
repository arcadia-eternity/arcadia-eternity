import { officialEffectIds, officialEffectMarkRelations } from '@arcadia-eternity/data-pack-base/metadata'
// src/stores/gameData.ts
import { defineStore } from 'pinia'
import { PackMetadataLoader, presentationIndex } from '@arcadia-eternity/pack-loader/native'
import { SpeciesSchema, SkillSchema, MarkSchema, parseWithErrors } from '@arcadia-eternity/schema'
import type { SpeciesSchemaType, SkillSchemaType, MarkSchemaType } from '@arcadia-eternity/schema'
import type { ServerEnvironmentContent } from '@arcadia-eternity/protocol'
import { getServerContentText, isRemoteContentActive, setServerContentText } from '@/i18n/serverContent'
import { applyRuntimeAssetBase, resolveRuntimePackRef } from '@/utils/packRef'
import { acquireLocalContent } from '@/services/localContent'
import { getDesktopApi } from '@/utils/env'
import { hasPreparedWebEnvironment, readPreparedWebCatalog } from '@/services/preparedWebEnvironment'

import type { EffectMarkRelations } from '@/services/skillMarkRelationService'

function createMetadataLoader() {
  return new PackMetadataLoader()
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
  nativeEffectIds: string[]
  effectMarkRelations: EffectMarkRelations
  loaded: boolean
  gameDataLoaded: boolean
  error: string | null
  serverFallback:
    | (Pick<
        GameDataState,
        | 'species'
        | 'skills'
        | 'marks'
        | 'nativeEffectIds'
        | 'effectMarkRelations'
        | 'loaded'
        | 'gameDataLoaded'
        | 'error'
      > & { contentText: ServerEnvironmentContent | null; remoteText: boolean })
    | null
}

interface LocalDisplayScope {
  previous: GameDataState
  previousText: ServerEnvironmentContent | null
  previousRemote: boolean
  displayed: GameDataState['species']
  parent?: LocalDisplayScope
  released: boolean
}
const localDisplays = new WeakMap<object, LocalDisplayScope>()
const localMetadataReleases = new WeakMap<object, () => Promise<void>>()

// Bootstrap and the mounted battle page share initialization. Display-scope changes
// invalidate pending local commits even when the loader itself cannot be cancelled.
const metadataScopes = new WeakMap<
  object,
  { generation: number; pending?: { ready: Promise<void>; cancel: () => void } }
>()
function metadataScope(store: object) {
  let scope = metadataScopes.get(store)
  if (!scope) {
    scope = { generation: 0 }
    metadataScopes.set(store, scope)
  }
  return scope
}
function invalidateMetadata(store: object) {
  const scope = metadataScope(store)
  scope.generation++
  scope.pending?.cancel()
  scope.pending = undefined
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
    nativeEffectIds: [],
    effectMarkRelations: {},
    gameDataLoaded: false,
    serverFallback: null,
  }),

  getters: {
    speciesList: state => state.species.allIds.map(id => state.species.byId[id]),
    skillList: state => state.skills.allIds.map(id => state.skills.byId[id]),
    marksList: state => state.marks.allIds.map(id => state.marks.byId[id]),
    getSpecies: state => (id: string) => state.species.byId[id],
    getSkill: state => (id: string) => state.skills.byId[id],
    getMark: state => (id: string) => state.marks.byId[id],
  },

  actions: {
    /** Local trial display lasts exactly as long as its battle, including failed launches. */
    useLocalBattleContent(content: ServerEnvironmentContent): () => void {
      const previous = {
        species: this.species,
        skills: this.skills,
        marks: this.marks,
        nativeEffectIds: this.nativeEffectIds,
        effectMarkRelations: this.effectMarkRelations,
        loaded: this.loaded,
        gameDataLoaded: this.gameDataLoaded,
        error: this.error,
        serverFallback: this.serverFallback,
      }
      const current = localDisplays.get(this)
      const parent = current?.displayed === this.species ? current : undefined
      const previousText = getServerContentText()
      const previousRemote = isRemoteContentActive()
      this.applyServerEnvironment(content, { remote: false })
      const scope: LocalDisplayScope = {
        previous,
        previousText,
        previousRemote,
        displayed: this.species,
        parent,
        released: false,
      }
      localDisplays.set(this, scope)
      return () => {
        if (scope.released) return
        scope.released = true
        if (localDisplays.get(this) !== scope) return
        if (this.species !== scope.displayed) {
          localDisplays.delete(this)
          return
        }
        // Skip already released parents, so overlapping cleanup cannot resurrect an old trial.
        let restore = scope
        while (restore.parent?.released) restore = restore.parent
        this.$patch(state => Object.assign(state, restore.previous))
        setServerContentText(restore.previousText, restore.previousRemote)
        if (restore.parent) localDisplays.set(this, restore.parent)
        else localDisplays.delete(this)
      }
    },

    reset() {
      void localMetadataReleases
        .get(this)?.()
        .catch(error => console.warn('本地内容释放失败', error))
      localMetadataReleases.delete(this)
      invalidateMetadata(this)
      setServerContentText(null)
      this.loaded = false
      this.gameDataLoaded = false
      this.error = null
      this.species = { byId: {}, allIds: [] }
      this.skills = { byId: {}, allIds: [] }
      this.marks = { byId: {}, allIds: [] }
      this.nativeEffectIds = []
      this.effectMarkRelations = {}
      this.serverFallback = null
    },

    /** Server room data is display-only; no native effect factory is loaded in the browser. */
    applyServerEnvironment(content: ServerEnvironmentContent, options: { remote?: boolean } = {}) {
      const species = this.normalizeData(content.species.map(raw => parseWithErrors(SpeciesSchema, raw)))
      const skills = this.normalizeData(content.skills.map(raw => parseWithErrors(SkillSchema, raw)))
      const marks = this.normalizeData(content.marks.map(raw => parseWithErrors(MarkSchema, raw)))
      invalidateMetadata(this)
      const previous = this.serverFallback ?? {
        species: this.species,
        skills: this.skills,
        marks: this.marks,
        nativeEffectIds: this.nativeEffectIds,
        effectMarkRelations: this.effectMarkRelations,
        loaded: this.loaded,
        gameDataLoaded: this.gameDataLoaded,
        error: this.error,
        contentText: getServerContentText(),
        remoteText: isRemoteContentActive(),
      }
      this.species = species
      this.skills = skills
      this.marks = marks
      this.nativeEffectIds = []
      this.effectMarkRelations = {}
      this.loaded = true
      this.gameDataLoaded = true
      this.error = null
      this.serverFallback = previous
      setServerContentText(content, options.remote !== false)
    },

    clearServerEnvironment() {
      const previous = this.serverFallback
      if (!previous) return
      invalidateMetadata(this)
      setServerContentText(previous.contentText, previous.remoteText)
      this.species = previous.species
      this.skills = previous.skills
      this.marks = previous.marks
      this.nativeEffectIds = previous.nativeEffectIds
      this.effectMarkRelations = previous.effectMarkRelations
      this.loaded = previous.loaded
      this.gameDataLoaded = previous.gameDataLoaded
      this.error = previous.error
      this.serverFallback = null
    },

    /** Store-owned readiness. Pages only consume this shared task; they never cancel it on unmount. */
    async initialize(options?: { forceReload?: boolean }) {
      const forceReload = options?.forceReload === true
      if (this.loaded && !forceReload) return
      const scope = metadataScope(this)
      if (!forceReload && scope.pending) return scope.pending.ready
      if (forceReload) this.reset()
      const generation = scope.generation
      const isCurrent = () => scope.generation === generation
      const work = (async () => {
        try {
          if (getDesktopApi()) {
            const captured = await acquireLocalContent()
            if (!captured) throw new Error('本地内容服务不可用')
            if (!isCurrent()) {
              await captured.release()
              return
            }
            this.species = this.normalizeData(captured.content.species.map(raw => parseWithErrors(SpeciesSchema, raw)))
            this.skills = this.normalizeData(captured.content.skills.map(raw => parseWithErrors(SkillSchema, raw)))
            this.marks = this.normalizeData(captured.content.marks.map(raw => parseWithErrors(MarkSchema, raw)))
            this.nativeEffectIds = []
            this.effectMarkRelations = {}
            this.serverFallback = null
            this.loaded = this.gameDataLoaded = true
            this.error = null
            const previous = localMetadataReleases.get(this)
            localMetadataReleases.set(this, captured.release)
            setServerContentText(captured.content, false)
            await previous?.()
            return
          }
          if (hasPreparedWebEnvironment()) {
            const { content, effectMarkRelations } = await readPreparedWebCatalog(forceReload)
            if (!isCurrent()) return
            this.species = this.normalizeData(content.species.map(raw => parseWithErrors(SpeciesSchema, raw)))
            this.skills = this.normalizeData(content.skills.map(raw => parseWithErrors(SkillSchema, raw)))
            this.marks = this.normalizeData(content.marks.map(raw => parseWithErrors(MarkSchema, raw)))
            this.effectMarkRelations = effectMarkRelations ?? {}
            if (content.locales) setServerContentText(content, false)
            this.loaded = this.gameDataLoaded = true
            this.error = null
            return
          }
          const packRef = await resolveRuntimePackRef({ forceRefresh: forceReload })
          if (!isCurrent()) return
          applyRuntimeAssetBase(packRef)
          await this.loadFromPackRef(packRef, isCurrent)
          if (!isCurrent()) return
          this.loaded = true
          this.gameDataLoaded = true
          this.error = null
          console.log('🎮 Game data store installed')
        } catch (error) {
          if (!isCurrent()) return
          this.error = error instanceof Error ? error.message : '未知错误'
          this.loaded = false
          this.gameDataLoaded = false
          const isNetworkError =
            error instanceof TypeError ||
            String(error).includes('Failed to fetch') ||
            String(error).includes('NetworkError')
          if (isNetworkError) console.warn('游戏数据加载失败：服务器未响应，部分功能不可用')
          else console.error('❌ Game data initialization failed:', error)
          throw error
        }
      })()
      let cancel!: () => void
      const cancelled = new Promise<void>((_resolve, reject) => {
        cancel = () => reject(new DOMException('Game data scope changed', 'AbortError'))
      })
      const entry = { ready: Promise.race([work, cancelled]), cancel }
      // Scope ownership may end before all consumers start awaiting readiness.
      void entry.ready.catch(() => {})
      scope.pending = entry
      try {
        await entry.ready
      } finally {
        if (scope.pending === entry) scope.pending = undefined
      }
    },

    /** Consumers follow a scope replacement; only this store owns cancellation. */
    async whenReady(): Promise<void> {
      for (;;) {
        const generation = metadataScope(this).generation
        try {
          await this.initialize()
          return
        } catch (error) {
          if (
            !(error instanceof DOMException && error.name === 'AbortError') ||
            metadataScope(this).generation === generation
          )
            throw error
        }
      }
    },

    async reload() {
      await this.initialize({ forceReload: true })
    },

    async loadFromPackRef(packRef: string, current?: () => boolean) {
      const generation = metadataScope(this).generation
      const isCurrent = current ?? (() => metadataScope(this).generation === generation)
      const loader = createMetadataLoader()
      const result = await loader.loadMetadata(packRef, {
        source: 'http',
        enforceLockfile: true,
        includeLocales: false,
      })
      if (!isCurrent()) return
      const presentations = presentationIndex(result.presentation)
      this.species = this.normalizeData(
        result.data.species.map(raw => ({
          ...parseWithErrors(SpeciesSchema, raw),
          presentation: presentations.get(`species:${parseWithErrors(SpeciesSchema, raw).id}`),
        })),
      )
      this.skills = this.normalizeData(
        result.data.skills.map(raw => ({
          ...parseWithErrors(SkillSchema, raw),
          presentation: presentations.get(`skills:${parseWithErrors(SkillSchema, raw).id}`),
        })),
      )
      this.marks = this.normalizeData(
        result.data.marks.map(raw => ({
          ...parseWithErrors(MarkSchema, raw),
          presentation: presentations.get(`marks:${parseWithErrors(MarkSchema, raw).id}`),
        })),
      )
      this.refreshNativeEffectReferences()

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
      this.nativeEffectIds = [...officialEffectIds]
      this.effectMarkRelations = officialEffectMarkRelations
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
            if (!nativeEffects.has(effectId)) {
              errors.push(`技能 ${skillId} 引用了不存在的效果 ${effectId}`)
            }
          })
        }
      })

      this.marks.allIds.forEach(markId => {
        const mark = this.marks.byId[markId]
        if (mark?.effect && Array.isArray(mark.effect)) {
          mark.effect.forEach((effectId: string) => {
            if (!nativeEffects.has(effectId)) {
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
