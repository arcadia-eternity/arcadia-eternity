import i18next, { type Resource } from 'i18next'
import Backend from 'i18next-chained-backend'
import fsBackend from 'i18next-fs-backend'

let isInitialized = false

export async function initI18n(debug = false, resources?: Record<string, Record<string, unknown>>): Promise<void> {
  if (isInitialized) {
    return
  }
  isInitialized = true
  i18next.use(Backend)

  await i18next.init({
    debug: debug,
    resources: resources as Resource | undefined,
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
