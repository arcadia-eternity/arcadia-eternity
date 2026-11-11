import { officialAssetUrl } from '@/utils/officialAssetUrl'
// src/stores/Resource.ts
import { defineStore } from 'pinia'
import type { ContentPresentation, PresentationManifest } from '@arcadia-eternity/schema'
import { PackMetadataLoader, presentationIndex } from '@arcadia-eternity/pack-loader/native'
import { hasPreparedWebEnvironment, readPreparedWebCatalog } from '@/services/preparedWebEnvironment'
import { applyRuntimeAssetBase, resolveRuntimePackRef } from '@/utils/packRef'
import { acquireLocalContent } from '@/services/localContent'
import { getDesktopApi } from '@/utils/env'

type ResourceBucket = Record<string, string>

interface ResourceLayer {
  markImage: ResourceBucket
  background: ResourceBucket
  music: ResourceBucket
  skillSound: ResourceBucket
  petSwf: ResourceBucket
  petSound: ResourceBucket
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
}

const localResourceReleases = new WeakMap<object, () => Promise<void>>()

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

// Bootstrap and battle consumers share work owned by this store. Scope changes
// fence late loader results even when the underlying metadata request cannot stop.
const resourceScopes = new WeakMap<
  object,
  { generation: number; pending?: { ready: Promise<void>; cancel: () => void } }
