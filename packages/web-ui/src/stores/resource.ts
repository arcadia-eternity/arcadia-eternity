// src/stores/Resource.ts
import { defineStore } from 'pinia'
import { GameDataLoader } from '@/utils/gameLoader'
import type { MarkImageSchemaType } from '@arcadia-eternity/schema'

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
  },

  actions: {
    async initialize() {
      if (this.loaded) return
      const loader = new GameDataLoader({
        devBasePath: '/resource',
        prodBaseUrl: import.meta.env.VITE_API_BASE || '/resource',
      })

      try {
        // 并行加载所有数据
        const [rawMarkImage, rawBackGround, rawMusic, rawSkillSound] = await Promise.all([
          this.loadMarkImage(loader),
          this.loadBackGround(loader),
          this.loadMusic(loader),
          this.loadSkillSound(loader),
        ])
        this.markImage = this.normalizeRecordData(rawMarkImage)
        this.background = this.normalizeRecordData(rawBackGround)
        this.music = this.normalizeRecordData(rawMusic)
        this.skillSound = this.normalizeRecordData(rawSkillSound)

        // 验证数据完整性
        this.validateDataIntegrity()

        console.log('store installed')

        this.loaded = true
      } catch (error) {
        this.error = error instanceof Error ? error.message : '未知错误'
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
  },
})
