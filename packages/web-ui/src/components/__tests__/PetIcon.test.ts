import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import PetIcon from '../PetIcon.vue'
import { setServerContentText } from '@/i18n/serverContent'
import unknownPet from '@/assets/images/unknown-pet.svg'

afterEach(() => {
  setServerContentText(null)
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it.each([
  ['1', 'https://seer2-resource.yuuinih.com/png/petIcon/3.png', 'official-assets/resource/png/petIcon/3.png'],
  ['', 'https://seer2-resource.yuuinih.com/png/petIcon/3.png', 'https://seer2-resource.yuuinih.com/png/petIcon/3.png'],
  ['1', 'https://creator.test/icon.png', 'https://creator.test/icon.png'],
])('resolves declared icons in static mode %s: %s', async (mode, source, expected) => {
  vi.stubEnv('VITE_STATIC_MODE', mode)
  vi.stubEnv('BASE_URL', './')
  const fetcher = vi.fn().mockRejectedValue(new Error('Stop after recording the requested URL'))
  vi.stubGlobal('fetch', fetcher)
  const icon = mount(PetIcon, { props: { id: 3, species: { id: 'pet_dilante', presentation: { icon: source } } } })
  await flushPromises()
  icon.unmount()
  expect(fetcher).toHaveBeenCalledWith(new URL(expected, document.baseURI).href, expect.any(Object))
})
it('uses a bundled placeholder rather than a same-number official icon for remote missing media', async () => {
  setServerContentText({ species: [], skills: [], marks: [] })
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const sources: string[] = []
  vi.stubGlobal(
    'Image',
    class {
      set src(value: string) {
        sources.push(value)
      }
      onload?: () => void
      onerror?: () => void
    },
  )
  const icon = mount(PetIcon, { props: { id: 1, species: { id: 'pet_dilan', num: 1 }, uncached: true } })
  await flushPromises()
  expect(sources).toEqual([unknownPet])
  expect(fetcher).not.toHaveBeenCalled()
  icon.unmount()
})
