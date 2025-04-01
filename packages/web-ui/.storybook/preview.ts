import type { Preview } from '@storybook/vue3'
import { setup } from '@storybook/vue3'
import { createPinia } from 'pinia'
import { initI18n } from '../src/i18n/i18n'
import { useGameDataStore } from '../src/stores/gameData'
import { useResourceStore } from '../src/stores/resource'
import '../src/styles.css'

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
}

setup(app => {
  initI18n()
  app.use(createPinia())
  const dataStore = useGameDataStore()
  const resourceStore = useResourceStore()
  Promise.all([dataStore.initialize(), resourceStore.initialize()])
})

export default preview
