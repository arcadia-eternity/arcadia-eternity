// src/stores/Resource.ts
import { defineStore } from 'pinia'
import { GameDataLoader } from '@/utils/gameLoader'
import type { AssetManifest, MarkImageSchemaType } from '@arcadia-eternity/schema'
import { PackLoader } from '@arcadia-eternity/pack-loader'
import { listWorkspacePacks, type WorkspacePackSummary, resolveWorkspaceFileUrl } from '@/services/packWorkspace'
import { applyRuntimeAssetBase, resolveRuntimePackRef } from '@/utils/packRef'

const BASE_PACK_ID = 'arcadia-eternity.base'

type ResourceBucket = Record<string, string>

interface ResourceLayer {
  markImage: ResourceBucket
  background: ResourceBucket
  music: ResourceBucket
  skillSound: ResourceBucket
  petSwf: ResourceBucket
  petSound: ResourceBucket
}

interface WorkspaceResourceRuntime {
  active: boolean
  order: string[]
  layers: Record<string, ResourceLayer>
  base: ResourceLayer
}

interface ResourceState {
  markImage: {
    byId: Record<string, string>
    allIds: string[]
  }
  background: {
    byId: Record<string, string>
    allIds: string[]
  }
  music: {
    byId: Record<string, string>
    allIds: string[]
  }
  skillSound: {
    byId: Record<string, string>
    allIds: string[]
  }
  petSwf: {
    byId: Record<string, string>
    allIds: string[]
  }
  petSound: {
    byId: Record<string, string>
    allIds: string[]
  }
  loaded: boolean
  error: string | null
  workspaceRuntime: WorkspaceResourceRuntime
}

function createEmptyLayer(): ResourceLayer {
  return {
    markImage: {},
    background: {},
    music: {},
    skillSound: {},
    petSwf: {},
    petSound: {},
  }
}

function cloneLayer(layer: ResourceLayer): ResourceLayer {
  return {
    markImage: { ...layer.markImage },
    background: { ...layer.background },
    music: { ...layer.music },
    skillSound: { ...layer.skillSound },
    petSwf: { ...layer.petSwf },
    petSound: { ...layer.petSound },
  }
}

function mergeLayer(target: ResourceLayer, overlay: ResourceLayer): void {
  Object.assign(target.markImage, overlay.markImage)
  Object.assign(target.background, overlay.background)
  Object.assign(target.music, overlay.music)
  Object.assign(target.skillSound, overlay.skillSound)
  Object.assign(target.petSwf, overlay.petSwf)
  Object.assign(target.petSound, overlay.petSound)
}

function emptyWorkspaceRuntime(): WorkspaceResourceRuntime {
  return {
    active: false,
    order: [],
    layers: {},
    base: createEmptyLayer(),
  }
}

function normalizeFolderName(folderName: string): string {
  return folderName.trim().toLowerCase()
}

