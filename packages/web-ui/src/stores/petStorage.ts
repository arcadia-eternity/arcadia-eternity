// src/stores/petStorage.ts
import { defineStore } from 'pinia'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import { Gender, NatureMap, Nature } from '@arcadia-eternity/const'
import { nanoid } from 'nanoid'

interface Team {
  name: string
  pets: PetSchemaType[]
}

interface PetStorageState {
  storage: PetSchemaType[]
  teams: Team[]
  currentTeamIndex: number
}

export const usePetStorageStore = defineStore('petStorage', {
  state: (): PetStorageState => ({
    storage: [],
    teams: [
      {
        name: '默认队伍',
        pets: [
          {
            id: (() => nanoid())(),
            name: '迪兰特',
            species: 'pet_dilante',
            level: 100,
            evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
            ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
            skills: [],
            gender: Gender.Male,
            nature: Nature.Adamant,
            ability: 'mark_ability_zhongjie',
            emblem: 'mark_emblem_zhuiji',
          },
        ],
      },
    ],
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
          storage: this.storage,
          teams: this.teams,
          currentTeamIndex: this.currentTeamIndex,
        }),
      )
    },

    clearStorage() {
      this.storage = []
      this.teams = []
      this.currentTeamIndex = 0
      this.createNewTeam()
      this.saveToLocal()
    },

    updateTeamOrder(teamIndex: number, newOrder: PetSchemaType[]) {
      this.teams[teamIndex].pets = newOrder
      this.saveToLocal()
    },

    // 其他方法保持原有逻辑，移除playerId参数
    addToStorage(pet: PetSchemaType) {
      this.storage.push(pet)
      this.saveToLocal()
    },

    createNewTeam(name?: string) {
      const teamName = name || `队伍 ${this.teams.length + 1}`
      this.teams.push({
        name: teamName,
        pets: [],
      })
      this.currentTeamIndex = this.teams.length - 1
      this.saveToLocal()
    },

    switchTeam(index: number) {
      if (index >= 0 && index < this.teams.length) {
        this.currentTeamIndex = index
        this.saveToLocal()
        return true
      }
      return false
    },

    moveToTeam(petId: string, targetTeamIndex: number) {
      let pet = undefined
      this.teams.forEach(team => {
        const index = team.pets.findIndex(p => p.id === petId)
        if (index > -1) {
          pet = team.pets[index]
          team.pets.splice(index, 1)
        }
      })

      // 添加到目标队伍
      if (this.teams[targetTeamIndex].pets.length < 6) {
        pet = pet ? pet : this.storage.find(p => p.id === petId)
        if (pet) {
          this.teams[targetTeamIndex].pets.push(pet)
        }
      }

      const index = this.storage.findIndex(p => p.id === petId)
      if (index > -1) this.storage.splice(index, 1)

      this.saveToLocal()
    },

    getCurrentTeam(): PetSchemaType[] {
      return this.teams[this.currentTeamIndex].pets
    },

    moveToPC(petId: string) {
      this.teams.forEach(team => {
        const index = team.pets.findIndex(p => p.id === petId)
        if (index > -1) {
          const [removedPet] = team.pets.splice(index, 1)
          // 添加到仓库（如果不存在）
          if (!this.storage.some(p => p.id === petId)) {
            this.storage.push(removedPet)
          }
        }
      })
      this.saveToLocal()
    },

    updateTeam(index: number, newTeam: PetSchemaType[]) {
      this.teams[index].pets = newTeam
    },

    deleteTeam(index: number) {
      if (this.teams.length <= 1) return
      this.teams.splice(index, 1)
      this.currentTeamIndex = Math.min(this.currentTeamIndex, this.teams.length - 1)
    },

    getTeam(index: number) {
      return this.teams[index] || []
    },

    removeFromStorage(petId: string) {
      this.teams.forEach(team => {
        const index = team.pets.findIndex(p => p.id === petId)
        if (index > -1) team.pets.splice(index, 1)
      })
      const index = this.storage.findIndex(p => p.id === petId)
      if (index > -1) this.storage.splice(index, 1)
    },
  },
  getters: {
    currentTeam(): PetSchemaType[] {
      return this.teams[this.currentTeamIndex].pets
    },
  },
})
