import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref, Transition } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { registerMediaEnvironment } from '@/services/mediaLoader'
import { setServerContentText } from '@/i18n/serverContent'
import DamageDisplay from '@/components/battle/DamageDisplay.vue'
import { useMediaImage } from '../useMediaImage'

function png() {
  const image = new Uint8Array(24)
  image.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  image.set([73, 72, 68, 82], 12)
  new DataView(image.buffer).setUint32(16, 1)
  new DataView(image.buffer).setUint32(20, 1)
  return image
}

afterEach(() => {
  setServerContentText(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
it('loads only a mounted consumer and releases its object URL on source change/unmount', async () => {
  const image = png()
  const fetcher = vi.fn(async () => new Response(image))
  vi.stubGlobal('fetch', fetcher)
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const Consumer = defineComponent({
    props: { src: { type: String, required: true } },
    setup(props) {
      const { url } = useMediaImage(() => props.src)
      return () => h('img', { src: url.value })
    },
  })
  expect(fetcher).not.toHaveBeenCalled()
  const wrapper = mount(Consumer, { props: { src: 'https://assets.test/a.png' } })
  await flushPromises()
  expect(wrapper.attributes('src')).toBe('blob:first')
  expect(fetcher).toHaveBeenCalledWith(
    'https://assets.test/a.png',
    expect.objectContaining({ cache: 'default', credentials: 'omit' }),
  )
  await wrapper.setProps({ src: 'https://assets.test/b.png' })
  await flushPromises()
  expect(revoke).toHaveBeenCalledWith('blob:first')
  expect(wrapper.attributes('src')).toBe('blob:second')
  wrapper.unmount()
  expect(revoke).toHaveBeenCalledWith('blob:second')
  expect(create).toHaveBeenCalledTimes(2)
})

it('keeps the loaded media valid while an ancestor leave transition retains its DOM', async () => {
  const image = png()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(image)),
  )
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:leaving-image')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const Consumer = defineComponent({
    setup() {
      const { url } = useMediaImage(() => 'https://assets.test/pet.png')
      return () => h('img', { src: url.value })
    },
  })
  const visible = ref(true)
  let finishLeave: (() => void) | undefined
  const Parent = defineComponent({
    setup: () => () =>
      h(
        Transition,
        {
          css: false,
          onLeave: (_element: Element, done: () => void) => {
            finishLeave = done
          },
        },
        { default: () => (visible.value ? h('section', [h(Consumer)]) : undefined) },
      ),
  })
  const wrapper = mount(Parent, { attachTo: document.body, global: { stubs: { transition: false } } })
  try {
    await flushPromises()
    const element = wrapper.find('img').element
    expect(element.getAttribute('src')).toBe('blob:leaving-image')
    visible.value = false
    await flushPromises()
    expect(finishLeave).toBeTypeOf('function')
    expect(element.isConnected).toBe(true)
    expect(revoke).not.toHaveBeenCalled()
    finishLeave!()
    await flushPromises()
    expect(element.isConnected).toBe(false)
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:leaving-image')
  } finally {
    finishLeave?.()
    wrapper.unmount()
  }
})

it('uses one read for repeated damage digits and releases each rendered image', async () => {
  const catalog = { species: [], skills: [], marks: [] }
  registerMediaEnvironment(
    catalog,
    'custom-damage',
    ['damage:normal', 'digit:minus', 'digit:2'].map(id => ({
      id,
      source: 'https://pack.test/art/' + id,
      tags: ['battle-ui:' + id],
    })),
  )
  setServerContentText(catalog)
  const fetcher = vi.fn(async () => new Response(png()))
  vi.stubGlobal('fetch', fetcher)
  let sequence = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:damage-' + ++sequence)
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const display = mount(DamageDisplay, { props: { value: 22 } })
  await flushPromises()
  const images = display.findAll('img')
  expect(images.map(image => image.attributes('alt'))).toEqual(['damage background', 'minus', 'digit 2', 'digit 2'])
  expect(images.every(image => image.attributes('src')?.startsWith('blob:damage-'))).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(3)
  display.unmount()
  expect(revoke).toHaveBeenCalledTimes(4)
})
