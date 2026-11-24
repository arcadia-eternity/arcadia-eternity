import { officialEffectIds, officialEffectMarkRelations } from '@arcadia-eternity/data-pack-base/metadata'
import {
  readSkillParameterCatalog,
  resolveSkillParameters,
  type SkillParameterCatalog,
  readElementCatalog,
  requireElementChart,
  readEnhancementStages,
  type EnhancementStage,
  readNatureCatalog,
  legacyNatures,
  type NatureDefinition,
} from '@arcadia-eternity/const'
import { defineStore } from 'pinia'
import { PackMetadataLoader, presentationIndex } from '@arcadia-eternity/pack-loader/native'
import { SpeciesSchema, SkillSchema, MarkSchema, parseWithErrors } from '@arcadia-eternity/schema'
import type { SpeciesSchemaType, SkillSchemaType, MarkSchemaType } from '@arcadia-eternity/schema'
import type {
  EnvironmentRules,
  ManagedEnvironmentInstallation,
  ServerEnvironmentContent,
} from '@arcadia-eternity/protocol'
import { getServerContentText, isRemoteContentActive, setServerContentText } from '@/i18n/serverContent'
import { applyRuntimeAssetBase, resolveRuntimePackRef } from '@/utils/packRef'
import { localMediaScope, setPackMedia } from '@/services/mediaLoader'
import { acquireLocalContent, acquireLocalContentVersion } from '@/services/localContent'
import { getDesktopApi } from '@/utils/env'
import { hasPreparedWebEnvironment, readPreparedWebCatalog } from '@/services/preparedWebEnvironment'

import type { EffectMarkRelations } from '@/services/skillMarkRelationService'

function createMetadataLoader() {
  return new PackMetadataLoader()
}

interface GameDataState {
  environmentId?: string
  environmentVersion?: string
  defaultEnvironmentName?: string
  defaultGameplayRevision?: string
  rules?: EnvironmentRules
  skillParameterCatalog?: SkillParameterCatalog
  elementCatalog: ReturnType<typeof readElementCatalog>
  enhancements: EnhancementStage[]
  natures: NatureDefinition[]
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
  serverFallback: DisplayCatalog | null
}

type DisplayCatalog = Omit<GameDataState, 'serverFallback' | 'defaultEnvironmentName' | 'defaultGameplayRevision'> & {
  contentText: ServerEnvironmentContent | null
  remoteText: boolean
}
interface DisplayOptions {
  environmentId?: string
  environmentVersion?: string
  rules?: EnvironmentRules
  remote?: boolean
  effectMarkRelations?: EffectMarkRelations
}
type ServerDisplay = 'room' | 'matchmaking'
interface DisplaySource {
  owner: ServerDisplay | 'view' | 'installed'
  catalog: DisplayCatalog
  pinned?: boolean
  release?: () => Promise<void>
  handover?: Promise<void>
}
interface DisplaySources {
  base: DisplayCatalog
  entries: DisplaySource[]
  active: DisplaySource | undefined
}
const displays = new WeakMap<GameDataState, DisplaySources>()

function showCatalog(state: GameDataState, catalog: DisplayCatalog) {
  const { contentText, remoteText, ...metadata } = catalog
  Object.assign(state, metadata)
  setServerContentText(contentText, remoteText)
}

function attachDisplay(state: GameDataState, source: DisplaySource) {
  let sources = displays.get(state)
  if (!sources) {
    const base: DisplayCatalog = {
      environmentId: state.environmentId,
      environmentVersion: state.environmentVersion,
      rules: state.rules,
      skillParameterCatalog: state.skillParameterCatalog,
      elementCatalog: state.elementCatalog,
      enhancements: state.enhancements,
      natures: state.natures,
      species: state.species,
      skills: state.skills,
      marks: state.marks,
      nativeEffectIds: state.nativeEffectIds,
      effectMarkRelations: state.effectMarkRelations,
      loaded: state.loaded,
      gameDataLoaded: state.gameDataLoaded,
      error: state.error,
      contentText: getServerContentText(),
      remoteText: isRemoteContentActive(),
    }
    sources = { base, entries: [], active: undefined }
    displays.set(state, sources)
    state.serverFallback = base
  }
  const active = sources.active
  if (source.owner !== 'view') {
    const previous = sources.entries.find(entry => entry.owner === source.owner)
    if (previous) {
      sources.entries.splice(sources.entries.indexOf(previous), 1)
      void previous.release?.().catch(console.error)
    }
  }
  sources.entries.push(source)
  // A server refresh can add a source to a live local battle without changing its pinned revision.
  if (
    active?.owner === 'view' &&
    !active.catalog.remoteText &&
    source.owner !== 'view' &&
    (active.pinned ||
      (!!active.catalog.environmentVersion && active.catalog.environmentVersion === source.catalog.environmentVersion))
  )
    return
  sources.active = source
  showCatalog(state, source.catalog)
}

