import { defineStore } from 'pinia'
import { nanoid } from 'nanoid'
import { ElMessage } from 'element-plus'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import {
  MAX_STORED_TEAM_MEMBERS,
  canonical,
  expandTeam,
  migrateEmbeddedLibrary,
  newPersonalTeam,
  validateLibrary,
  type PersonalLibrary,
  type TeamSelection,
  type EnvironmentPreference,
  type PetOrigin,
} from '@arcadia-eternity/local-profile'
import { getDefaultTeam } from '@/services/defaultTeam'
import { readLocalData, writeLocalData } from '@/services/localStorage'

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const initialLibrary = () => migrateEmbeddedLibrary({ storage: [], teams: [getDefaultTeam()], currentTeamIndex: 0 })
interface LastMatchingConfig {
  teamId: string
  ruleSetId: string
  timestamp: number
}

export const usePetStorageStore = defineStore('petStorage', {
  state: () => ({
    library: initialLibrary(),
    initialized: false,
    loadFailed: false,
    lastMatchingConfig: null as LastMatchingConfig | null,
  }),
  getters: {
    storage: state => state.library.storage,
    currentTeamIndex: state => state.library.currentTeamIndex,
    teams: state => {
      const pets = new Map(
        state.library.storage.map(({ revision: _revision, origin: _origin, ...pet }) => [pet.id, pet]),
      )
      return state.library.teams.map(team => ({ ...team, pets: team.memberIds.map(id => pets.get(id)!) }))
    },
    currentTeam(): PetSchemaType[] {
      return this.teams[this.currentTeamIndex].pets
    },
  },
  actions: {
    loadFromLocal() {
      const saved = readLocalData('petStorage')
      this.loadFailed = false
      if (saved) {
        try {
          const data = JSON.parse(saved)
          let library
          if (data.version === undefined) {
            library = migrateEmbeddedLibrary({
              ...data,
              teams: data.teams.map((team: TeamSelection & { gameMode?: string }) => ({
                ...team,
                ruleSetId:
                  team.ruleSetId ||
                  (team.gameMode === 'competitive' ? 'competitive_ruleset' : 'casual_standard_ruleset'),
              })),
            })
          } else {
            const { lastMatchingConfig: _matching, ...stored } = data
            library = stored
          }
          this.library = validateLibrary(library)
          const last = data.lastMatchingConfig
          const teamId = last?.teamId ?? this.library.teams[last?.teamIndex]?.id
          this.lastMatchingConfig =
            last && teamId && this.library.teams.some(team => team.id === teamId)
              ? { teamId, ruleSetId: last.ruleSetId, timestamp: last.timestamp }
              : null
        } catch (error) {
          this.loadFailed = true
          this.initialized = false
          ElMessage.error(`无法读取仓库，原数据已保留：${String(error)}`)
          return
        }
      }
      this.initialized = true
      if (!saved) this.saveToLocal()
    },
    resetToDefault() {
      this.applyLibrary(initialLibrary())
    },
    applyLibrary(next: PersonalLibrary) {
      if (this.loadFailed) return false
      const snapshot = validateLibrary(copy(next))
      this.library = snapshot
      return this.saveToLocal()
    },
    saveToLocal() {
      if (this.loadFailed) return false
      try {
        const library = validateLibrary(copy(this.library))
        return writeLocalData('petStorage', JSON.stringify({ ...library, lastMatchingConfig: this.lastMatchingConfig }))
      } catch (error) {
        ElMessage.error(String(error))
        return false
      }
    },
    validateAndSave() {
      return this.saveToLocal()
    },
    clearStorage() {
      this.applyLibrary({
        version: 2,
        storage: [],
        teams: [newPersonalTeam('默认队伍', 'casual_standard_ruleset')],
        currentTeamIndex: 0,
      })
    },
    addToStorage(pet: PetSchemaType, origin?: PetOrigin) {
      const next = copy(this.library)
      next.storage.push({ ...copy(pet), ...(origin && { origin }), revision: 1 })
      return this.applyLibrary(next)
    },
    createNewTeam(name?: string, ruleSetId = 'casual_standard_ruleset', includeDefaultPets = true) {
      return this.importTeam({
        name: name || `队伍 ${this.teams.length + 1}`,
        ruleSetId,
        pets: includeDefaultPets ? getDefaultTeam().pets : [],
      })
    },
    importTeam(selection: TeamSelection) {
      const next = copy(this.library)
      const team = newPersonalTeam(selection.name, selection.ruleSetId)
      for (const pet of selection.pets) {
        const id = nanoid()
        next.storage.push({ ...copy(pet), id, revision: 1 })
        team.memberIds.push(id)
      }
      next.currentTeamIndex = next.teams.push(team) - 1
      return this.applyLibrary(next)
    },
    copyTeam(index: number) {
      const next = copy(this.library)
      const original = next.teams[index]
      if (!original) return false
      next.currentTeamIndex =
        next.teams.push({
          ...original,
          name: original.name + ' (副本)',
          id: nanoid(),
          revision: 1,
          memberIds: [...original.memberIds],
        }) - 1
      return this.applyLibrary(next)
    },
    renameTeam(index: number, name: string) {
      const next = copy(this.library)
      next.teams[index].name = name
      next.teams[index].revision++
      return this.applyLibrary(next)
    },
    switchTeam(index: number) {
      if (!this.library.teams[index]) return false
      this.library.currentTeamIndex = index
      return this.saveToLocal()
    },
    setEnvironmentPreference(index: number, preference?: EnvironmentPreference) {
      const next = copy(this.library)
      const team = next.teams[index]
      if (!team) return false
      if (preference) team.environmentPreference = preference
      else delete team.environmentPreference
      team.revision++
      return this.applyLibrary(next)
    },
    getCurrentTeamRuleSetId(): string {
      return this.teams[this.currentTeamIndex].ruleSetId
    },
    getTeamRuleSetId(index: number): string {
      return this.teams[index]?.ruleSetId ?? 'casual_standard_ruleset'
    },
    updateTeamRuleSetId(index: number, id: string) {
      const team = this.library.teams[index]
      if (team) {
        team.ruleSetId = id
        team.revision++
        this.saveToLocal()
      }
    },
    saveLastMatchingConfig(teamId: string, ruleSetId: string) {
      this.lastMatchingConfig = { teamId, ruleSetId, timestamp: Date.now() }
      this.saveToLocal()
    },
    getLastMatchingConfig() {
      if (this.lastMatchingConfig && Date.now() - this.lastMatchingConfig.timestamp > 7 * 86400000)
        this.clearLastMatchingConfig()
      return this.lastMatchingConfig
    },
    clearLastMatchingConfig() {
      this.lastMatchingConfig = null
      this.saveToLocal()
    },
    moveToTeam(petId: string, index: number) {
      const next = copy(this.library)
      const team = next.teams[index]
      if (
        !team ||
        team.memberIds.includes(petId) ||
        team.memberIds.length >= MAX_STORED_TEAM_MEMBERS ||
        !next.storage.some(pet => pet.id === petId)
      )
        return false
      team.memberIds.push(petId)
      team.revision++
      return this.applyLibrary(next)
    },
    replaceMember(teamId: string, current: string, replacement: string) {
      const next = copy(this.library)
      const team = next.teams.find(row => row.id === teamId)
      if (!team || team.memberIds.includes(replacement) || !next.storage.some(row => row.id === replacement))
        return false
      const index = team.memberIds.indexOf(current)
      if (index < 0) return false
      team.memberIds[index] = replacement
      team.revision++
      return this.applyLibrary(next)
    },
    moveToPC(petId: string, index?: number) {
      const next = copy(this.library)
      const team = next.teams[index ?? this.currentTeamIndex]
      if (!team?.memberIds.includes(petId)) return false
      team.memberIds = team.memberIds.filter(id => id !== petId)
      team.revision++
      return this.applyLibrary(next)
    },
    getCurrentTeam(): PetSchemaType[] {
      return expandTeam(copy(this.library), this.currentTeamIndex).pets
    },
    getTeam(index: number) {
      return this.teams[index]
    },
    affectedTeams(petId: string) {
      return this.library.teams.filter(team => team.memberIds.includes(petId))
    },
    updateTeamOrder(index: number, selections: PetSchemaType[], shared: 'copy' | 'original' = 'copy') {
      const next = copy(this.library)
      const team = next.teams[index]
      const ids = selections.map(pet => {
        const original = next.storage.find(row => row.id === pet.id)
        if (!original) {
          next.storage.push({ ...copy(pet), revision: 1 })
          return pet.id
        }
        const { revision, origin, ...before } = original
        if (canonical(before) === canonical(pet)) return pet.id
        if (shared === 'copy' && next.teams.some(other => other.id !== team.id && other.memberIds.includes(pet.id))) {
          const id = nanoid()
          next.storage.push({ ...copy(pet), ...(origin && { origin }), id, revision: 1 })
          return id
        }
        next.storage[next.storage.indexOf(original)] = {
          ...copy(pet),
          ...(origin && { origin }),
          revision: revision + 1,
        }
        return pet.id
      })
      if (canonical(team.memberIds) !== canonical(ids)) {
        team.memberIds = ids
        team.revision++
      }
      return this.applyLibrary(next)
    },
    updateTeam(index: number, pets: PetSchemaType[]) {
      return this.updateTeamOrder(index, pets)
    },
    deleteTeam(index: number) {
      const next = copy(this.library)
      if (next.teams.length <= 1 || !next.teams[index]) return false
      next.teams.splice(index, 1)
      if (index < next.currentTeamIndex) next.currentTeamIndex--
      next.currentTeamIndex = Math.min(next.currentTeamIndex, next.teams.length - 1)
      return this.applyLibrary(next)
    },
    removeFromStorage(id: string) {
      if (this.affectedTeams(id).length) return false
      const next = copy(this.library)
      next.storage = next.storage.filter(pet => pet.id !== id)
      return this.applyLibrary(next)
    },
  },
})
