import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { usePlayerStore } from '../player'
import { usePetStorageStore } from '../petStorage'
import { useGameSettingStore } from '../gameSetting'
import { localStorageUnavailable, writeLocalData } from '@/services/localStorage'

let pinia: ReturnType<typeof createPinia>

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  localStorage.clear()
  localStorageUnavailable.value = false
  vi.useFakeTimers()
})

afterEach(() => {
  disposePinia(pinia)
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('local play when browser storage cannot persist', () => {
  it('keeps an in-memory profile, default team and settings when access is denied', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage is disabled', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is disabled', 'SecurityError')
    })
    const network = vi.spyOn(globalThis, 'fetch')
    const player = usePlayerStore()
    const pets = usePetStorageStore()
    const settings = useGameSettingStore()

    pets.loadFromLocal()
    await player.initializePlayer()
    settings.musicVolume = 0
    await vi.runAllTimersAsync()

    expect(player.isInitialized).toBe(true)
    expect(player.id).not.toBe('')
    expect(pets.initialized).toBe(true)
    expect(pets.getCurrentTeam().map(pet => pet.species)).toEqual(['pet_xiuluosi', 'pet_dilante', 'pet_laaoye'])
    expect(settings.musicVolume).toBe(0)
    expect(localStorageUnavailable.value).toBe(true)
    expect(network).not.toHaveBeenCalled()
  })

  it('preserves the saved team and keeps edits in memory when quota is exhausted', () => {
    const pets = usePetStorageStore()
    pets.loadFromLocal()
    const saved = localStorage.getItem('petStorage')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })

    pets.teams[0].name = 'Current session team'
    expect(pets.validateAndSave()).toBe(false)
    expect(pets.teams[0].name).toBe('Current session team')
    expect(localStorage.getItem('petStorage')).toBe(saved)
    expect(localStorageUnavailable.value).toBe(true)

    vi.restoreAllMocks()
    expect(writeLocalData('small-setting', '1')).toBe(true)
    expect(localStorageUnavailable.value).toBe(true)
  })
})
