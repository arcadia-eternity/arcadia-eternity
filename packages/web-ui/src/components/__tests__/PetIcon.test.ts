import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import PetIcon from '../PetIcon.vue'
import { setServerContentText } from '@/i18n/serverContent'
import unknownPet from '@/assets/images/unknown-pet.svg'

afterEach(() => {
  setServerContentText(null)
  vi.unstubAllGlobals()
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
