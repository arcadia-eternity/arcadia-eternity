import i18next from 'i18next'
import Backend from 'i18next-chained-backend'
import httpBackend from 'i18next-http-backend'

let isInitialized = false

export async function initI18n(debug = false): Promise<void> {
  if (isInitialized) {
    return
  }
  isInitialized = true
  i18next.use(Backend)

  await i18next.init({
    debug: debug,
    lng: 'zh-CN',
    ns: ['webui', 'skill', 'mark', 'mark_ability', 'mark_emblem', 'mark_global', 'species', 'battle'],
    backend: {
      backends: [httpBackend],
      backendOptions: [
        {
          loadPath: '/locales/{{lng}}/{{ns}}.json',
        },
      ],
    },
  })
}
