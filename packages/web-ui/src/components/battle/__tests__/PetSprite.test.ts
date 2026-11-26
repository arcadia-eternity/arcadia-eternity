import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PetSprite from '../PetSprite.vue'
import { setServerContentText } from '@/i18n/serverContent'
import unknownPet from '@/assets/images/unknown-pet.svg'
import { createSwfPlayer } from '@/services/swf/adapter'
import { registerMediaEnvironment } from '@/services/mediaLoader'
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
vi.mock('@/services/resourceTransport', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/resourceTransport')>()),
  readResourceBytes: vi.fn(async () => new Uint8Array([70, 87, 83, 9, 8, 0, 0, 0])),
}))
beforeEach(() => {
  setServerContentText(null)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array([70, 87, 83, 9, 8, 0, 0, 0]))),
  )
  vi.clearAllMocks()
})
afterEach(() => {
  setServerContentText(null)
  vi.unstubAllGlobals()
})
describe('isolated PetSprite readiness', () => {
  it('waits for bounded bytes and player readiness', async () => {
    const sprite = mount(PetSprite, { props: { swfUrl: '/pet.swf' } })
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
    const sprite = mount(PetSprite, { props: { swfUrl: '/pet.swf', allowRecovery: false } })
    await flushPromises()
    pending.resolve?.(['待机'])
    await flushPromises()
    expect(sprite.vm.availableState).toEqual([])
    await sprite.setProps({ allowRecovery: true })
    expect(sprite.vm.availableState).toEqual(['待机'])
    sprite.unmount()
  })
  it('shows a ready switch-in before entry while the current task still locks recovery', async () => {
    const sprite = mount(PetSprite, { props: { swfUrl: '/outgoing.swf' } })
    await flushPromises()
    pending.resolve?.(['待机'])
    await sprite.vm.ready

    await sprite.setProps({ allowRecovery: false, swfUrl: '/incoming.swf' })
    await flushPromises()
    pending.resolve?.(['待机'])
    await sprite.vm.ready
    expect(sprite.find('[data-testid="pet-static-fallback"]').exists()).toBe(true)

    sprite.vm.activateLoadedSwf()
    await sprite.vm.$nextTick()
    expect(sprite.find('[data-testid="pet-static-fallback"]').exists()).toBe(false)
    expect(sprite.get<HTMLDivElement>('.pet-render').element.style.opacity).toBe('1')
    expect(sprite.vm.availableState).toEqual(['待机'])
    sprite.unmount()
  })
  it('is ready on its fallback image while the movie keeps loading', async () => {
    const sprite = mount(PetSprite, { props: { swfUrl: '/slow.swf', fallbackImageUrl: unknownPet } })
    await flushPromises()
    const movie = vi.fn()
    void sprite.vm.movieReady.then(movie)
    await sprite.get('img').trigger('load')
    await sprite.vm.ready
    expect(movie).not.toHaveBeenCalled()
    expect(sprite.find('[data-testid="pet-static-fallback"]').exists()).toBe(true)
    pending.resolve?.(['待机'])
    await flushPromises()
    expect(movie).toHaveBeenCalledOnce()
    expect(sprite.vm.availableState).toEqual(['待机'])
    sprite.unmount()
  })
  it('settles readiness when the fallback portrait fails before the movie', async () => {
    const sprite = mount(PetSprite, { props: { swfUrl: '/broken.swf', fallbackImageUrl: unknownPet } })
    await flushPromises()
    await sprite.get('img').trigger('error')
    const failed = expect(sprite.vm.ready).rejects.toThrow('精灵图片加载失败')
    pending.reject?.(new Error('broken SWF'))
    await failed
    sprite.vm.activateLoadedSwf()
    expect(sprite.vm.availableState).toEqual([])
    sprite.unmount()
  })
  it('ignores readiness from a disposed source', async () => {
    const sprite = mount(PetSprite, { props: { swfUrl: '/first.swf' } })
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
    const sprite = mount(PetSprite, { props: { swfUrl: '/pet.swf' } })
    await flushPromises()
    const failed = expect(sprite.vm.ready).rejects.toThrow('broken SWF')
    pending.reject?.(new Error('broken SWF'))
    await failed
    sprite.unmount()
  })
  it('image mode requests no SWF player or bytes', async () => {
    const sprite = mount(PetSprite, { props: { imageOnly: true } })
    await flushPromises()
    expect(createSwfPlayer).not.toHaveBeenCalled()
    expect(readResourceBytes).not.toHaveBeenCalled()
    await sprite.get('img').trigger('load')
    await sprite.vm.ready
    sprite.unmount()
  })
  it('keeps the loaded portrait ready when another catalog uses the same media scope', async () => {
    const original = { species: [], skills: [], marks: [] }
    const replacement = { species: [], skills: [], marks: [] }
    registerMediaEnvironment(original, 'same-environment-version')
    registerMediaEnvironment(replacement, 'same-environment-version')
    setServerContentText(original)
    const sprite = mount(PetSprite, { props: { imageOnly: true } })
    await sprite.get('img').trigger('load')
    const ready = sprite.vm.ready
    await ready

    setServerContentText(replacement)
    await flushPromises()
    expect(sprite.vm.ready).toBe(ready)
    sprite.unmount()
  })
  it('clears recovered states after a live player failure', async () => {
    const sprite = mount(PetSprite, { props: { swfUrl: '/pet.swf' } })
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

  it('uses the declared movie URL', async () => {
    const sprite = mount(PetSprite, { props: { swfUrl: '/remote.swf' } })
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
  const sprite = mount(PetSprite, { props: {} })
  await flushPromises()
  expect(createSwfPlayer).not.toHaveBeenCalled()
  expect(readResourceBytes).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  expect(sprite.get('img').attributes('src')).toBe(unknownPet)
  await sprite.get('img').trigger('load')
  await sprite.vm.ready
  sprite.unmount()
})
