import './styles.css'
import { createPinia } from 'pinia'
import { defineSetupVue3 } from '@histoire/plugin-vue'
import { initI18n } from './i18n/i18n'

export const setupVue3 = defineSetupVue3(({ app }) => {
  initI18n()
  app.use(createPinia())
})
