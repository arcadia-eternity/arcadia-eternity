import { defineStore } from 'pinia'
import { toRaw } from 'vue'
import { type PlayerSchemaType } from '@arcadia-eternity/schema'
import { nanoid } from 'nanoid'
import { usePetStorageStore } from './petStorage'

/** Device-local game data. A profile ID is never a server credential. */
export const usePlayerStore = defineStore('player', {
  state: () => ({ id: '', name: '', isInitialized: false }),
  persist: { key: 'player-data', pick: ['id', 'name'] },
  actions: {
    saveToLocal() {
      localStorage.setItem('player', JSON.stringify({ id: this.id, name: this.name }))
    },
    loadFromLocal() {
      try {
        const saved = JSON.parse(localStorage.getItem('player') || 'null')
        if (saved && typeof saved.id === 'string' && saved.id && typeof saved.name === 'string') {
          this.id = saved.id
          this.name = saved.name
        }
      } catch {
        // Keep the persisted profile if the older backup format cannot be read.
      }
    },
    async initializePlayer() {
      if (this.isInitialized) return
      if (!this.id) this.loadFromLocal()
      if (!this.id) this.id = nanoid()
      if (!this.name) this.name = `游客-${this.id.slice(-4)}`
      this.isInitialized = true
      this.saveToLocal()
    },
    async setName(name: string) {
      const trimmed = name.trim()
      if (!trimmed || trimmed.length > 30) throw new Error('名称需要包含 1 至 30 个字符')
      this.name = trimmed
      this.saveToLocal()
    },
    generateNewId() {
      this.id = nanoid()
      this.name = `游客-${this.id.slice(-4)}`
      this.isInitialized = true
      this.saveToLocal()
    },
  },
  getters: {
    player: (state): PlayerSchemaType => ({
      id: state.id,
      name: state.name,
      team: usePetStorageStore()
        .getCurrentTeam()
        .map(pet => ({ ...toRaw(pet) })),
    }),
    canUseFeatures: state => state.isInitialized,
  },
})
