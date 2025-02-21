// stores/pokemon.ts
import { defineStore } from 'pinia'
import { type Pet } from '@test-battle/schema'

export const usePetStore = defineStore('pokemon', {
  state: () => ({
    team: [] as Pet[],
  }),
  actions: {
    saveTeam(team: Pet[]) {
      this.team = team
      localStorage.setItem('pokemonTeam', JSON.stringify(team))
    },
    loadTeam() {
      const saved = localStorage.getItem('pokemonTeam')
      if (saved) this.team = JSON.parse(saved)
    },
  },
})
