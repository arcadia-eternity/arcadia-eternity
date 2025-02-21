// src/stores/gameData.ts
import { defineStore } from 'pinia'
import { GameDataLoader } from '@/utils/gameLoader'
import type { Species, Skill, Mark, Effect } from '@test-battle/schema'

interface GameDataState {
  species: Record<string, Species>
  skills: Record<string, Skill>
  marks: Record<string, Mark>
  effects: Record<string, Effect>
  loaded: boolean
  error: string | null
}

export const useGameDataStore = defineStore('gameData', {
  state: (): GameDataState => ({
    species: {},
    skills: {},
    marks: {},
    effects: {},
    loaded: false,
    error: null,
  }),

  actions: {
    async initialize() {
      if (this.loaded) return

      const loader = new GameDataLoader({
        devBasePath: '/data', // Vite public目录下的data文件夹
        prodBaseUrl: import.meta.env.VITE_API_BASE || '',
      })

      try {
        const [species, skills, marks, effects] = await Promise.all([
          this.loadSpecies(loader),
          this.loadSkills(loader),
          this.loadMarks(loader),
          this.loadEffects(loader),
        ])

        this.species = this.mapById(species)
        this.skills = this.mapById(skills)
        this.marks = this.mapById(marks)
        this.effects = this.mapById(effects)
        this.loaded = true
      } catch (error) {
        this.error = error instanceof Error ? error.message : '未知错误'
        throw error
      }
    },

    async loadSpecies(loader: GameDataLoader): Promise<Species[]> {
      const data = await loader.load<Species>('species')
      return data
    },

    async loadSkills(loader: GameDataLoader): Promise<Skill[]> {
      const data = await loader.load<Skill>('skill')
      return data
    },

    async loadMarks(loader: GameDataLoader): Promise<Mark[]> {
      const data = await loader.load<Mark>('mark')
      const data1 = await loader.load<Mark>('mark_ability')
      const data2 = await loader.load<Mark>('mark_emblem')
      const data3 = await loader.load<Mark>('mark_global')
      return [...data, ...data1, ...data2, ...data3]
    },

    async loadEffects(loader: GameDataLoader): Promise<Effect[]> {
      const data = await loader.load<Effect>('effect')
      return data
    },

    mapById<T extends { id: string }>(items: T[]): Record<string, T> {
      return items.reduce(
        (acc, item) => {
          acc[item.id] = item
          return acc
        },
        {} as Record<string, T>,
      )
    },
  },

  getters: {
    getSpecies: state => (id: string) => state.species[id],
    getSkill: state => (id: string) => state.skills[id],
    getMark: state => (id: string) => state.marks[id],
    getEffect: state => (id: string) => state.effects[id],
  },
})
