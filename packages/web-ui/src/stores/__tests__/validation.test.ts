import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useValidationStore } from '../validation'

const data = vi.hoisted(() => ({ loaded: false, getSpecies: vi.fn(), getSkill: vi.fn(), getMark: vi.fn() }))
vi.mock('@/stores/gameData', () => ({ useGameDataStore: () => data }))

describe('basic team validation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    data.getSpecies.mockReset()
  })
  it('rejects empty teams and prevents adding beyond six pets', async () => {
    const store = useValidationStore()
    await store.initialize()
    expect((await store.validateTeam([])).isValid).toBe(false)
    expect(await store.canAddMorePets(Array(6).fill({}))).toBe(false)
  })
  it('offers genders supported by the selected species', async () => {
    const store = useValidationStore()
    data.getSpecies.mockReturnValue({ genderRatio: [1, 0] })
    expect(await store.getAllowedGendersForSpecies('female')).toEqual(['Female'])
    data.getSpecies.mockReturnValue({ genderRatio: [0, 0] })
    expect(await store.getAllowedGendersForSpecies('genderless')).toEqual(['NoGender'])
  })
})
