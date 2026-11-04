import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

it('loads only the shipped locale during startup and keeps dynamic languages available', async () => {
  vi.resetModules()
  const requests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(url)
      return new Response(JSON.stringify({ title: '星域永恒' }), { status: 200 })
    }),
  )
  const { initI18n } = await import('../i18n')
  const { default: i18next } = await import('i18next')
  await initI18n()
  const namespaces = [
    'webui',
    'skill',
    'mark',
    'mark_ability',
    'mark_emblem',
    'mark_global',
    'species',
    'battle',
    'nature',
  ]
  expect(requests.sort()).toEqual(namespaces.map(namespace => `/locales/zh-CN/${namespace}.json`).sort())
  expect(i18next.t('title', { ns: 'webui' })).toBe('星域永恒')

  for (const namespace of namespaces) i18next.addResourceBundle('en', namespace, { title: 'Arcadia' })
  await i18next.changeLanguage('en')
  expect(i18next.language).toBe('en')
  expect(i18next.t('title', { ns: 'webui' })).toBe('Arcadia')
  expect(requests).toHaveLength(namespaces.length)
})
