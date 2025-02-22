// src/stores/petStorage.ts
import { defineStore } from 'pinia'
import { nanoid } from 'nanoid'
import type { Pet } from '@test-battle/schema'

interface PetStorageState {
  pc: Pet[]
  teams: Pet[][]
  currentTeamIndex: number
}

export const usePetStorageStore = defineStore('petStorage', {
  state: (): PetStorageState => ({
    pc: [],
    teams: [[]],
    currentTeamIndex: 0,
  }),

  actions: {
    loadFromLocal() {
      const saved = localStorage.getItem('petStorage')
      if (saved) {
        Object.assign(this, JSON.parse(saved))
      }
    },

    saveToLocal() {
      localStorage.setItem(
        'petStorage',
        JSON.stringify({
          pc: this.pc,
          teams: this.teams,
          currentTeamIndex: this.currentTeamIndex,
        }),
      )
    },

    clearStorage() {
      this.pc = []
      this.teams = [[]]
      this.currentTeamIndex = 0
      this.saveToLocal()
    },

    updateTeamOrder(teamIndex: number, newOrder: Pet[]) {
      this.teams[teamIndex] = newOrder
      this.saveToLocal()
    },

    // 其他方法保持原有逻辑，移除playerId参数
    addToStorage(pet: Pet) {
      this.pc.push(pet)
      this.saveToLocal()
    },

    createNewTeam() {
      this.teams.push([])
      this.saveToLocal()
    },

    switchTeam(index: number) {
      if (index >= 0 && index < this.teams.length) {
        this.currentTeamIndex = index
        this.saveToLocal()
      }
    },

    moveToTeam(petId: string, targetTeamIndex: number) {
      // 从所有队伍中移除
      this.teams.forEach(team => {
        const index = team.findIndex(p => p.id === petId)
        if (index > -1) team.splice(index, 1)
      })

      // 添加到目标队伍
      if (this.teams[targetTeamIndex].length < 6) {
        const pet = this.pc.find(p => p.id === petId) || this.teams.flat().find(p => p.id === petId)
        if (pet) {
          this.teams[targetTeamIndex].push(pet)
        }
      }

      this.saveToLocal()
    },

    getCurrentTeam(): Pet[] {
      return this.teams[this.currentTeamIndex]
    },

    moveToPC(petId: string) {
      this.teams.forEach(team => {
        const index = team.findIndex(p => p.id === petId)
        if (index > -1) {
          const [removedPet] = team.splice(index, 1)
          // 添加到仓库（如果不存在）
          if (!this.pc.some(p => p.id === petId)) {
            this.pc.push(removedPet)
          }
        }
      })
    },

    removeFromStorage(petId: string) {
      this.teams.forEach(team => {
        const index = team.findIndex(p => p.id === petId)
        if (index > -1) team.splice(index, 1)
      })
      this.pc = this.pc.filter(v => v.id !== petId)
    },
  },
})
