import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PetSprite from '../PetSprite.vue'
import { setServerContentText } from '@/i18n/serverContent'
import unknownPet from '@/assets/images/unknown-pet.svg'
import { createSwfPlayer } from '@/services/swf/adapter'
import { readResourceBytes } from '@/services/resourceTransport'
const pending = vi.hoisted(() => ({
  resolve: undefined as ((states: string[]) => void) | undefined,
  reject: undefined as ((error: Error) => void) | undefined,
  dispose: vi.fn(),
}))
vi.mock('seer2-pet-animator', () => ({ ActionState: { IDLE: '待机' } }))
vi.mock('@/services/swf/adapter', () => ({
  createSwfPlayer: vi.fn(() => ({
    load: () =>
      new Promise((yes, no) => {
        pending.resolve = yes
        pending.reject = no
      }),
    configure: vi.fn(),
    dispose: pending.dispose,
  })),
}))
vi.mock('@/services/resourceTransport', () => ({ readResourceBytes: vi.fn(async () => new Uint8Array([1, 2, 3])) }))
vi.mock('@/services/petResourceCache', () => ({
  petResourceCache: { getPetSwfUrl: vi.fn(async () => '/pet.swf'), getRemotePetUrl: vi.fn(() => '/remote.swf') },
}))
beforeEach(() => {
  setServerContentText(null)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
  )
  vi.clearAllMocks()
})
afterEach(() => {
  setServerContentText(null)
  vi.unstubAllGlobals()
})
describe('isolated PetSprite readiness', () => {
  it('waits for bounded bytes and player readiness', async () => {
    const sprite = mount(PetSprite, { props: { num: 1 } })
    await flushPromises()
    const ready = vi.fn()
    void sprite.vm.ready.then(ready)
    expect(createSwfPlayer).toHaveBeenCalledOnce()
    expect(ready).not.toHaveBeenCalled()
    pending.resolve?.(['待机'])
    await flushPromises()
    expect(ready).toHaveBeenCalledOnce()
    expect(sprite.vm.availableState).toEqual(['待机'])
    sprite.unmount()
    expect(pending.dispose).toHaveBeenCalled()
  })
  it('defers recovered states until the battle task ends', async () => {
    const sprite = mount(PetSprite, { props: { num: 1, allowRecovery: false } })
    await flushPromises()
    pending.resolve?.(['待机'])
    await flushPromises()
    expect(sprite.vm.availableState).toEqual([])
    await sprite.setProps({ allowRecovery: true })
    expect(sprite.vm.availableState).toEqual(['待机'])
    sprite.unmount()
  })
  it('ignores readiness from a disposed source', async () => {
    const sprite = mount(PetSprite, { props: { num: 1, swfUrl: '/first.swf' } })
    await flushPromises()
    const old = pending.resolve
    await sprite.setProps({ swfUrl: '/second.swf' })
    await flushPromises()
    const ready = vi.fn()
    void sprite.vm.ready.then(ready)
    old?.(['待机'])
    await flushPromises()
    expect(ready).not.toHaveBeenCalled()
    pending.resolve?.(['待机'])
    await flushPromises()
    expect(ready).toHaveBeenCalledOnce()
    sprite.unmount()
  })
  it('rejects a player failure', async () => {
    const sprite = mount(PetSprite, { props: { num: 1 } })
    await flushPromises()
    const failed = expect(sprite.vm.ready).rejects.toThrow('broken SWF')
    pending.reject?.(new Error('broken SWF'))
    await failed
    sprite.unmount()
  })
  it('image mode requests no SWF player or bytes', async () => {
    const sprite = mount(PetSprite, { props: { num: 1, imageOnly: true } })
    await flushPromises()
    expect(createSwfPlayer).not.toHaveBeenCalled()
    expect(readResourceBytes).not.toHaveBeenCalled()
    await sprite.get('img').trigger('load')
    await sprite.vm.ready
    sprite.unmount()
  })
  it('clears recovered states after a live player failure', async () => {
    const sprite = mount(PetSprite, { props: { num: 1 } })
    await flushPromises()
    pending.resolve?.(['待机'])
    await flushPromises()
    const callback = vi.mocked(createSwfPlayer).mock.calls[0]![1]
    callback({ v: 1, instance: 'fixture', task: 1, seq: 2, type: 'error', message: 'renderer failed' })
    await flushPromises()
    expect(sprite.vm.availableState).toEqual([])
    expect(sprite.find('[data-testid="pet-static-fallback"]').exists()).toBe(true)
    await sprite.setProps({ allowRecovery: false })
    await sprite.setProps({ allowRecovery: true })
    expect(sprite.vm.availableState).toEqual([])
    sprite.unmount()
  })

  it('uses server resource URL without desktop cache', async () => {
    const sprite = mount(PetSprite, { props: { num: 1, uncached: true } })
    await flushPromises()
    expect(readResourceBytes).toHaveBeenCalledWith(
      '/remote.swf',
      expect.objectContaining({ maxBytes: 16 * 1024 * 1024 }),
    )
    sprite.unmount()
  })
})

it('never loads a same-number official movie or portrait for remote missing optional media', async () => {
  setServerContentText({ species: [], skills: [], marks: [] })
  const sprite = mount(PetSprite, { props: { num: 1, uncached: true } })
  await flushPromises()
  expect(createSwfPlayer).not.toHaveBeenCalled()
  expect(readResourceBytes).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  expect(sprite.get('img').attributes('src')).toBe(unknownPet)
  await sprite.get('img').trigger('load')
  await sprite.vm.ready
  sprite.unmount()
})