function isWorkspacePackRef(packRef: string): boolean {
  try {
    const url = new URL(packRef, window.location.href)
    return url.pathname.endsWith('/packs/workspace/pack.json')
  } catch {
    return packRef.replace(/[?#].*$/, '').endsWith('/packs/workspace/pack.json')
  }
}

export const useResourceStore = defineStore('Resource', {
  state: (): ResourceState => ({
    loaded: false,
    error: null,
    markImage: {
      byId: {},
      allIds: [],
    },
    background: { byId: {}, allIds: [] },
    music: {
      byId: {},
      allIds: [],
    },
    skillSound: {
      byId: {},
      allIds: [],
    },
    petSwf: {
      byId: {},
      allIds: [],
    },
    petSound: {
      byId: {},
      allIds: [],
    },
    workspaceRuntime: emptyWorkspaceRuntime(),
  }),

  getters: {
    markImageList: state => state.markImage.allIds.map(id => state.markImage.byId[id]),
    getMarkImage: state => (id: string) => {
      if (state.markImage.byId[id]) {
        return state.markImage.byId[id]
      } else {
        console.warn(`未找到标记图片: ${id}`)
        return null
      }
    },
    getBackGround: state => (id: string) => {
      if (state.background.byId[id]) {
        return state.background.byId[id]
      } else {
        console.warn(`未找到背景图片: ${id}`)
        return null
      }
    },
    getMusic: state => (id: string) => {
      if (state.music.byId[id]) {
        return state.music.byId[id]
      } else {
        console.warn(`未找到音乐: ${id}`)
        return null
      }
    },
    getSkillSound: state => (id: string) => {
      if (state.skillSound.byId[id]) {
        return state.skillSound.byId[id]
      } else {
        console.warn(`未找到技能音效: ${id}`)
        return null
      }
    },
    getPetSwf: state => (id: string) => {
      if (state.petSwf.byId[id]) {
        return state.petSwf.byId[id]
      } else {
        return null
      }
    },
    getPetSoundByNum: state => (num: number | string) => {
      const key = String(num)
      if (state.petSound.byId[key]) return state.petSound.byId[key]
      return null
    },
  },

  actions: {
    reset() {
      this.loaded = false
      this.error = null
      this.markImage = { byId: {}, allIds: [] }
      this.background = { byId: {}, allIds: [] }
      this.music = { byId: {}, allIds: [] }
      this.skillSound = { byId: {}, allIds: [] }
      this.petSwf = { byId: {}, allIds: [] }
      this.petSound = { byId: {}, allIds: [] }
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
      const loader = new GameDataLoader({
        devBasePath: '/resource',
        prodBaseUrl: import.meta.env.VITE_API_BASE || '/resource',
      })
      const packLoader = new PackLoader()

      try {
        const [rawMarkImage, rawBackGround, rawMusic, rawSkillSound, rawPetSwf] = await Promise.all([
          this.loadMarkImage(loader),
          this.loadBackGround(loader),
          this.loadMusic(loader),
          this.loadSkillSound(loader),
          this.loadPetSwf(loader),
        ])

        const baseLayer: ResourceLayer = {
          markImage: this.toStringRecord(rawMarkImage),
          background: this.toStringRecord(rawBackGround),
          music: this.toStringRecord(rawMusic),
          skillSound: this.toStringRecord(rawSkillSound),
          petSwf: this.toStringRecord(rawPetSwf),
          petSound: {},
        }

        if (isWorkspacePackRef(packRef)) {
          const enabledPacks = await this.loadEnabledWorkspacePacks()
          if (enabledPacks.length > 0) {
            await this.initializeFromWorkspacePacks(enabledPacks, baseLayer, packLoader)
            this.loaded = true
            this.error = null
            console.log('📁 Resource store installed (workspace incremental mode)')
            return
          }
        }

        const packResult = await packLoader.load(packRef, {
          source: 'http',
          continueOnError: true,
          validateReferences: false,
          enforceLockfile: false,
        })

        if ((packResult.assetConflicts?.length ?? 0) > 0) {
          console.warn('Asset conflicts detected while loading pack resources', packResult.assetConflicts)
        }
        if ((packResult.lockfileIssues?.length ?? 0) > 0) {
          console.warn('Pack lockfile issues detected while loading resources', packResult.lockfileIssues)
        }

        const merged = cloneLayer(baseLayer)
        mergeLayer(merged, this.buildAssetLayer(packResult.assets ?? []))

        this.workspaceRuntime = emptyWorkspaceRuntime()
        this.applyLayerToState(merged)
        this.validateDataIntegrity()

        this.loaded = true
        this.error = null
        console.log('📁 Resource store installed')
      } catch (error) {
        this.error = error instanceof Error ? error.message : '未知错误'
        this.loaded = false
        console.error('❌ Resource initialization failed:', error)
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
      const nextLayers: Record<string, ResourceLayer> = {}
      for (const folderName of nextOrder) {
        const existing = this.workspaceRuntime.layers[folderName]
        if (existing) {
          nextLayers[folderName] = existing
        }
      }

      const targetFolder = normalizeFolderName(input.folderName)
      const packLoader = new PackLoader()
      for (const pack of enabledPacks) {
        const isTarget = normalizeFolderName(pack.folderName) === targetFolder
        if (!nextLayers[pack.folderName] || (input.enabled && isTarget)) {
          nextLayers[pack.folderName] = await this.loadWorkspaceLayer(pack.folderName, packLoader)
        }
      }

      this.workspaceRuntime = {
        active: true,
        order: nextOrder,
        layers: nextLayers,
        base: cloneLayer(this.workspaceRuntime.base),
      }

      this.rebuildFromWorkspaceLayers()
      this.loaded = true
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

    async initializeFromWorkspacePacks(
      enabledPacks: WorkspacePackSummary[],
      baseLayer: ResourceLayer,
      packLoader: PackLoader,
    ) {
      const layers: Record<string, ResourceLayer> = {}
      for (const pack of enabledPacks) {
        layers[pack.folderName] = await this.loadWorkspaceLayer(pack.folderName, packLoader)
      }

      this.workspaceRuntime = {
        active: true,
        order: enabledPacks.map(pack => pack.folderName),
        layers,
        base: cloneLayer(baseLayer),
      }
      this.rebuildFromWorkspaceLayers()
      this.validateDataIntegrity()
    },

    async loadWorkspaceLayer(folderName: string, packLoader: PackLoader): Promise<ResourceLayer> {
      const packRef = await resolveWorkspaceFileUrl(`packs/${encodeURIComponent(folderName)}/pack.json`)
      const packResult = await packLoader.load(packRef, {
        source: 'http',
        continueOnError: true,
        validateReferences: false,
        enforceLockfile: false,
      })

      if ((packResult.assetConflicts?.length ?? 0) > 0) {
        console.warn(`Asset conflicts detected in workspace pack ${folderName}`, packResult.assetConflicts)
      }
      if ((packResult.lockfileIssues?.length ?? 0) > 0) {
        console.warn(`Pack lockfile issues detected in workspace pack ${folderName}`, packResult.lockfileIssues)
      }

      return this.buildAssetLayer(packResult.assets ?? [])
    },

    rebuildFromWorkspaceLayers() {
      const merged = cloneLayer(this.workspaceRuntime.base)
      for (const folderName of this.workspaceRuntime.order) {
        const layer = this.workspaceRuntime.layers[folderName]
        if (!layer) continue
        mergeLayer(merged, layer)
      }

      this.applyLayerToState(merged)
      this.validateDataIntegrity()
    },

    applyLayerToState(layer: ResourceLayer) {
      this.markImage = this.normalizeRecordData(layer.markImage)
      this.background = this.normalizeRecordData(layer.background)
      this.music = this.normalizeRecordData(layer.music)
      this.skillSound = this.normalizeRecordData(layer.skillSound)
      this.petSwf = this.normalizeRecordData(layer.petSwf)
      this.petSound = this.normalizeRecordData(layer.petSound)
    },

    buildAssetLayer(manifests: AssetManifest[]): ResourceLayer {
      const layer = createEmptyLayer()
      const entries = manifests.flatMap(manifest => manifest.assets)
      const entryById = new Map(entries.map(entry => [entry.id, entry]))

      for (const manifest of manifests) {
        const speciesMap = manifest.mappings?.species ?? {}
        for (const [speciesId, assetId] of Object.entries(speciesMap)) {
          const entry = entryById.get(assetId)
          if (!entry) continue
          if (entry.type === 'petSwf') {
            layer.petSwf[speciesId] = entry.uri
          }
        }

        const markMap = manifest.mappings?.marks ?? {}
        for (const [markId, assetId] of Object.entries(markMap)) {
          const entry = entryById.get(assetId)
          if (!entry) continue
          if (entry.type === 'markIcon') {
            layer.markImage[markId] = entry.uri
          }
        }

        const skillMap = manifest.mappings?.skills ?? {}
        for (const [skillId, assetId] of Object.entries(skillMap)) {
          const entry = entryById.get(assetId)
          if (!entry) continue
          if (entry.type === 'skillSfx') {
            layer.skillSound[skillId] = entry.uri
          }
        }
      }

      for (const entry of entries) {
        if (entry.type === 'petSwf' && !layer.petSwf[entry.id]) {
          layer.petSwf[entry.id] = entry.uri
        }
        if (entry.type === 'petSfx') {
          const byPrefix = /^petSound:num:(\d+)$/.exec(entry.id)
          if (byPrefix?.[1]) {
            layer.petSound[byPrefix[1]] = entry.uri
          } else if (/^\d+$/.test(entry.id)) {
            layer.petSound[entry.id] = entry.uri
          }
        }
        if (entry.type === 'markIcon' && !layer.markImage[entry.id]) {
          layer.markImage[entry.id] = entry.uri
        }
        if (entry.type === 'skillSfx' && !layer.skillSound[entry.id]) {
          layer.skillSound[entry.id] = entry.uri
        }
        if (entry.type === 'uiImage' && !layer.background[entry.id]) {
          layer.background[entry.id] = entry.uri
        }
        if (entry.type === 'bgm' && !layer.music[entry.id]) {
          layer.music[entry.id] = entry.uri
        }
      }

      return layer
    },

    normalizeRecordData<T>(item: Record<string, T>) {
      return {
        byId: item,
        allIds: Object.keys(item),
      }
    },

    validateDataIntegrity() {
      const validate = (data: { allIds: string[]; byId: Record<string, unknown> }, type: string) => {
        data.allIds.forEach(id => {
          if (!data.byId[id]) {
            throw new Error(`${type}数据不完整，缺失ID: ${id}`)
          }
        })
      }

      validate(this.markImage, '标记图片')
      validate(this.background, '背景')
      validate(this.music, '音乐')
      validate(this.skillSound, '技能音效')
      validate(this.petSwf, '精灵动画')
      validate(this.petSound, '精灵音效')
    },

    toStringRecord(input: unknown): Record<string, string> {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return {}
      }

      const output: Record<string, string> = {}
      for (const [key, value] of Object.entries(input)) {
        if (typeof value === 'string') {
          output[key] = value
        }
      }
      return output
    },

    async loadMarkImage(loader: GameDataLoader): Promise<MarkImageSchemaType> {
      const data = await loader.load<MarkImageSchemaType>('mark_image')
      return data
    },

    async loadBackGround(loader: GameDataLoader): Promise<Record<string, string>> {
      const data = await loader.load<Record<string, string>>('background')
      return data
    },

    async loadMusic(loader: GameDataLoader): Promise<Record<string, string>> {
      const data = await loader.load<Record<string, string>>('music')
      return data
    },

    async loadSkillSound(loader: GameDataLoader): Promise<Record<string, string>> {
      const data = await loader.load<Record<string, string>>('skill_sound')
      return data
    },

    async loadPetSwf(loader: GameDataLoader): Promise<Record<string, string>> {
      try {
        const data = await loader.load<Record<string, string>>('pet_swf')
        if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
          return data
        }
        return {}
      } catch {
        return {}
      }
    },
  },
})