function detachDisplay(state: GameDataState, source: DisplaySource) {
  const sources = displays.get(state)
  if (!sources) return
  const index = sources.entries.indexOf(source)
  if (index === -1) return
  sources.entries.splice(index, 1)
  if (sources.active === source) {
    const version = source.catalog.environmentVersion
    const matching =
      version && [...sources.entries].reverse().find(entry => entry.catalog.environmentVersion === version)
    sources.active =
      matching || (version && sources.base.environmentVersion === version ? undefined : sources.entries.at(-1))
    showCatalog(state, sources.active?.catalog ?? sources.base)
  }
  if (!sources.entries.length) {
    displays.delete(state)
    state.serverFallback = null
  }
  void source.release?.().catch(console.error)
}

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
    environmentId: undefined,
    environmentVersion: undefined,
    defaultEnvironmentName: undefined,
    defaultGameplayRevision: undefined,
    rules: undefined,
    skillParameterCatalog: undefined,
    elementCatalog: readElementCatalog({}),
    enhancements: [],
    natures: legacyNatures(),
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
    descriptionParameters(state): Map<string, Record<string, number>> {
      const values = new Map<string, Record<string, number>>()
      if (!state.skillParameterCatalog) return values
      for (const row of resolveSkillParameters(state.skillParameterCatalog, state.rules?.skillParameters)) {
        const params = values.get(row.skill) ?? Object.create(null)
        params[row.useId + '_' + row.parameter] = row.value
        values.set(row.skill, params)
      }
      return values
    },
    elementMultipliers: state => requireElementChart(state.elementCatalog, state.rules?.matchups),
    getElement: state => (id: string) => state.elementCatalog.elements.find(entry => entry.id === id),
    getEnhancement: state => (id: string) => state.enhancements.find(entry => entry.id === id),
    getNature: state => (id: string) => state.natures.find(entry => entry.id === id),
    getSpecies: state => (id: string) => state.species.byId[id],
    getSkill: state => (id: string) => state.skills.byId[id],
    getMark: state => (id: string) => state.marks.byId[id],
  },

  actions: {
    useLocalBattleContent(
      content: ServerEnvironmentContent,
      options: DisplayOptions & { pinned?: boolean } = {},
    ): () => void {
      const source: DisplaySource = {
        owner: 'view',
        pinned: options.pinned,
        catalog: this.buildDisplayCatalog(content, options),
      }
      invalidateMetadata(this)
      attachDisplay(this, source)
      return () => detachDisplay(this, source)
    },

    reset() {
      const sources = displays.get(this)
      displays.delete(this)
      for (const entry of sources?.entries ?? []) void entry.release?.().catch(console.error)
      this.environmentId = undefined
      this.environmentVersion = undefined
      this.defaultEnvironmentName = undefined
      this.defaultGameplayRevision = undefined
      void localMetadataReleases
        .get(this)?.()
        .catch(error => console.warn('本地内容释放失败', error))
      localMetadataReleases.delete(this)
      invalidateMetadata(this)
      setServerContentText(null)
      this.rules = undefined
      this.skillParameterCatalog = undefined
      this.elementCatalog = readElementCatalog({})
      this.enhancements = []
      this.natures = legacyNatures()
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

    buildDisplayCatalog(content: ServerEnvironmentContent, options: DisplayOptions): DisplayCatalog {
      return {
        environmentId: options.environmentId,
        environmentVersion: options.environmentVersion,
        rules: options.rules,
        species: this.normalizeData(content.species.map(raw => parseWithErrors(SpeciesSchema, raw))),
        skills: this.normalizeData(content.skills.map(raw => parseWithErrors(SkillSchema, raw))),
        marks: this.normalizeData(content.marks.map(raw => parseWithErrors(MarkSchema, raw))),
        skillParameterCatalog: content.skillParameters,
        elementCatalog: readElementCatalog(content),
        enhancements: readEnhancementStages(content.enhancements),
        natures: readNatureCatalog(content.natures),
        nativeEffectIds: [],
        effectMarkRelations: options.effectMarkRelations ?? {},
        loaded: true,
        gameDataLoaded: true,
        error: null,
        contentText: content,
        remoteText: options.remote ?? false,
      }
    },

    applyServerEnvironment(
      content: ServerEnvironmentContent,
      options: DisplayOptions & { owner?: ServerDisplay } = {},
    ) {
      const catalog = this.buildDisplayCatalog(content, { ...options, remote: options.remote ?? true })
      invalidateMetadata(this)
      attachDisplay(this, { owner: options.owner ?? 'room', catalog })
    },

    reconcileLocalInstallations(installations: ManagedEnvironmentInstallation[]) {
      const installed = displays.get(this)?.entries.find(entry => entry.owner === 'installed')
      if (
        installed &&
        !installations.some(
          item => item.status === 'ready' && item.environmentVersion === installed.catalog.environmentVersion,
        )
      )
        detachDisplay(this, installed)
    },

    clearServerEnvironment(owner: ServerDisplay = 'room') {
      const sources = displays.get(this)
      const source = sources?.entries.find(entry => entry.owner === owner)
      if (!sources || !source) return
      if (source.handover) return source.handover
      const version = source.catalog.environmentVersion
      if (
        sources.active !== source ||
        !version ||
        sources.base.environmentVersion === version ||
        sources.entries.some(entry => entry !== source && entry.catalog.environmentVersion === version) ||
        (!getDesktopApi() && !hasPreparedWebEnvironment())
      ) {
        detachDisplay(this, source)
        return
      }

      // Keep the selected version visible while resolving a non-default installation.
      // A new selection, socket publication or reset supersedes this read.
      source.handover = (async () => {
        let local: Awaited<ReturnType<typeof acquireLocalContent>>
        try {
          local = await acquireLocalContentVersion(version, source.catalog.environmentId)
          if (
            !local ||
            displays.get(this) !== sources ||
            sources.active !== source ||
            !sources.entries.includes(source)
          )
            return
          const catalog = this.buildDisplayCatalog(local.content, {
            environmentId: local.environmentId,
            environmentVersion: version,
            rules: local.rules,
            effectMarkRelations: local.effectMarkRelations,
          })
          attachDisplay(this, { owner: 'installed', catalog, release: local.release })
          local = undefined
        } catch {
          // This version may only have been available on the server.
        } finally {
          detachDisplay(this, source)
          await local?.release().catch(console.error)
        }
      })()
      return source.handover
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
            this.skillParameterCatalog = captured.content.skillParameters
            this.elementCatalog = readElementCatalog(captured.content)
            this.enhancements = readEnhancementStages(captured.content.enhancements)
            this.natures = readNatureCatalog(captured.content.natures)
            this.rules = captured.rules
            this.serverFallback = null
            this.loaded = this.gameDataLoaded = true
            this.error = null
            this.environmentId = captured.environmentId
            this.environmentVersion = captured.environmentVersion
            this.defaultEnvironmentName = captured.environmentName ?? captured.environmentId
            this.defaultGameplayRevision = captured.gameplayRevision
            const previous = localMetadataReleases.get(this)
            localMetadataReleases.set(this, captured.release)
            setServerContentText(captured.content, false)
            await previous?.()
            return
          }
          if (hasPreparedWebEnvironment()) {
            const {
              content,
              rules,
              effectMarkRelations,
              gameplayRevision,
              environmentVersion,
              builtins,
              defaultEnvironment,
            } = await readPreparedWebCatalog(forceReload)
            if (!isCurrent()) return
            this.species = this.normalizeData(content.species.map(raw => parseWithErrors(SpeciesSchema, raw)))
            this.skills = this.normalizeData(content.skills.map(raw => parseWithErrors(SkillSchema, raw)))
            this.marks = this.normalizeData(content.marks.map(raw => parseWithErrors(MarkSchema, raw)))
            this.skillParameterCatalog = content.skillParameters
            this.elementCatalog = readElementCatalog(content)
            this.enhancements = readEnhancementStages(content.enhancements)
            this.natures = readNatureCatalog(content.natures)
            this.rules = rules
            this.environmentId = defaultEnvironment
            this.environmentVersion = environmentVersion
            this.defaultEnvironmentName =
              builtins?.find(doc => doc.id === defaultEnvironment)?.name ?? defaultEnvironment
            this.defaultGameplayRevision = gameplayRevision
            this.effectMarkRelations = effectMarkRelations ?? {}
            setServerContentText(content, false)
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
      this.skillParameterCatalog = readSkillParameterCatalog(result.data)
      this.elementCatalog = readElementCatalog(result.data)
      this.enhancements = readEnhancementStages(result.data.enhancements)
      this.natures = readNatureCatalog(result.data.natures)
      this.rules = undefined
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

      const media = result.presentation?.flatMap(manifest => manifest.resources) ?? []
      setPackMedia(localMediaScope([packRef, result.pack?.version], undefined, media), media, {
        species: Object.values(this.species.byId),
        skills: Object.values(this.skills.byId),
        marks: Object.values(this.marks.byId),
      })

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
