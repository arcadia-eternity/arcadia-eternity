import i18next from 'i18next'
import Backend from 'i18next-chained-backend'
import httpBackend from 'i18next-http-backend'
import { serverContentText } from './serverContent'

let isInitialized = false

export async function initI18n(debug = false): Promise<void> {
  if (isInitialized) {
    return
  }
  isInitialized = true
  i18next.use(Backend).use(serverContentText)

  await i18next.init({
    debug: debug,
    postProcess: ['serverContentText'],
    lng: 'zh-CN',
    ns: ['webui', 'skill', 'mark', 'mark_ability', 'mark_emblem', 'mark_global', 'species', 'battle', 'nature'],
    backend: {
      backends: [httpBackend],
      backendOptions: [
        {
          loadPath: `${import.meta.env.BASE_URL}locales/{{lng}}/{{ns}}.json`,
        },
      ],
    },
  })
}
