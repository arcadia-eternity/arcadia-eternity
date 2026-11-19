import { resolveEnvironmentTeam } from '@arcadia-eternity/const'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { PetSchemaType, LearnableSkill } from '@arcadia-eternity/schema'
import { useGameDataStore } from '@/stores/gameData'
import { memberIssues, teamIssues, type TeamIssue } from '@/utils/basicTeamValidation'

interface ValidationError {
  type: string
  code: string
  message: string
  objectId?: string
  objectType?: string
  context?: Record<string, unknown>
}
export interface ValidationResult {
  isValid: boolean
  errors: ValidationError[]
  warnings: ValidationError[]
}

export const useValidationStore = defineStore('validation', () => {
  const isInitialized = ref(false)
  const isLoading = ref(false)
  const initialize = async () => {
    isInitialized.value = true
  }
  function result(issues: TeamIssue[]): ValidationResult {
    const errors = issues.map(issue => ({ type: 'validation', code: 'INVALID_TEAM', ...issue }))
    return { isValid: errors.length === 0, errors, warnings: [] }
  }
  const validateTeam = (team: PetSchemaType[]) => result(teamIssues(team, useGameDataStore()))
  const validatePet = (pet: PetSchemaType) => result(memberIssues(pet, useGameDataStore()))
  const getAllowedGendersForSpecies = async (id: string): Promise<string[]> => {
    const species = useGameDataStore().getSpecies(id)
    if (!species) return ['Male', 'Female', 'NoGender']
    if (!species.genderRatio || species.genderRatio.every(ratio => ratio <= 0)) return ['NoGender']
    return [species.genderRatio[0] > 0 && 'Female', species.genderRatio[1] > 0 && 'Male'].filter(Boolean) as string[]
  }
  const getRuleLimitations = () => {
    const { minSize, maxSize } = resolveEnvironmentTeam(useGameDataStore().rules)
    return { teamSize: { min: minSize, max: maxSize } }
  }
  const canAddMorePets = (team: PetSchemaType[]) => team.length < getRuleLimitations().teamSize.max
  const getSpeciesExtraLearnableSkills = async (_id: string): Promise<LearnableSkill[]> => []
  return {
    isInitialized,
    isLoading,
    initialize,
    validateTeam,
    validatePet,
    getAllowedGendersForSpecies,
    canAddMorePets,
    getRuleLimitations,
    getSpeciesExtraLearnableSkills,
  }
})
