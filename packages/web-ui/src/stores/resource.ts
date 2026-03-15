// src/stores/Resource.ts
import { defineStore } from 'pinia'
import { GameDataLoader } from '@/utils/gameLoader'
import type { AssetManifest, MarkImageSchemaType } from '@arcadia-eternity/schema'
import { PackLoader } from '@arcadia-eternity/pack-loader'

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
    async initialize() {
      if (this.loaded) return
      const loader = new GameDataLoader({
        devBasePath: '/resource',
        prodBaseUrl: import.meta.env.VITE_API_BASE || '/resource',
      })
      const packLoader = new PackLoader()
      const packRef = `${import.meta.env.VITE_API_BASE || ''}/pack.json`

      try {
        // 并行加载所有数据
        const [rawMarkImage, rawBackGround, rawMusic, rawSkillSound, rawPetSwf, packResult] = await Promise.all([
          this.loadMarkImage(loader),
          this.loadBackGround(loader),
          this.loadMusic(loader),
          this.loadSkillSound(loader),
          this.loadPetSwf(loader),
          packLoader.load(packRef, {
            source: 'http',
            continueOnError: true,
            validateReferences: false,
            enforceLockfile: false,
          }),
        ])
        this.markImage = this.normalizeRecordData(rawMarkImage)
        this.background = this.normalizeRecordData(rawBackGround)
        this.music = this.normalizeRecordData(rawMusic)
        this.skillSound = this.normalizeRecordData(rawSkillSound)
        this.petSwf = this.normalizeRecordData(rawPetSwf)
        if (packResult.assets && packResult.assets.length > 0) {
          this.applyAssetManifests(packResult.assets)
        }
        if ((packResult.assetConflicts?.length ?? 0) > 0) {
          console.warn('Asset conflicts detected while loading pack resources', packResult.assetConflicts)
        }
        if ((packResult.lockfileIssues?.length ?? 0) > 0) {
          console.warn('Pack lockfile issues detected while loading resources', packResult.lockfileIssues)
        }

        // 验证数据完整性
        this.validateDataIntegrity()

        console.log('📁 Resource store installed')

        this.loaded = true
      } catch (error) {
        this.error = error instanceof Error ? error.message : '未知错误'
        console.error('❌ Resource initialization failed:', error)
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

    // 新增数据完整性检查
    validateDataIntegrity() {
      const validate = (data: { allIds: string[]; byId: Record<string, unknown> }, type: string) => {
        data.allIds.forEach(id => {
          if (!data.byId[id]) {
            throw new Error(`${type}数据不完整，缺失ID: ${id}`)
          }
        })
      }
    },

    async loadMarkImage(loader: GameDataLoader): Promise<MarkImageSchemaType> {
      const data = await loader.load<MarkImageSchemaType>('mark_image')
      return data
    },

    async loadBackGround(loader: GameDataLoader): Promise<any> {
      const data = await loader.load<any>('background')
      return data
    },

    async loadMusic(loader: GameDataLoader): Promise<any> {
      const data = await loader.load<any>('music')
      return data
    },

    async loadSkillSound(loader: GameDataLoader): Promise<any> {
      const data = await loader.load<any>('skill_sound')
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

    applyAssetManifests(manifests: AssetManifest[]) {
      const entries = manifests.flatMap(m => m.assets)
      const entryById = new Map(entries.map(entry => [entry.id, entry]))

      for (const manifest of manifests) {
        const speciesMap = manifest.mappings?.species ?? {}
        for (const [speciesId, assetId] of Object.entries(speciesMap)) {
          const entry = entryById.get(assetId)
          if (!entry) continue
          if (entry.type === 'petSwf') {
            this.petSwf.byId[speciesId] = entry.uri
          }
        }

        const markMap = manifest.mappings?.marks ?? {}
        for (const [markId, assetId] of Object.entries(markMap)) {
          const entry = entryById.get(assetId)
          if (!entry) continue
          if (entry.type === 'markIcon') {
            this.markImage.byId[markId] = entry.uri
          }
        }

        const skillMap = manifest.mappings?.skills ?? {}
        for (const [skillId, assetId] of Object.entries(skillMap)) {
          const entry = entryById.get(assetId)
          if (!entry) continue
          if (entry.type === 'skillSfx') {
            this.skillSound.byId[skillId] = entry.uri
          }
        }
      }

      for (const entry of entries) {
        if (entry.type === 'petSwf' && !this.petSwf.byId[entry.id]) {
          this.petSwf.byId[entry.id] = entry.uri
        }
        if (entry.type === 'petSfx') {
          const byPrefix = /^petSound:num:(\d+)$/.exec(entry.id)
          if (byPrefix?.[1]) {
            this.petSound.byId[byPrefix[1]] = entry.uri
          } else if (/^\d+$/.test(entry.id)) {
            this.petSound.byId[entry.id] = entry.uri
          }
        }
        if (entry.type === 'markIcon' && !this.markImage.byId[entry.id]) {
          this.markImage.byId[entry.id] = entry.uri
        }
        if (entry.type === 'skillSfx' && !this.skillSound.byId[entry.id]) {
          this.skillSound.byId[entry.id] = entry.uri
        }
        if (entry.type === 'uiImage' && !this.background.byId[entry.id]) {
          this.background.byId[entry.id] = entry.uri
        }
        if (entry.type === 'bgm' && !this.music.byId[entry.id]) {
          this.music.byId[entry.id] = entry.uri
        }
      }

      this.markImage.allIds = Object.keys(this.markImage.byId)
      this.background.allIds = Object.keys(this.background.byId)
      this.music.allIds = Object.keys(this.music.byId)
      this.skillSound.allIds = Object.keys(this.skillSound.byId)
      this.petSwf.allIds = Object.keys(this.petSwf.byId)
      this.petSound.allIds = Object.keys(this.petSound.byId)
    },
  },
})
