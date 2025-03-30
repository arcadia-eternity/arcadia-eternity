import './styles.css'
import { createPinia } from 'pinia'
import { defineSetupVue3 } from '@histoire/plugin-vue'
import { initI18n } from './i18n/i18n'
import { useGameDataStore } from './stores/gameData'
import { useResourceStore } from './stores/resource'

export const setupVue3 = defineSetupVue3(async ({ app }) => {
  initI18n()
  app.use(createPinia())
  const dataStore = useGameDataStore()
  const resourceStore = useResourceStore()
  await Promise.all([dataStore.initialize(), resourceStore.initialize()])
})
