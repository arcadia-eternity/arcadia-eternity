import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActionState } from 'seer2-pet-animator'
import PetSprite from '../PetSprite.vue'

vi.mock('seer2-pet-animator', () => ({ ActionState: { IDLE: 'idle' } }))
vi.mock('@/services/petResourceCache', () => ({
  petResourceCache: { getPetSwfUrl: vi.fn(async () => '/pet.swf') },
}))

class DelayedPetRenderer extends HTMLElement {
  updateComplete = Promise.resolve(true)
  finish!: () => void
  fail!: (error: Error) => void
  callbacksReady = new Promise<void>((resolve, reject) => {
    this.finish = resolve
    this.fail = reject
  })
  async getAvailableStates() {
    await this.callbacksReady
    return [ActionState.IDLE]
  }
}
customElements.define('pet-render', DelayedPetRenderer)

afterEach(() => vi.useRealTimers())

describe('PetSprite readiness', () => {
  it('keeps readiness pending until the renderer callbacks finish, even on a slow load', async () => {
    vi.useFakeTimers()
    const sprite = mount(PetSprite, { props: { num: 1 } })
    try {
      await flushPromises()
      const ready = vi.fn()
      void sprite.vm.ready.then(ready)
      await vi.advanceTimersByTimeAsync(8000)
      expect(ready).not.toHaveBeenCalled()
      const renderer = sprite.get('pet-render').element as DelayedPetRenderer
      renderer.finish()
      await flushPromises()
      expect(ready).toHaveBeenCalledOnce()
      expect(sprite.vm.availableState).toEqual([ActionState.IDLE])
    } finally {
      sprite.unmount()
    }
  })

  it('waits for the custom image load callback before becoming ready', async () => {
    const sprite = mount(PetSprite, { props: { num: 0, imageUrl: '/custom.png' } })
    try {
      const ready = vi.fn()
      void sprite.vm.ready.then(ready)
      await flushPromises()
      expect(ready).not.toHaveBeenCalled()
      await sprite.get('img').trigger('load')
      await flushPromises()
      expect(ready).toHaveBeenCalledOnce()
    } finally {
      sprite.unmount()
    }
  })
  it('rejects a failed image instead of reporting readiness', async () => {
    const sprite = mount(PetSprite, { props: { num: 0, imageUrl: '/broken.png' } })
    const failure = expect(sprite.vm.ready).rejects.toThrow('精灵图片加载失败')
    await sprite.get('img').trigger('error')
    await failure
    sprite.unmount()
  })

  it('rejects a renderer failure instead of silently falling back to readiness', async () => {
    const sprite = mount(PetSprite, { props: { num: 1 } })
    await flushPromises()
    const failure = expect(sprite.vm.ready).rejects.toThrow('broken SWF')
    const renderer = sprite.get('pet-render').element as DelayedPetRenderer
    renderer.fail(new Error('broken SWF'))
    await flushPromises()
    await failure
    sprite.unmount()
  })

  it('ignores an old renderer callback after changing the source', async () => {
    const sprite = mount(PetSprite, { props: { num: 1, swfUrl: '/first.swf' } })
    await flushPromises()
    const oldRenderer = sprite.get('pet-render').element as DelayedPetRenderer
    await sprite.setProps({ swfUrl: '/second.swf' })
    await flushPromises()
    const ready = vi.fn()
    void sprite.vm.ready.then(ready)
    oldRenderer.finish()
    await flushPromises()
    expect(ready).not.toHaveBeenCalled()
    const newRenderer = sprite.get('pet-render').element as DelayedPetRenderer
    expect(newRenderer).not.toBe(oldRenderer)
    newRenderer.finish()
    await flushPromises()
    expect(ready).toHaveBeenCalledOnce()
    sprite.unmount()
  })
})
