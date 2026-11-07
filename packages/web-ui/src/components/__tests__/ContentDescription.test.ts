import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, afterEach, expect, it } from 'vitest'
import i18next from 'i18next'
import I18NextVue from 'i18next-vue'
import { setServerContentText, serverContentText } from '@/i18n/serverContent'
import ContentDescription from '../ContentDescription'
import { useGameDataStore } from '@/stores/gameData'

beforeEach(async () => {
  setActivePinia(createPinia())
  if (!i18next.isInitialized) i18next.use(serverContentText)
  await i18next.init({ lng: 'zh-CN', resources: {}, postProcess: ['serverContentText'] })
})
afterEach(() => setServerContentText(null))

it.each([[], ['status'], ['exceptional'], ['xinzhiyinji_tag']].map(tags => ({ tags })))(
  'styles mark references from their own tags: $tags',
  ({ tags }) => {
    useGameDataStore().marks.byId['demo:mark'] = { id: 'demo:mark', tags }
    const wrapper = mount(ContentDescription, {
      global: {
        plugins: [[I18NextVue, { i18next }]],
        stubs: { Tooltip: { template: '<div><slot name="trigger" /></div>' } },
      },
      props: { namespace: 'skill', contentId: 'demo:skill', fallback: '<mark>demo:mark</mark>' },
    })
    try {
      const kind = tags.includes('status') || tags.includes('exceptional') ? 'status' : 'markName'
      expect(wrapper.get('[tabindex="0"]').attributes('data-description-kind')).toBe(kind)
    } finally {
      wrapper.unmount()
    }
  },
)

it('formats reactive public values and switches language while keeping official bundles untouched', async () => {
  setServerContentText({
    species: [],
    skills: [],
    marks: [],
    locales: {
      defaultLocale: 'zh-CN',
      bundles: {
        'zh-CN': { mark: { 'demo:shield': { name: '护盾', description: '抵挡 <shield>{stack}</shield> 点伤害' } } },
        en: { mark: { 'demo:shield': { name: 'Shield', description: 'Absorb <shield>{stack}</shield> damage' } } },
      },
    },
  })
  const wrapper = mount(ContentDescription, {
    global: { plugins: [[I18NextVue, { i18next }]] },
    props: { namespace: 'mark', contentId: 'demo:shield', context: { mark: { stack: 35 } } },
  })
  try {
    expect(wrapper.text()).toBe('抵挡 35 点伤害')
    expect(wrapper.get('span').classes()).toContain('text-cyan-400')
    await wrapper.setProps({ context: { mark: { stack: 12 } } })
    expect(wrapper.text()).toBe('抵挡 12 点伤害')
    await i18next.changeLanguage('en')
    await flushPromises()
    expect(wrapper.text()).toBe('Absorb 12 damage')
    await i18next.changeLanguage('fr')
    await flushPromises()
    expect(wrapper.text()).toBe('抵挡 12 点伤害')
    expect(i18next.getResource('zh-CN', 'mark', 'demo:shield')).toBeUndefined()
    setServerContentText(null)
    await flushPromises()
    expect(wrapper.text()).toBe('')
  } finally {
    wrapper.unmount()
  }
})

it.each(['locales', 'inline'])(
  'treats %s values as text and displays invalid templates without executable HTML',
  source => {
    const apply = (description: string) =>
      setServerContentText({
        species: [],
        skills: [],
        marks: source === 'inline' ? [{ id: 'demo:mark', description }] : [],
        ...(source === 'locales'
          ? { locales: { defaultLocale: 'zh-CN', bundles: { 'zh-CN': { mark: { 'demo:mark': { description } } } } } }
          : {}),
      })
    apply('<damage>{name}</damage>')
    const wrapper = mount(ContentDescription, {
      global: { plugins: [[I18NextVue, { i18next }]] },
      props: { namespace: 'mark', contentId: 'demo:mark', context: { name: '<img src=x onerror=bad()>' } },
    })
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toBe('<img src=x onerror=bad()>')
    wrapper.unmount()
    apply('<script>alert(1)</script>')
    const broken = mount(ContentDescription, {
      global: { plugins: [[I18NextVue, { i18next }]] },
      props: { namespace: 'mark', contentId: 'demo:mark' },
    })
    expect(broken.find('script').exists()).toBe(false)
    expect(broken.attributes('data-format-error')).toBe('true')
    broken.unmount()
  },
)
