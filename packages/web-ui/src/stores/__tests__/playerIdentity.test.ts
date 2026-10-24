import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore } from '../player'

vi.mock('../petStorage', () => ({ usePetStorageStore: () => ({ getCurrentTeam: () => [] }) }))

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('device-local profile', () => {
  it('initializes offline and keeps a legacy saved UID without consulting a server', async () => {
    localStorage.setItem('player', JSON.stringify({ id: 'existing-profile', name: 'Existing' }))
    const network = vi.spyOn(globalThis, 'fetch')
    const player = usePlayerStore()
    await player.initializePlayer()
    expect(player.id).toBe('existing-profile')
    expect(player.name).toBe('Existing')
    expect(network).not.toHaveBeenCalled()
    network.mockRestore()
  })

  it('initialization and nickname changes never rotate the UID', async () => {
    const player = usePlayerStore()
    await player.initializePlayer()
    const uid = player.id
    await player.initializePlayer()
    await player.setName('Updated')
    expect(player.id).toBe(uid)
    expect(JSON.parse(localStorage.getItem('player')!)).toEqual({ id: uid, name: 'Updated' })
  })

  it('keeps an already hydrated profile when an old backup is malformed', async () => {
    localStorage.setItem('player', 'invalid')
    const player = usePlayerStore()
    player.$patch({ id: 'persisted', name: 'Saved' })
    await player.initializePlayer()
    expect(player.id).toBe('persisted')
  })
})
