import { readSharedTeam } from '@arcadia-eternity/local-profile'
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

    pets.renameTeam(0, 'Current session team')
    expect(pets.validateAndSave()).toBe(false)
    expect(pets.teams[0].name).toBe('Current session team')
    expect(localStorage.getItem('petStorage')).toBe(saved)
    expect(localStorageUnavailable.value).toBe(true)

    vi.restoreAllMocks()
    expect(writeLocalData('small-setting', '1')).toBe(true)
    expect(localStorageUnavailable.value).toBe(true)
  })
})

it('keeps shared builds and source-specific environment preferences independent', () => {
  const pets = usePetStorageStore()
  pets.loadFromLocal()
  const source = pets.library.teams[0]
  pets.copyTeam(0)
  pets.setEnvironmentPreference(1, { source: 'server:example', environmentId: 'test' })
  expect(pets.library.teams[0].environmentPreference).toBeUndefined()
  expect(pets.library.teams[1].memberIds).toEqual(source.memberIds)
  const builds = pets.getCurrentTeam()
  builds[0].ivs.hp = 120
  pets.updateTeamOrder(1, builds)
  expect(pets.storage).toHaveLength(4)
  expect(pets.library.teams[1].memberIds[0]).not.toBe(source.memberIds[0])
  expect(pets.teams[0].pets[0].ivs.hp).toBe(31)
  pets.loadFromLocal()
  expect(pets.getCurrentTeam()[0].ivs.hp).toBe(120)
  expect(pets.library.teams[1].environmentPreference).toEqual({ source: 'server:example', environmentId: 'test' })
})

it('remembers the outgoing scale of an older team once, including a custom environment cap', () => {
  const store = usePetStorageStore()
  store.loadFromLocal()
  const old = store.getCurrentTeam()[0]
  delete old.ivMax
  old.ivs.atk = 29
  store.importTeam({ name: '旧队伍', pets: [old], ruleSetId: 'casual_standard_ruleset' })
  store.setEnvironmentPreference(store.currentTeamIndex, { source: 'web', environmentId: 'classic' }, 60)
  store.loadFromLocal()
  store.setEnvironmentPreference(store.currentTeamIndex, undefined, 31)
  expect(store.getCurrentTeam()[0]).toMatchObject({ ivs: { atk: 29 }, ivMax: { atk: 60 } })
})

it('keeps a private room source hint across reload and copying without attaching it to battle selections', () => {
  const store = usePetStorageStore()
  store.loadFromLocal()
  const origin = { name: '好友冰系环境', version: 'a'.repeat(64) }
  const original = store.getCurrentTeam()[0]
  const imported = readSharedTeam(
    {
      version: 2,
      name: '个人约战队',
      pets: [
        {
          ...original,
          origin,
          inheritedSkill: 'lost:ice',
          ivs: { ...original.ivs, hp: 120 },
        },
      ],
    },
    '队伍',
  )
  expect(store.importTeam(imported)).toBe(true)
  const index = store.currentTeamIndex
  store.loadFromLocal()
  const id = store.library.teams[index].memberIds[0]
  expect(store.storage.find(pet => pet.id === id)).toMatchObject({
    origin,
    inheritedSkill: 'lost:ice',
    ivs: { hp: 120 },
  })
  expect(store.getCurrentTeam()[0]).not.toHaveProperty('origin')
  expect(store.getTeam(index).pets[0]).not.toHaveProperty('origin')
  store.copyTeam(index)
  const next = store.currentTeamIndex
  const draft = store.getCurrentTeam()
  draft[0].name = '另一个配法'
  store.updateTeamOrder(next, draft)
  const copyId = store.library.teams[next].memberIds[0]
  expect(copyId).not.toBe(id)
  expect(store.storage.find(pet => pet.id === copyId)?.origin).toEqual(origin)
  expect(store.replaceMember(store.library.teams[next].id, copyId, id)).toBe(true)
  expect(store.storage.find(pet => pet.id === copyId)?.origin).toEqual(origin)
  expect(store.affectedTeams(id).map(team => team.id)).toEqual([
    store.library.teams[index].id,
    store.library.teams[next].id,
  ])
  expect(() =>
    readSharedTeam({ pets: [{ ...original, origin: { ...origin, url: 'https://example.org/private' } }] }, '队伍'),
  ).toThrow('来源信息无效')
})
