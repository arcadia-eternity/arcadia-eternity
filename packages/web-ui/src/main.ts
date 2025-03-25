import { createApp } from 'vue'
import { createPinia } from 'pinia'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import I18NextVue from "i18next-vue";

import App from './App.vue'
import router from './router'
import { initI18n } from './i18n/i18n'
import i18next from 'i18next'

const app = createApp(App)
const pinia = createPinia()
initI18n()
pinia.use(piniaPluginPersistedstate)

app.use(pinia)
app.use(router)
app.use(I18NextVue,{i18next})
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.mount('#app')
