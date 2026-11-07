import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { PetSchemaType, LearnableSkill } from '@arcadia-eternity/schema'
import { useGameDataStore } from '@/stores/gameData'
import { validateBasicTeam } from '@/utils/basicTeamValidation'

export interface ValidationError {
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
  const check = (team: PetSchemaType[]): ValidationResult => {
    const data = useGameDataStore()
    const errors = validateBasicTeam(team, data.loaded ? data : undefined).map(message => ({
      type: 'validation',
      code: 'INVALID_TEAM',
      message,
    }))
    return { isValid: errors.length === 0, errors, warnings: [] }
  }
  const validateTeam = async (team: PetSchemaType[]) => check(team)
  const validatePet = async (pet: PetSchemaType, _team: PetSchemaType[]) => check([pet])
  const getAllowedGendersForSpecies = async (id: string): Promise<string[]> => {
    const species = useGameDataStore().getSpecies(id)
    if (!species) return ['Male', 'Female', 'NoGender']
    if (!species.genderRatio || species.genderRatio.every(ratio => ratio <= 0)) return ['NoGender']
    return [species.genderRatio[0] > 0 && 'Female', species.genderRatio[1] > 0 && 'Male'].filter(Boolean) as string[]
  }
  const canAddMorePets = async (team: PetSchemaType[]) => team.length < 6
  const getRuleLimitations = async () => ({ teamSize: { min: 1, max: 6 } })
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
