import base from './playwright.config'

export default {
  ...base,
  use: {
    ...(base.use ?? {}),
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4176',
  },
  webServer: undefined,
}
