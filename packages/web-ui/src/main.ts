import { createApp } from 'vue'
import { createPinia } from 'pinia'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import I18NextVue from 'i18next-vue'
import Particles from '@tsparticles/vue3'
import { loadFull } from 'tsparticles'

import App from './App.vue'
import router from './router'
import { initI18n } from './i18n/i18n'
import i18next from 'i18next'
import { useAuthStore } from './stores/auth'
import { usePrivateRoomStore } from './stores/privateRoom'
import { ensureRuffleRuntime } from './bootstrap/ruffle'

async function bootstrap() {
  await ensureRuffleRuntime().catch(error => {
    console.warn('Ruffle runtime preload failed, fallback loader may be used:', error)
  })

  const app = createApp(App)
  const pinia = createPinia()
  initI18n()
  pinia.use(piniaPluginPersistedstate)

  app.use(pinia)
  app.use(router)
  app.use(I18NextVue, { i18next })
  app.use(Particles, {
    init: async engine => {
      await loadFull(engine)
    },
  })
  for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(key, component)
  }

  // 初始化 auth store
  const authStore = useAuthStore()
  authStore.initialize()

  if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
    ;(window as typeof window & {
      __APP_DEBUG__?: {
        pinia: typeof pinia
        stores: {
          auth: () => ReturnType<typeof useAuthStore>
          privateRoom: () => ReturnType<typeof usePrivateRoomStore>
        }
        createPrivateRoom: (config: {
          ruleSetId?: string
          isPrivate?: boolean
          password?: string
          p2pTransport?: 'auto' | 'webrtc' | 'relay'
        }) => Promise<string>
      }
    }).__APP_DEBUG__ = {
      pinia,
      stores: {
        auth: () => useAuthStore(),
        privateRoom: () => usePrivateRoomStore(),
      },
      createPrivateRoom: async config => usePrivateRoomStore().createRoom(config),
    }
  }

  app.mount('#app')
}

void bootstrap().catch(error => {
  console.error('Failed to bootstrap web-ui:', error)
})