>()
function resourceScope(store: object) {
  let scope = resourceScopes.get(store)
  if (!scope) {
    scope = { generation: 0 }
    resourceScopes.set(store, scope)
  }
  return scope
}
function invalidateResourceScope(store: object) {
  const scope = resourceScope(store)
  scope.generation++
  scope.pending?.cancel()
  scope.pending = undefined
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
      invalidateResourceScope(this)
      void localResourceReleases
        .get(this)?.()
        .catch(error => console.warn('本地资源会话释放失败', error))
      localResourceReleases.delete(this)
      this.loaded = false
      this.error = null
      this.markImage = { byId: {}, allIds: [] }
      this.background = { byId: {}, allIds: [] }
      this.music = { byId: {}, allIds: [] }
      this.skillSound = { byId: {}, allIds: [] }
      this.petSwf = { byId: {}, allIds: [] }
      this.petSound = { byId: {}, allIds: [] }
    },

    async initialize(options?: { forceReload?: boolean }) {
      const forceReload = options?.forceReload === true
      if (this.loaded && !forceReload) return
      const scope = resourceScope(this)
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
            try {
              const presentations = new Map<string, ContentPresentation>()
              for (const kind of ['species', 'skills', 'marks'] as const)
                for (const row of captured.content[kind])
                  if (row.presentation) presentations.set(`${kind}:${row.id}`, row.presentation)
              this.applyLayerToState(this.buildResourceLayer(presentations, captured.resources))
              this.validateDataIntegrity()
            } catch (error) {
              await captured.release()
              throw error
            }
            this.loaded = true
            this.error = null
            const previous = localResourceReleases.get(this)
            localResourceReleases.set(this, captured.release)
            await previous?.().catch(error => console.warn('旧本地资源会话释放失败', error))
            return
          }
          if (hasPreparedWebEnvironment()) {
            const { content, resources } = await readPreparedWebCatalog(forceReload)
            if (!isCurrent()) return
            const presentations = new Map<string, ContentPresentation>()
            for (const kind of ['species', 'skills', 'marks'] as const)
              for (const row of content[kind])
                if (row.presentation) presentations.set(`${kind}:${row.id}`, row.presentation)
            this.applyLayerToState(this.buildResourceLayer(presentations, resources))
            this.validateDataIntegrity()
            this.loaded = true
            this.error = null
            return
          }
          const packRef = await resolveRuntimePackRef({ forceRefresh: forceReload })
          if (!isCurrent()) return
          applyRuntimeAssetBase(packRef)
          const packLoader = new PackMetadataLoader()
          const packResult = await packLoader.loadMetadata(packRef, {
            source: 'http',
            enforceLockfile: false,
            includeData: false,
            includeLocales: false,
          })

          if (!isCurrent()) return
          if ((packResult.assetConflicts?.length ?? 0) > 0) {
            console.warn('Asset conflicts detected while loading pack resources', packResult.assetConflicts)
          }
          if ((packResult.lockfileIssues?.length ?? 0) > 0) {
            console.warn('Pack lockfile issues detected while loading resources', packResult.lockfileIssues)
          }

          this.applyLayerToState(this.buildPresentationLayer(packResult.presentation ?? []))
          this.validateDataIntegrity()

          this.loaded = true
          this.error = null
          console.log('📁 Resource store installed')
        } catch (error) {
          if (!isCurrent()) return
          this.error = error instanceof Error ? error.message : '未知错误'
          this.loaded = false
          const isNetworkError =
            error instanceof TypeError ||
            String(error).includes('Failed to fetch') ||
            String(error).includes('NetworkError')
          if (isNetworkError) {
            console.warn('资源加载失败：服务器未响应，部分功能不可用')
          } else {
            console.error('❌ Resource initialization failed:', error)
          }
          throw error
        }
      })()
      let cancel!: () => void
      const cancelled = new Promise<void>((_resolve, reject) => {
        cancel = () => reject(new DOMException('Resource scope changed', 'AbortError'))
      })
      const entry = { ready: Promise.race([work, cancelled]), cancel }
      void entry.ready.catch(() => {})
      scope.pending = entry
      try {
        await entry.ready
      } finally {
        if (scope.pending === entry) scope.pending = undefined
      }
    },

    /** Consumers follow scope replacements; only this store owns cancellation. */
    async whenReady(): Promise<void> {
      for (;;) {
        const generation = resourceScope(this).generation
        try {
          await this.initialize()
          return
        } catch (error) {
          if (
            !(
              error instanceof DOMException &&
              error.name === 'AbortError' &&
              resourceScope(this).generation !== generation
            )
          )
            throw error
        }
      }
    },

    async reload() {
      await this.initialize({ forceReload: true })
    },

    applyLayerToState(layer: ResourceLayer) {
      this.markImage = this.normalizeRecordData(layer.markImage)
      this.background = this.normalizeRecordData(layer.background)
      this.music = this.normalizeRecordData(layer.music)
      this.skillSound = this.normalizeRecordData(layer.skillSound)
      this.petSwf = this.normalizeRecordData(layer.petSwf)
      this.petSound = this.normalizeRecordData(layer.petSound)
    },

    buildPresentationLayer(manifests: PresentationManifest[]): ResourceLayer {
      return this.buildResourceLayer(
        presentationIndex(manifests),
        manifests.flatMap(manifest => manifest.resources),
      )
    },

    buildResourceLayer(
      presentations: ReadonlyMap<string, ContentPresentation>,
      resources: PresentationManifest['resources'],
    ): ResourceLayer {
      const layer = createEmptyLayer()
      for (const [key, presentation] of presentations) {
        const separator = key.indexOf(':')
        const kind = key.slice(0, separator),
          id = key.slice(separator + 1)
        if (kind === 'species') {
          if (presentation.battle?.renderer === 'seer2-swf') layer.petSwf[id] = String(presentation.battle.source)
          if (presentation.cry) layer.petSound[id] = String(presentation.cry)
        } else if (kind === 'marks' && presentation.icon) layer.markImage[id] = String(presentation.icon)
        else if (kind === 'skills' && presentation.sfx) layer.skillSound[id] = String(presentation.sfx)
      }
      for (const resource of resources) {
        if (resource.tags?.includes('background')) layer.background[resource.id] = resource.source
        if (resource.tags?.includes('music')) layer.music[resource.id] = resource.source
      }
      return layer
    },

    normalizeRecordData(item: Record<string, string>) {
      return {
        byId: Object.fromEntries(Object.entries(item).map(([id, url]) => [id, officialAssetUrl(url)])),
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
  },
})
