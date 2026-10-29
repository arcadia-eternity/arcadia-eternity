import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { useUncachedResource } from '../useUncachedResource'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
it('loads only a mounted consumer, bypasses caches and releases its bytes on source change/unmount', async () => {
  const image = new Uint8Array(24)
  image.set([137, 80, 78, 71], 0)
  image.set([73, 72, 68, 82], 12)
  new DataView(image.buffer).setUint32(16, 1)
  new DataView(image.buffer).setUint32(20, 1)
  const fetcher = vi.fn(async () => new Response(image))
  vi.stubGlobal('fetch', fetcher)
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const Consumer = defineComponent({
    props: { src: { type: String, required: true } },
    setup(props) {
      const { url } = useUncachedResource(
        () => props.src,
        () => true,
      )
      return () => h('img', { src: url.value })
    },
  })
  expect(fetcher).not.toHaveBeenCalled()
  const wrapper = mount(Consumer, { props: { src: 'https://assets.test/a.png' } })
  await flushPromises()
  expect(wrapper.attributes('src')).toBe('blob:first')
  expect(fetcher).toHaveBeenCalledWith(
    'https://assets.test/a.png',
    expect.objectContaining({ cache: 'no-store', credentials: 'omit' }),
  )
  await wrapper.setProps({ src: 'https://assets.test/b.png' })
  await flushPromises()
  expect(revoke).toHaveBeenCalledWith('blob:first')
  expect(wrapper.attributes('src')).toBe('blob:second')
  wrapper.unmount()
  expect(revoke).toHaveBeenCalledWith('blob:second')
  expect(create).toHaveBeenCalledTimes(2)
})
