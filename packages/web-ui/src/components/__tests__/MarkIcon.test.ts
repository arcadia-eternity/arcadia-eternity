import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useGameDataStore } from '@/stores/gameData'
import MarkIcon from '../MarkIcon.vue'

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it.each(['status', 'ability', 'emblem'])(
  'uses declared %s mark icons and reloads on remount without a cache',
  async tag => {
    const source = `https://server.test/${tag}.png`
    useGameDataStore().applyServerEnvironment({
      species: [],
      skills: [],
      marks: [{ id: `demo:${tag}`, tags: [tag], presentation: { icon: source } }],
    })
    const request = vi.fn(async () => new Response('image'))
    vi.stubGlobal('fetch', request)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mark')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    expect(request).not.toHaveBeenCalled()
    for (let count = 1; count <= 2; count++) {
      const icon = mount(MarkIcon, { props: { markId: `demo:${tag}`, size: 32 } })
      await flushPromises()
      expect(icon.get('img').attributes('src')).toBe('blob:mark')
      expect(icon.get('img').attributes('style')).toContain('width: 32px')
      expect(request).toHaveBeenCalledTimes(count)
      expect(request).toHaveBeenLastCalledWith(
        source,
        expect.objectContaining({ cache: 'no-store', credentials: 'omit' }),
      )
      icon.unmount()
      expect(revoke).toHaveBeenCalledTimes(count)
    }
  },
)
