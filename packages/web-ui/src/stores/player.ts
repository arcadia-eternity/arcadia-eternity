// src/stores/player.ts
import { defineStore } from 'pinia'
import { z } from 'zod'
import { PlayerSchema, type Player } from '@test-battle/schema'
import { nanoid } from 'nanoid'
import { Nature } from '@test-battle/const'
import { usePetStorageStore } from './petStorage'
import { ref } from 'vue'

export const usePlayerStore = defineStore('player', {
  state: () => {
    const id = ref(nanoid())
    const name = ref(`训练师-${id.value}`)
    return { name, id }
  },

  actions: {
    saveToLocal() {
      localStorage.setItem(
        'player',
        JSON.stringify({
          id: this.id,
          name: this.name,
        }),
      )
    },

    loadFromLocal() {
      const saved = localStorage.getItem('player')
      if (saved) {
        Object.assign(this, JSON.parse(saved))
      }
    },

    setName(name: string) {
      this.name = name
    },

    generateNewId() {
      this.id = nanoid()
    },
  },

  getters: {
    name: state => state.name,
    id: state => state.id,
    player: (state): Player => {
      const petStorage = usePetStorageStore()
      const team = petStorage.getCurrentTeam()
      return {
        id: state.id,
        name: state.name,
        team,
      }
    },
  },
})
