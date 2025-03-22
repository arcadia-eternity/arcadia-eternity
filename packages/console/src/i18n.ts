import i18next from 'i18next'
import Backend from 'i18next-chained-backend'
import fsBackend from 'i18next-fs-backend'

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
    ns: ['skill', 'mark', 'mark_ability', 'mark_emblem', 'species'],
    backend: {
      backends: [fsBackend],
      backendOptions: [
        {
          loadPath: './locales/{{lng}}/{{ns}}.yaml',
          addPath: './locales/{{lng}}/{{ns}}.missing.yaml',
        },
      ],
    },
  })
}
