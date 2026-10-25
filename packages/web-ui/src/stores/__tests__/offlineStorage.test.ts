import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createApp } from 'vue'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { usePlayerStore } from '../player'
import { usePetStorageStore } from '../petStorage'
import { useGameSettingStore } from '../gameSetting'
import { localDataStorage, localStorageUnavailable, writeLocalData } from '@/services/localStorage'

let pinia: ReturnType<typeof createPinia>

beforeEach(() => {
  pinia = createPinia()
  pinia.use(createPersistedState({ storage: localDataStorage }))
  createApp({}).use(pinia)
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
  it('creates a persisted player store when the browser denies the storage getter itself', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage is disabled', 'SecurityError')
    })

    const player = usePlayerStore()
    await player.initializePlayer()
    await player.setName('Memory profile')
    player.$persist()

    expect(player.isInitialized).toBe(true)
    expect(player.id).not.toBe('')
    expect(player.name).toBe('Memory profile')
    expect(localStorageUnavailable.value).toBe(true)
  })

  it('hydrates and persists the existing player-data profile through the real plugin', async () => {
    localStorage.setItem('player-data', JSON.stringify({ id: 'saved-profile', name: 'Saved' }))
    const player = usePlayerStore()
    await player.initializePlayer()
    await player.setName('Updated')

    expect(player.id).toBe('saved-profile')
    expect(JSON.parse(localStorage.getItem('player-data')!)).toEqual({ id: 'saved-profile', name: 'Updated' })
    expect(localStorageUnavailable.value).toBe(false)
  })

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
